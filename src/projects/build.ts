// Build: project slots + stream mapping + a base pack → patched archives, ready for Install.
//
// The base pack is any soundpack whose archives contain the mapped original files unencrypted (all
// creator packs do for the files they replaced). Every copy of a mapped file is patched – also when a
// creator put the same file into both WEAPONS_PLAYER and RESIDENT – so the game cannot fall back to
// an old copy. Container sizes never change (see rpf.ts), so the encrypted table of contents stays valid.
// Inside a container the streams can be laid out anew: a muted stream (SILENCE) shrinks to a few milliseconds and
// its bytes let a longer sound – a whole reload – keep its full length (creator packs do the same).
import { fitStreamAudio, monoMix, replaceStreamAudio, silentStream, streamToAudio, writeAwc, type AwcStream } from '../formats/awc';
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

export function planBuild(project: Project, profiles: WeaponProfile[], mapping: Mapping, pack: Pack | null): BuildPlan {
  const idx = pack ? indexPack(pack) : new Map<string, number[]>();
  const items: PlanItem[] = [];
  for (const prof of profiles) {
    const slots = project.weapons[prof.id] ?? {};
    for (const s of prof.slots) {
      const a = slots[s.id];
      if (!a) continue;
      const mapped = streamsFor(mapping, prof.id, s.id);
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
/** truncated: shortened (faded out) to fit · lowered: written at a lower sample rate to keep more of its length */
export interface BuildResult { outputs: BuildOutput[]; replacedStreams: number; truncated: string[]; padded: string[]; lowered: string[] }


/** "Reload & Rest" of another soundpack: its archives are used as the base for one build. */
export interface Transplant { pack: Pack; label: string; exclude: Set<string> }

/**
 * The reload is the same for all pistols in SP Tool. When the game uses one set of reload sounds for several
 * pistols, the in-game test maps them to the first pistol only – the others get the same sound through it.
 */
export const sharedReload = (plan: BuildPlan, i: PlanItem) => i.status !== 'ready' && /^(mag_out|mag_in|slide|reload_finish)$/.test(i.slot)
  && plan.items.some((o) => o !== i && o.status === 'ready' && o.slot === i.slot && o.assignment.entryId === i.assignment.entryId);

/** Selections that cannot be written into the game yet ("Pistol .50 · Schuss"): unmapped or missing in the base. */
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

const MIN_RATE = 11025; // below this a reload sounds like a telephone
// a shot keeps its crack: its rate is never lowered below this (or its original rate if that is lower) – the tail is
// faded out instead, because the first few hundred ms carry the shot and a muffled crack is worse than a shorter echo
const SHOT_MIN_RATE = 32000;
// a sound is written at its own rate when there is room (like a pack made by hand) – never above this
const MAX_RATE = 48000;
// the level of a sound stays as it is, like in a pack made by hand (no normalising to full scale)
const KEEP = { normalize: false } as const;

/** The first `keep` samples with a soft fade-out (last quarter, at most 120 ms) – used when a sound must be shortened. */
function fadeTo(a: AudioData, keep: number): AudioData {
  const n = Math.max(1, Math.min(keep, a.channels[0].length));
  const fade = Math.max(1, Math.min(Math.round(n / 4), Math.round(a.sampleRate * 0.12)));
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => { const o = c.slice(0, n); for (let i = 0; i < fade; i++) o[n - 1 - i] *= i / fade; return o; }) };
}
const seconds = (s: AwcStream) => s.format.samples / s.format.sampleRate;

/** How loud a shot or click is heard: RMS of its loudest 50 ms. */
function punch(c: Float32Array, rate: number): number {
  const w = Math.max(1, Math.round(rate * 0.05));
  let best = 0, sum = 0;
  for (let i = 0; i < c.length; i++) { sum += c[i] * c[i]; if (i >= w) sum -= c[i - w] * c[i - w]; if (i >= w - 1) best = Math.max(best, sum); }
  if (c.length < w) best = sum;
  return Math.sqrt(Math.max(0, best) / w);
}

/** "Lautstärke wie das Original": the sound gets the loudness of the template sound it replaces (never above full scale). */
function matchLevel(o: AwcStream, a: AudioData): AudioData {
  const ref = punch(streamToAudio(o).channels[0], o.format.sampleRate);
  const m = monoMix(a).mono, cur = punch(m, a.sampleRate);
  if (ref < 1e-6 || cur < 1e-6) return a;
  let peak = 0;
  for (let i = 0; i < m.length; i++) peak = Math.max(peak, Math.abs(m[i]));
  const g = Math.min(ref / cur, 1 / Math.max(peak, 1e-9));
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => c.map((x) => x * g)) };
}

export interface LayoutOptions { matchLevel?: boolean }

/**
 * Lays out one container: sounds that fit their stream are written exactly as before (same size); a muted stream
 * shrinks; a sound longer than its stream gets the freed bytes – at a lower sample rate if needed (not below
 * 11 kHz) – and only what still does not fit is cut off.
 */
function layoutGroup(pack: Pack, gi: number, wanted: Map<number, AudioData | null>, shots: Set<number> = new Set(), lo: LayoutOptions = {}): { streams: Map<number, AwcStream>; truncated: Set<number>; padded: Set<number>; lowered: Set<number> } {
  const g = pack.groups[gi];
  const orig = (id: number) => g.awc.streams.find((s) => s.id === id)!;
  const want = lo.matchLevel ? new Map([...wanted].map(([id, a]) => [id, a && matchLevel(orig(id), a)] as const)) : wanted;
  const truncated = new Set<number>(), padded = new Set<number>(), lowered = new Set<number>();
  const size = (m: Map<number, AwcStream>) => writeAwc({ ...g.awc, streams: g.awc.streams.map((s) => m.get(s.id) ?? s) }).length;
  // 0 · every sound at its own rate and full length – exactly what a pack made by hand holds – when the container has room
  const own = new Map<number, AwcStream>();
  for (const [id, audio] of want) own.set(id, audio ? replaceStreamAudio(orig(id), audio, { ...KEEP, sampleRate: Math.max(8000, Math.min(MAX_RATE, audio.sampleRate)) }) : silentStream(orig(id)));
  if (size(own) <= g.length) return { streams: own, truncated, padded, lowered };
  const exact = new Map<number, AwcStream>();
  const long: Array<[number, AudioData]> = [];
  for (const [id, audio] of want) {
    const o = orig(id);
    if (!audio) { exact.set(id, silentStream(o)); continue; }
    if (audio.channels[0].length / audio.sampleRate <= seconds(o) + 1e-6) { const f = fitStreamAudio(o, audio, KEEP); exact.set(id, f.stream); if (f.padded) padded.add(id); continue; }
    long.push([id, audio]);
  }
  if (!long.length) return { streams: exact, truncated, padded, lowered };
  // 1 · full length at the original rate
  const full = new Map(exact);
  for (const [id, audio] of long) full.set(id, replaceStreamAudio(orig(id), audio, KEEP));
  if (size(full) <= g.length) return { streams: full, truncated, padded, lowered };
  // 2 · share the free bytes evenly: lower the rate first, cut only what does not fit even at MIN_RATE
  const tiny = new Map(exact);
  for (const [id] of long) tiny.set(id, silentStream(orig(id)));
  let free = g.length - size(tiny);
  for (let attempt = 0; attempt < 12 && free > 0; attempt++) {
    const per = Math.floor(free / long.length);
    const budget = Math.max(16, Math.floor((per - 64) / 2.001)); // samples: data + alignment + peak chunk
    const m = new Map(exact), cuts = new Set<number>(), lows = new Set<number>();
    for (const [id, audio] of long) {
      const o = orig(id);
      const sec = audio.channels[0].length / audio.sampleRate;
      const floor = shots.has(id) ? Math.min(o.format.sampleRate, SHOT_MIN_RATE) : MIN_RATE;
      const rate = Math.min(o.format.sampleRate, Math.max(floor, Math.floor(budget / sec)));
      const keep = Math.min(audio.channels[0].length, Math.max(1, Math.floor((budget / rate) * audio.sampleRate)));
      const a = keep < audio.channels[0].length ? fadeTo(audio, keep) : audio;
      m.set(id, replaceStreamAudio(o, a, { ...KEEP, sampleRate: rate }));
      if (keep < audio.channels[0].length) cuts.add(id);
      if (rate < o.format.sampleRate) lows.add(id);
    }
    const over = size(m) - g.length;
    if (over <= 0) { cuts.forEach((id) => truncated.add(id)); lows.forEach((id) => lowered.add(id)); return { streams: m, truncated, padded, lowered }; }
    free -= over + 16 * long.length;
  }
  for (const [id, audio] of long) { const o = orig(id); exact.set(id, fitStreamAudio(o, fadeTo(audio, Math.floor(seconds(o) * audio.sampleRate)), KEEP).stream); truncated.add(id); }
  return { streams: exact, truncated, padded, lowered };
}

/**
 * Renders every ready slot once and writes it into all of its target streams.
 * `render` turns a slot assignment into audio (renderAssignment in the app; a stub in tests).
 */
export async function runBuild(plan: BuildPlan, pack: Pack, render: (a: SlotAssignment) => Promise<AudioData>, onProgress?: (done: number, total: number, label: string) => void, opts: { allowEmpty?: boolean; allArchives?: boolean } & LayoutOptions = {}): Promise<BuildResult> {
  const ready = plan.items.filter((i) => i.status === 'ready');
  if (!ready.length && !opts.allowEmpty) throw new Error('Nichts zu bauen: Kein befüllter Slot ist einem Sound im Basis-Pack zugeordnet.');
  const want = new Map<number, Map<number, AudioData | null>>();
  const labelOf = new Map<string, string>(); // "group:stream" → slot label (for truncation notes)
  const shotStreams = new Map<number, Set<number>>(); // group → streams that hold a shot (never muffled)
  let replaced = 0;
  for (const [n, it] of ready.entries()) {
    onProgress?.(n, ready.length, `${it.weaponLabel} · ${it.slotLabel}`);
    const audio = it.assignment.entryId === SILENCE ? null : await render(it.assignment);
    for (const t of it.targets) {
      if (!want.has(t.group)) want.set(t.group, new Map());
      want.get(t.group)!.set(t.stream, audio);
      labelOf.set(`${t.group}:${t.stream}`, `${it.weaponLabel} · ${it.slotLabel}`);
      if (/fire$/.test(it.slot)) { if (!shotStreams.has(t.group)) shotStreams.set(t.group, new Set()); shotStreams.get(t.group)!.add(t.stream); }
      replaced++;
    }
  }
  onProgress?.(ready.length, ready.length, 'Archive werden geschrieben');
  const byGroup = new Map<number, Map<number, AwcStream>>();
  // (inGameAudio below lays out one group the same way – keep both in step)
  const truncated: string[] = [], padded: string[] = [], lowered: string[] = [];
  for (const [gi, w] of want) {
    const r = layoutGroup(pack, gi, w, shotStreams.get(gi), opts);
    byGroup.set(gi, r.streams);
    for (const id of r.truncated) truncated.push(labelOf.get(`${gi}:${id}`)!);
    for (const id of r.padded) padded.push(labelOf.get(`${gi}:${id}`)!);
    for (const id of r.lowered) lowered.push(labelOf.get(`${gi}:${id}`)!);
  }
  const outputs = exportPack(pack, byGroup, { includeUnchanged: opts.allArchives })
    .map((o) => ({ ...o, name: canonicalArchiveName(o.name) }));
  return { outputs, replacedStreams: replaced, truncated: [...new Set(truncated)], padded: [...new Set(padded)], lowered: [...new Set(lowered)] };
}

export interface InGameSound {
  /** exactly what the game file will hold: mono, levelled, at the stream's rate, shortened if it had to be */
  audio: AudioData;
  truncated: boolean;
  lowered: boolean;
  /** seconds before / after writing */
  sourceSeconds: number;
  gameSeconds: number;
  /** level lost when the stereo sound is folded to mono (dB, ≤ 0) */
  monoLossDb: number;
}

/**
 * What one slot will sound like in the game: lays out its container exactly like runBuild (the other sounds of the
 * plan that share that container take their share of the free bytes) and decodes the stream again.
 * null when the slot is not written into the game (unmapped, not in the base, muted).
 */
export async function inGameAudio(plan: BuildPlan, pack: Pack, item: PlanItem, render: (a: SlotAssignment) => Promise<AudioData>, lo: LayoutOptions = {}): Promise<InGameSound | null> {
  if (item.status !== 'ready' || item.assignment.entryId === SILENCE || !item.targets.length) return null;
  const t = item.targets[0];
  const want = new Map<number, AudioData | null>(), shots = new Set<number>();
  let source: AudioData | null = null;
  for (const it of plan.items) {
    if (it.status !== 'ready') continue;
    const here = it.targets.filter((x) => x.group === t.group);
    if (!here.length) continue;
    const audio = it.assignment.entryId === SILENCE ? null : await render(it.assignment);
    if (it === item) source = audio;
    for (const x of here) { want.set(x.stream, audio); if (/fire$/.test(it.slot)) shots.add(x.stream); }
  }
  if (!source) return null;
  const r = layoutGroup(pack, t.group, want, shots, lo);
  const audio = streamToAudio(r.streams.get(t.stream)!);
  const n = source.channels[0].length, monoLossDb = monoMix(source).lossDb;
  return {
    audio, truncated: r.truncated.has(t.stream), lowered: r.lowered.has(t.stream),
    sourceSeconds: n / source.sampleRate, gameSeconds: audio.channels[0].length / audio.sampleRate, monoLossDb,
  };
}

// The base pack used by Build, handed over from the Pack Analyzer or picked on the Build screen (memory only).
let basePack: { pack: Pack; names: string[] } | null = null;
const baseSubs = new Set<() => void>();
export function setBasePack(pack: Pack | null) { basePack = pack ? { pack, names: pack.archives.map((a) => a.name) } : null; baseSubs.forEach((f) => f()); }
export const getBasePack = () => basePack;
export function onBasePack(f: () => void) { baseSubs.add(f); return () => { baseSubs.delete(f); }; }
