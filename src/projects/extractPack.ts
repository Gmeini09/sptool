// Pulls the weapon sounds out of an imported soundpack: every sound SP Tool knows (mapping) comes out labelled
// with its weapon and slot – a shot that GTA stores in two halves (left channel in WEAPONS_PLAYER, right channel
// in RESIDENT) comes out as one stereo sound. Pistol sounds SP Tool cannot name yet come out as candidates to
// listen to ("unbekannt"), so nothing is guessed.
import { streamToAudio, type AwcStream } from '../formats/awc';
import { loadMapping, type Mapping } from '../formats/mapping';
import type { Pack } from '../formats/pack';
import type { AudioData } from '../dsp/types';
import type { WeaponId } from '../models/types';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { indexPack } from './build';
import { TEST_GROUPS } from './gameTest';
import { classifySound, soundFeatures } from '../dsp/classify';
import { isOwnSound } from '../formats/reference';
import { RELOAD_TEST_GROUPS } from './gameTest';

export interface Extracted {
  key: string;
  label: string;
  /** known weapon + slot (from the mapping) – null for candidates */
  weapon: WeaponId | null;
  slot: string | null;
  /** what kind of sound it probably is (for the default target of candidates) */
  kind: 'shot' | 'mechanical';
  /** false when the shot/reload decision was a close call */
  sure: boolean;
  /** a whole reload in one sound (several clicks over ½–3 s) – goes into "Ganzer Reload" */
  whole?: boolean;
  audio: AudioData;
  seconds: number;
}

/** Several separate clicks over ½–3 s: a whole reload (magazine out … slide) in one sound. */
export function isWholeReload(a: AudioData): boolean {
  const sec = a.channels[0].length / a.sampleRate;
  return sec >= 0.5 && sec <= 3 && soundFeatures(a).events >= 2;
}

/** Further pistol sounds creators replace together with the shots (short, mechanical) – not yet named. */
const MECH_CANDIDATES: Array<{ file: string; stream: number }> = [
  158791555, 262226908, 175160094, 300446193, 351424790, 467110165, 525789822, 532075454,
  72533553, 95500280, 102461967, 127674808, 322595178, 496212660,
].map((stream) => ({ file: 'F01', stream }));

function resample(c: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return c;
  const n = Math.round(c.length * to / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const x = i * r, j = Math.floor(x), f = x - j; out[i] = (c[j] ?? 0) * (1 - f) + (c[j + 1] ?? c[j] ?? 0) * f; }
  return out;
}

/** Joins mono halves into one sound: 1 → mono, 2 → stereo (left, right); different rates are matched. */
function join(parts: AudioData[]): AudioData {
  if (parts.length === 1) return parts[0];
  const sr = Math.max(...parts.map((p) => p.sampleRate));
  const chans = parts.slice(0, 2).map((p) => resample(p.channels[0], p.sampleRate, sr));
  const n = Math.max(...chans.map((c) => c.length));
  return { sampleRate: sr, channels: chans.map((c) => { const o = new Float32Array(n); o.set(c); return o; }) };
}

const silent = (a: AudioData) => { let p = 0; for (const c of a.channels) for (let i = 0; i < c.length; i += 4) p = Math.max(p, Math.abs(c[i])); return p < 0.002; };

/** all = also every other readable sound of the pack (other weapons, RESIDENT's sound banks) – to pick freely. */
export function extractPack(pack: Pack, mapping: Mapping = loadMapping(), opts: { all?: boolean } = {}): Extracted[] {
  const idx = indexPack(pack);
  const find = (file: string, stream: number): AwcStream | null => {
    for (const gi of idx.get(file) ?? []) { const s = pack.groups[gi].awc.streams.find((x) => x.id === stream); if (s) return s; }
    return null;
  };
  const toAudio = (list: Array<{ file: string; stream: number }>): AudioData | null => {
    // left half first (the weapon's own file), the RESIDENT half (F01) second
    const sorted = [...list].sort((a, b) => (a.file === 'F01' ? 1 : 0) - (b.file === 'F01' ? 1 : 0));
    const parts: AudioData[] = [];
    for (const t of sorted) { const s = find(t.file, t.stream); if (s) { try { parts.push(streamToAudio(s)); } catch { /* not PCM */ } } }
    if (!parts.length) return null;
    const a = join(parts);
    return silent(a) ? null : a;
  };
  const out: Extracted[] = [];
  const used = new Set<string>();

  // 1 · known sounds, grouped per weapon + slot
  for (const prof of WEAPON_PROFILES) for (const slot of prof.slots) {
    const list = mapping.entries.filter((e) => e.weapon === prof.id && e.slot === slot.id);
    if (!list.length) continue;
    const audio = toAudio(list);
    if (!audio) continue;
    list.forEach((e) => used.add(`${e.file}:${e.stream}`));
    const label = slot.type === 'kill' ? `${slot.label} (alle Waffen)` : `${prof.displayName} · ${slot.label}`;
    out.push({ key: `${prof.id}:${slot.id}`, label, weapon: prof.id as WeaponId, slot: slot.id, kind: /fire/.test(slot.id) ? 'shot' : 'mechanical', sure: true, audio, seconds: audio.channels[0].length / audio.sampleRate });
  }
  // 2 · pistol shots not named yet
  const letters = 'ABCDEFGH';
  let n = 0;
  for (const g of TEST_GROUPS) {
    if (g.streams.some((s) => used.has(`${s.file}:${s.stream}`))) continue;
    const audio = toAudio(g.streams);
    if (!audio) continue;
    g.streams.forEach((s) => used.add(`${s.file}:${s.stream}`));
    out.push({ key: `shot:${g.beeps}`, label: `Pistolen-Schuss ${letters[n++]} (.50 oder MK2?)`, weapon: null, slot: null, kind: 'shot', sure: true, audio, seconds: audio.channels[0].length / audio.sampleRate });
  }
  // 3 · mechanical candidates (reload parts etc.)
  for (const c of MECH_CANDIDATES) {
    if (used.has(`${c.file}:${c.stream}`)) continue;
    const audio = toAudio([c]);
    if (!audio) continue;
    // creators sometimes put shot layers here too – the sound itself decides
    const cl = classifySound(audio);
    const seconds = audio.channels[0].length / audio.sampleRate;
    const kind = cl.kind === 'shot' ? 'shot' : 'mechanical';
    out.push({ key: `mech:${c.stream}`, label: '', weapon: null, slot: null, kind, sure: cl.sure, audio, seconds, whole: kind === 'mechanical' && isWholeReload(audio) });
  }
  // 4 · optional: everything else in WEAPONS_PLAYER (other weapons' sounds)
  if (opts.all) {
    pack.groups.forEach((g, gi) => {
      const k = [...idx.entries()].find(([, l]) => l.includes(gi))?.[0] ?? `C${gi}`;
      const inRes = !g.refs.some((r) => /WEAPONS_PLAYER/i.test(pack.archives[r.archive]?.name ?? ''));
      for (const st of g.awc.streams) {
        if (used.has(`${k}:${st.id}`)) continue;
        // F01 (the big shared file) holds hundreds of original game sounds – only the creator's own ones are shown
        // (e.g. an own kill sound)
        if (k === 'F01' && !isOwnSound(k, st.id, st.data)) continue;
        let audio: AudioData; try { audio = streamToAudio(st); } catch { continue; }
        if (silent(audio)) continue;
        used.add(`${k}:${st.id}`);
        const cl = classifySound(audio);
        out.push({ key: `all:${k}:${st.id}`, label: inRes ? 'RESIDENT' : '', weapon: null, slot: null, kind: cl.kind === 'shot' ? 'shot' : 'mechanical', sure: cl.sure, audio, seconds: audio.channels[0].length / audio.sampleRate });
      }
    });
  }
  // the same sound twice (creators often reuse one file) → keep the first
  const seen = new Set<string>();
  let m = 0, r = 0;
  return out.filter((x) => {
    const c = x.audio.channels[0], step = Math.max(1, Math.floor(c.length / 64));
    let h = `${c.length}`; for (let i = 0; i < c.length; i += step) h += `,${Math.round(c[i] * 1000)}`;
    if (seen.has(h)) return false;
    seen.add(h); return true;
  }).map((x) => {
    if (!x.key.startsWith('mech:') && !x.key.startsWith('all:')) return x;
    const where = x.label === 'RESIDENT' ? ' · RESIDENT' : '';
    if (x.kind === 'shot') return { ...x, label: `Schuss-Sound ${++m} (Waffe unbekannt)${where}` };
    const grp = x.key.startsWith('mech:') ? RELOAD_TEST_GROUPS.findIndex((g) => g.streams.some((st) => `mech:${st.stream}` === x.key)) : -1;
    const clicks = x.whole ? soundFeatures(x.audio).events : 0;
    return { ...x, label: x.whole ? `Ganzer Reload (${clicks} Klicks, ${x.seconds.toFixed(1)} s)${where}` : `Nachlade-Sound ${++r}${grp >= 0 ? ` · Kandidat ${grp + 1}` : ''}${where}` };
  });
}

/** The streams that make up the pistol shots (known and not yet named) – "Reload & Rest" leaves these out. */
export function pistolShotStreams(mapping: Mapping = loadMapping()): Set<string> {
  const out = new Set<string>();
  for (const e of mapping.entries) if (/fire/.test(e.slot)) out.add(`${e.file}:${e.stream}`);
  for (const g of TEST_GROUPS) for (const s of g.streams) out.add(`${s.file}:${s.stream}`);
  return out;
}

/** How many sounds a "Reload & Rest" takeover would bring along (all readable sounds minus the pistol shots). */
export function restCount(pack: Pack): number {
  const ex = pistolShotStreams();
  const idx = indexPack(pack);
  let n = 0;
  for (const [key, list] of idx) for (const gi of list) for (const s of pack.groups[gi].awc.streams) if (!ex.has(`${key}:${s.id}`)) n++;
  return n;
}
