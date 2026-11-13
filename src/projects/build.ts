// Build: project slots + stream mapping + a base pack → patched archives, ready for Install.
//
// The base pack is any soundpack whose archives contain the mapped original files unencrypted (all
// creator packs do for the files they replaced). Every copy of a mapped file is patched – also when a
// creator put the same file into both WEAPONS_PLAYER and RESIDENT – so the game cannot fall back to
// an old copy. Container sizes never change (see rpf.ts), so the encrypted table of contents stays valid.
// Inside a container the streams can be laid out anew: a muted stream (SILENCE) shrinks to a few milliseconds and
// its bytes let a longer sound – a whole reload – keep its full length (creator packs do the same).
import { monoMix, replaceStreamAudio, silentStream, streamToAudio, writeAwc, type AwcStream } from '../formats/awc';
import { exportPack, type Pack } from '../formats/pack';
import { matchCatalog, streamsFor, type Mapping } from '../formats/mapping';
import type { AudioData } from '../dsp/types';
import type { WeaponProfile } from '../models/types';
import type { Project, SlotAssignment } from './project';
import { canonicalArchiveName } from '../services/install';

export interface BuildTarget { group: number; stream: number }
export type SlotStatus = 'ready' | 'unmapped' | 'not-in-base';
export interface PlanItem { weapon: WeaponProfile['id']; weaponLabel: string; slot: string; slotLabel: string; assignment: SlotAssignment; status: SlotStatus; targets: BuildTarget[]; files: string[] }
export interface BuildPlan { items: PlanItem[]; ready: number; blocked: number }

/** Catalog key → pack groups that are that original file. */
export function indexPack(pack: Pack): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  pack.groups.forEach((g, gi) => {
    const c = matchCatalog(g.awc);
    if (c) idx.set(c.key, [...(idx.get(c.key) ?? []), gi]);
  });
  return idx;
}

/**
 * Sounds GTA plays from the same file: the Pistol MK2 fires the Pistol's shot (ptl_pistol.awc – heard in the original
 * template; the game only changes pitch and tone per weapon). Used when the slot has no mapping of its own.
 */
export const SAME_SOUND: Record<string, { weapon: WeaponProfile['id']; slot: string }> = {
  'pistol_mk2:fire': { weapon: 'pistol', slot: 'fire' },
};

export function planBuild(project: Project, profiles: WeaponProfile[], mapping: Mapping, pack: Pack | null): BuildPlan {
  const idx = pack ? indexPack(pack) : new Map<string, number[]>();
  const items: PlanItem[] = [];
  for (const prof of profiles) {
    const slots = project.weapons[prof.id] ?? {};
    for (const s of prof.slots) {
      const a = slots[s.id];
      if (!a) continue;
      const own = streamsFor(mapping, prof.id, s.id), alias = SAME_SOUND[`${prof.id}:${s.id}`];
      const mapped = own.length || !alias ? own : streamsFor(mapping, alias.weapon, alias.slot);
      const targets: BuildTarget[] = [];
      for (const m of mapped) for (const gi of idx.get(m.file) ?? []) {
        if (pack!.groups[gi].awc.streams.some((st) => st.id === m.stream)) targets.push({ group: gi, stream: m.stream });
      }
      const status: SlotStatus = !mapped.length ? 'unmapped' : targets.length ? 'ready' : 'not-in-base';
      items.push({ weapon: prof.id, weaponLabel: prof.displayName, slot: s.id, slotLabel: s.label, assignment: a, status, targets, files: [...new Set(mapped.map((m) => m.file))] });
    }
  }
  const ready = items.filter((i) => i.status === 'ready').length;
  return { items, ready, blocked: items.length - ready };
}

export interface BuildOutput { name: string; bytes: Uint8Array; patchedContainers: number }
export interface BuildResult { outputs: BuildOutput[]; replacedStreams: number }


/** "Reload & Rest" of another soundpack: its archives are used as the base for one build. */
export interface Transplant { pack: Pack; label: string; exclude: Set<string> }

/**
 * The reload is the same for all pistols in SP Tool. When the game uses one set of reload sounds for several
 * pistols, the in-game test maps them to the first pistol only – the others get the same sound through it.
 */
export const sharedReload = (plan: BuildPlan, i: PlanItem) => i.status !== 'ready' && /^(mag_out|mag_in|slide|reload_finish)$/.test(i.slot)
  && plan.items.some((o) => o !== i && o.status === 'ready' && o.slot === i.slot && o.assignment.entryId === i.assignment.entryId);

/** Selections that cannot be written into the game yet ("Pistol .50 · Schuss"): unmapped or missing in the base. */
/**
 * Two slots that GTA plays from the same file (e.g. Pistol and Pistol MK2 shot) with different sounds – only one can be
 * in the game. Returns the message, or null. SP Tool never picks one by itself.
 */
export function sameSoundClash(plan: BuildPlan): string | null {
  const at = new Map<string, PlanItem>();
  for (const it of plan.items) {
    if (it.status !== 'ready') continue;
    for (const t of it.targets) {
      const k = `${t.group}:${t.stream}`, o = at.get(k);
      if (o && o !== it && o.assignment.entryId !== it.assignment.entryId) {
        return `${o.weaponLabel} und ${it.weaponLabel} benutzen in GTA denselben Sound (${o.slotLabel}) – im Spiel kann nur einer davon kommen. Wähl bei beiden denselben Sound oder bei einer der beiden „Original behalten“.`;
      }
      at.set(k, it);
    }
  }
  return null;
}

export const blockedLabels = (plan: BuildPlan) => [...new Set(plan.items.filter((i) => i.status !== 'ready' && i.assignment.entryId !== SILENCE && !sharedReload(plan, i)).map((i) => `${i.weaponLabel} · ${i.slotLabel}`))];

/** true when every output archive is byte-for-byte the base archive of the same name – the build changed nothing. */
export function sameAsBase(pack: Pack, outputs: Array<{ name: string; bytes: Uint8Array }>): boolean {
  if (!outputs.length) return true;
  return outputs.every((o) => {
    const src = pack.archives.find((a) => canonicalArchiveName(a.name).toLowerCase() === o.name.toLowerCase());
    if (!src || src.bytes.length !== o.bytes.length) return false;
    for (let i = 0; i < o.bytes.length; i++) if (src.bytes[i] !== o.bytes[i]) return false;
    return true;
  });
}

/**
 * Message for a build that would hand back the template unchanged (e.g. "Reload & Rest" of an SP plus shots for
 * weapons SP Tool cannot write yet), or null when the build changes something.
 */
export function nothingChangesMessage(plan: BuildPlan, templateLabel: string): string | null {
  if (plan.items.some((i) => i.status === 'ready' && i.assignment.entryId !== SILENCE)) return null;
  const blocked = blockedLabels(plan);
  return blocked.length
    ? `Dein Soundpack wäre genau „${templateLabel}“: ${blocked.join(', ')} kann SP Tool noch nicht ins Spiel schreiben, weil noch nicht bekannt ist, wo GTA sie ablegt (Test im Spiel). Wähl bei der Pistol einen eigenen Schuss oder nimm „Reload & Rest“ wieder raus.`
    : `Dein Soundpack wäre genau „${templateLabel}“ – du hast keinen eigenen Sound gewählt.`;
}

/**
 * Renders every ready slot once and writes it into all of its target streams.
 * `render` turns a slot assignment into audio (renderAssignment in the app; a stub in tests).
 */
/** Entry id that mutes a slot (the rest of a "whole reload": the other reload parts stay silent). */
export const SILENCE = 'sptool:silence';

// 1 : 1 – a sound goes into the game exactly as it is: its own sample rate, its own length, its own level.
// SP Tool changes nothing by itself (no normalising, no resampling, no cutting). The only step the game forces is
// mono (GTA plays these streams in mono). A sound that does not fit the template is an error the user fixes by hand.
const KEEP = { normalize: false } as const;
const MIN_GAME_RATE = 8000, MAX_GAME_RATE = 65535; // what an AWC stream can hold

/** Sounds that do not fit the template 1 : 1 – SP Tool never cuts or squeezes them by itself. */
export class TooLongError extends Error {
  constructor(public parts: Array<{ labels: string[]; overSeconds: number }>) {
    super(`Passt nicht in die Vorlage – SP Tool kürzt und verändert deine Sounds nicht: ${parts.map((x) => `${x.labels.join(' + ')} ${x.labels.length > 1 ? 'sind zusammen' : 'ist'} ${x.overSeconds.toFixed(2).replace('.', ',')} s zu lang`).join('; ')}. Kürze den Sound selbst mit „Bearbeiten“.`);
    this.name = 'TooLongError';
  }
}

/** The sound written 1 : 1 into a stream (mono, own rate, own length, own level). */
function exactStream(o: AwcStream, audio: AudioData): AwcStream {
  const sr = audio.sampleRate;
  if (sr < MIN_GAME_RATE || sr > MAX_GAME_RATE) throw new Error(`Ein Sound hat ${sr} Hz – GTA kann nur ${MIN_GAME_RATE}–${MAX_GAME_RATE} Hz. Speichere die Datei z. B. mit 48000 Hz.`);
  return replaceStreamAudio(o, audio, { ...KEEP, sampleRate: sr });
}

/** Lays out one container 1 : 1: muted streams shrink, every sound keeps rate, length and level. over = bytes too many. */
function layoutGroup(pack: Pack, gi: number, wanted: Map<number, AudioData | null>): { streams: Map<number, AwcStream>; over: number } {
  const g = pack.groups[gi];
  const orig = (id: number) => g.awc.streams.find((s) => s.id === id)!;
  const streams = new Map<number, AwcStream>();
  for (const [id, audio] of wanted) streams.set(id, audio ? exactStream(orig(id), audio) : silentStream(orig(id)));
  const size = writeAwc({ ...g.awc, streams: g.awc.streams.map((s) => streams.get(s.id) ?? s) }).length;
  return { streams, over: Math.max(0, size - g.length) };
}

/** Seconds a container is too long: the extra bytes at its sounds' rates (16-bit mono). */
function overSeconds(over: number, sounds: AudioData[]): number {
  if (over <= 0) return 0;
  const bytesPerSecond = sounds.reduce((s, a) => s + a.sampleRate * 2, 0) / Math.max(1, sounds.length);
  return Math.max(0.01, over / Math.max(1, bytesPerSecond));
}

/**
 * Renders every ready slot once and writes it into all of its target streams.
 * `render` turns a slot assignment into audio (renderAssignment in the app; a stub in tests).
 */
export async function runBuild(plan: BuildPlan, pack: Pack, render: (a: SlotAssignment) => Promise<AudioData>, onProgress?: (done: number, total: number, label: string) => void, opts: { allowEmpty?: boolean; allArchives?: boolean } = {}): Promise<BuildResult> {
  const ready = plan.items.filter((i) => i.status === 'ready');
  if (!ready.length && !opts.allowEmpty) throw new Error('Nichts zu bauen: Kein befüllter Slot ist einem Sound im Basis-Pack zugeordnet.');
  const clash = sameSoundClash(plan);
  if (clash) throw new Error(clash);
  const want = new Map<number, Map<number, AudioData | null>>();
  const labels = new Map<number, Set<string>>(); // group → slots with an own sound in it (for "zu lang")
  let replaced = 0;
  for (const [n, it] of ready.entries()) {
    onProgress?.(n, ready.length, `${it.weaponLabel} · ${it.slotLabel}`);
    const audio = it.assignment.entryId === SILENCE ? null : await render(it.assignment);
    for (const t of it.targets) {
      if (!want.has(t.group)) want.set(t.group, new Map());
      want.get(t.group)!.set(t.stream, audio);
      if (audio) { if (!labels.has(t.group)) labels.set(t.group, new Set()); labels.get(t.group)!.add(`${it.weaponLabel} · ${it.slotLabel}`); }
      replaced++;
    }
  }
  onProgress?.(ready.length, ready.length, 'Archive werden geschrieben');
  // (inGameAudio below lays out one group the same way – keep both in step)
  const byGroup = new Map<number, Map<number, AwcStream>>();
  const tooLong = new Map<string, { labels: string[]; overSeconds: number }>();
  for (const [gi, w] of want) {
    const r = layoutGroup(pack, gi, w);
    byGroup.set(gi, r.streams);
    if (r.over > 0) {
      const l = [...(labels.get(gi) ?? [])];
      const sec = overSeconds(r.over, [...w.values()].filter((a): a is AudioData => !!a));
      const k = l.join('|'); // the same sounds in another container: report once, the larger gap
      if (!tooLong.has(k) || tooLong.get(k)!.overSeconds < sec) tooLong.set(k, { labels: l, overSeconds: sec });
    }
  }
  if (tooLong.size) throw new TooLongError([...tooLong.values()]);
  const outputs = exportPack(pack, byGroup, { includeUnchanged: opts.allArchives })
    .map((o) => ({ ...o, name: canonicalArchiveName(o.name) }));
  return { outputs, replacedStreams: replaced };
}

export interface InGameSound {
  /** exactly what the game file holds: the sound 1 : 1 in mono */
  audio: AudioData;
  /** false: the sound (with the others in its container) does not fit the template – the build stops */
  fits: boolean;
  /** seconds the container is too long (0 when it fits) */
  overSeconds: number;
  sourceSeconds: number;
  gameSeconds: number;
  /** level lost when the stereo sound is folded to mono (dB, ≤ 0) */
  monoLossDb: number;
}

/**
 * What one slot will be in the game: lays out its container exactly like runBuild (with the other sounds of the plan
 * that share it) and decodes the stream again. null when the slot is not written into the game (unmapped, not in
 * the base, muted).
 */
export async function inGameAudio(plan: BuildPlan, pack: Pack, item: PlanItem, render: (a: SlotAssignment) => Promise<AudioData>): Promise<InGameSound | null> {
  if (item.status !== 'ready' || item.assignment.entryId === SILENCE || !item.targets.length) return null;
  const t = item.targets[0];
  const want = new Map<number, AudioData | null>();
  let source: AudioData | null = null;
  for (const it of plan.items) {
    if (it.status !== 'ready') continue;
    const here = it.targets.filter((x) => x.group === t.group);
    if (!here.length) continue;
    const audio = it.assignment.entryId === SILENCE ? null : await render(it.assignment);
    if (it === item) source = audio;
    for (const x of here) want.set(x.stream, audio);
  }
  if (!source) return null;
  const r = layoutGroup(pack, t.group, want);
  const audio = streamToAudio(r.streams.get(t.stream)!);
  return {
    audio, fits: r.over === 0, overSeconds: overSeconds(r.over, [...want.values()].filter((a): a is AudioData => !!a)),
    sourceSeconds: source.channels[0].length / source.sampleRate, gameSeconds: audio.channels[0].length / audio.sampleRate,
    monoLossDb: monoMix(source).lossDb,
  };
}

// The base pack used by Build, handed over from the Pack Analyzer or picked on the Build screen (memory only).
let basePack: { pack: Pack; names: string[] } | null = null;
const baseSubs = new Set<() => void>();
export function setBasePack(pack: Pack | null) { basePack = pack ? { pack, names: pack.archives.map((a) => a.name) } : null; baseSubs.forEach((f) => f()); }
export const getBasePack = () => basePack;
export function onBasePack(f: () => void) { baseSubs.add(f); return () => { baseSubs.delete(f); }; }
