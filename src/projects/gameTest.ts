// In-game mapping test ("Zuordnungstest"): Rockstar stores only hashed sound names, so which container belongs
// to which pistol can only be found by listening in the game. SP Tool builds a test pack from the base pack in
// which every candidate sound is replaced by a number of beeps (1×, 2×, 3×). The tester shoots each pistol once
// and clicks how often it beeped – that answer becomes the mapping (and an admin can publish it for everyone).
import { fitStreamAudio, type AwcStream } from '../formats/awc';
import { exportPack, type Pack } from '../formats/pack';
import { setStreamMapping, type Mapping } from '../formats/mapping';
import type { AudioData } from '../dsp/types';
import type { WeaponId } from '../models/types';
import { canonicalArchiveName } from '../services/install';
import { indexPack } from './build';

export interface TestStream { file: string; stream: number }
export interface TestGroup { beeps: number; label: string; streams: TestStream[]; /** beep pitch – reload candidates beep low (400 Hz) */ freq?: number }

/** Candidates for the pistol shots (left channel in WEAPONS_PLAYER + right channel in RESIDENT weapons.awc). */
export const TEST_GROUPS: TestGroup[] = [
  { beeps: 1, label: 'Kandidat A', streams: [{ file: 'F02', stream: 182780901 }, { file: 'F01', stream: 522480718 }] },
  { beeps: 2, label: 'Kandidat B', streams: [{ file: 'F04', stream: 369994369 }] },
  { beeps: 3, label: 'Pistole (Kontrolle)', streams: [{ file: 'F03', stream: 277856074 }, { file: 'F01', stream: 256769237 }] },
];

/**
 * Reload candidates: the short mechanical pistol sounds creators replace together with the shots (RESIDENT,
 * weapons.awc). Each group is one game event with its variations (GTA picks one at random), so a group gets one
 * pattern of LOW beeps. The tester reloads and reports which low patterns came, in order.
 */
export const RELOAD_TEST_GROUPS: TestGroup[] = [
  { beeps: 1, freq: 400, label: 'Nachlade-Kandidat 1', streams: [158791555, 262226908].map((stream) => ({ file: 'F01', stream })) },
  { beeps: 2, freq: 400, label: 'Nachlade-Kandidat 2', streams: [175160094, 300446193, 351424790, 467110165, 525789822, 532075454].map((stream) => ({ file: 'F01', stream })) },
  { beeps: 3, freq: 400, label: 'Nachlade-Kandidat 3', streams: [72533553, 95500280, 102461967, 127674808, 322595178, 496212660].map((stream) => ({ file: 'F01', stream })) },
];
/** Reload parts in the order the game plays them. */
export const RELOAD_ORDER = ['mag_out', 'mag_in', 'slide', 'reload_finish'] as const;

/** n short beeps (1 kHz, or `freq`) that fit into `seconds` (each beep and gap at most 90 ms, at least 15 ms). */
export function beepAudio(n: number, seconds: number, sampleRate = 44100, freq = 1000): AudioData {
  const total = Math.max(1, Math.round(seconds * sampleRate));
  const unit = Math.max(Math.round(0.015 * sampleRate), Math.min(Math.round(0.09 * sampleRate), Math.floor(total / (2 * n))));
  const out = new Float32Array(total);
  const ramp = Math.max(1, Math.round(0.003 * sampleRate));
  for (let b = 0; b < n; b++) {
    const start = b * unit * 2;
    for (let i = 0; i < unit && start + i < total; i++) {
      const env = Math.min(1, i / ramp, (unit - 1 - i) / ramp);
      out[start + i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.8 * env;
    }
  }
  return { sampleRate, channels: [out] };
}

export interface GameTestBuild { outputs: Array<{ name: string; bytes: Uint8Array }>; groups: Array<TestGroup & { found: number }> }

/** Replaces every candidate stream of the base pack by its beep pattern. */
export function buildGameTest(pack: Pack, groups: TestGroup[] = [...TEST_GROUPS, ...RELOAD_TEST_GROUPS]): GameTestBuild {
  const idx = indexPack(pack);
  const byGroup = new Map<number, Map<number, AwcStream>>();
  const found = groups.map((g) => {
    let n = 0;
    for (const t of g.streams) for (const gi of idx.get(t.file) ?? []) {
      const orig = pack.groups[gi].awc.streams.find((s) => s.id === t.stream);
      if (!orig) continue;
      const fit = fitStreamAudio(orig, beepAudio(g.beeps, orig.format.samples / orig.format.sampleRate, orig.format.sampleRate, g.freq));
      if (!byGroup.has(gi)) byGroup.set(gi, new Map());
      byGroup.get(gi)!.set(t.stream, fit.stream);
      n++;
    }
    return { ...g, found: n };
  });
  if (!byGroup.size) throw new Error('Im Basis-Pack ist keiner der Test-Sounds enthalten. Nimm ein Pistolen-Soundpack als Basis.');
  const outputs = exportPack(pack, byGroup).filter((o) => o.patchedContainers > 0).map((o) => ({ name: canonicalArchiveName(o.name), bytes: o.bytes }));
  return { outputs, groups: found };
}

/** "weapon:slot" → beeps heard (0 = original sound / nothing changed). */
export type TestAnswers = Record<string, number>;

/** Writes the answers into the mapping: every stream of the group with that beep count → weapon/slot. */
/** Answers are applied in the given key order. A stream holds one slot, so when two weapons beeped the same
 * (the game reuses that sound for both) the first one keeps it and the other is reported in `shared`. */
export function applyGameTest(m: Mapping, answers: TestAnswers, groups: TestGroup[] = TEST_GROUPS): { mapping: Mapping; added: number; shared: Array<{ key: string; with: string }> } {
  let next = m, added = 0;
  const owner = new Map<number, string>();
  const shared: Array<{ key: string; with: string }> = [];
  for (const [key, beeps] of Object.entries(answers)) {
    const g = groups.find((x) => x.beeps === beeps);
    if (!g) continue;
    const prev = owner.get(beeps);
    if (prev) { shared.push({ key, with: prev }); continue; }
    owner.set(beeps, key);
    const [weapon, slot] = key.split(':');
    for (const s of g.streams) { next = setStreamMapping(next, s.file, s.stream, { weapon: weapon as WeaponId, slot }); added++; }
  }
  return { mapping: next, added, shared };
}

/** Low-beep patterns heard while reloading, in order (e.g. [2, 1]) → weapon's reload parts: first = mag_out, … */
export function applyReloadTest(m: Mapping, weapon: WeaponId, heard: number[], groups: TestGroup[] = RELOAD_TEST_GROUPS): { mapping: Mapping; added: number } {
  let next = m, added = 0;
  [...new Set(heard)].slice(0, RELOAD_ORDER.length).forEach((beeps, i) => {
    const g = groups.find((x) => x.beeps === beeps);
    if (!g) return;
    for (const s of g.streams) { next = setStreamMapping(next, s.file, s.stream, { weapon, slot: RELOAD_ORDER[i] }); added++; }
  });
  return { mapping: next, added };
}
