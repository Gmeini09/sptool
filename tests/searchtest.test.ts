// Suchtest: a simulated game plays one fixed sound (with variations) per pistol; the rounds must find exactly it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { synthPack } = await import('./synthPack');
const { openPack } = await import('../src/formats/pack');
const { streamToAudio } = await import('../src/formats/awc');
const { indexPack } = await import('../src/projects/build');
const { allKeys, startSearch, buildRound, applyRound, applySearch, active, isFound } = await import('../src/projects/searchTest');
const { parseMapping, streamsFor } = await import('../src/formats/mapping');
import { readFileSync } from 'node:fs';
const shipped = parseMapping(JSON.parse(readFileSync(new URL('../weapon_profiles/mapping.json', import.meta.url), 'utf8')));

const files = synthPack({ f01Max: 120 });
const pack = openPack(files);
const keys = allKeys(pack);
// the "game": which sounds really play per weapon (pistol has two variations)
const truth: Record<string, string[]> = { 'pistol:fire': [keys[7], keys[40]], 'pistol_mk2:fire': [keys[3]], 'pistol50:fire': [keys[keys.length - 2]], 'pistol:reload': [keys[90], keys[60], keys[120]] };

/** What a tester hears from a built round: count beeps + pitch of the played stream in the output pack. */
function listen(outputs: Array<{ name: string; bytes: Uint8Array }>, k: string): number[] {
  const out = openPack(outputs);
  const [file, s] = k.split(':');
  const st = out.groups[indexPack(out).get(file)![0]].awc.streams.find((x) => x.id === Number(s))!;
  const a = streamToAudio(st).channels[0];
  if (Math.max(...a.slice(0, 4000).map(Math.abs)) < 0.05) return [];
  let beeps = 0, on = false, quiet = 0;
  for (const v of a) { const loud = Math.abs(v) > 0.2; if (loud) { if (!on) beeps++; on = true; quiet = 0; } else if (on && ++quiet > 200) on = false; }
  let zc = 0; const n = Math.min(a.length, 2000); for (let i = 1; i < n; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) zc++;
  return [beeps, zc];
}

test('round 0 → everything beeps; then the rounds narrow each pistol down to its own sounds', () => {
  assert.ok(keys.length > 100, `${keys.length} sounds`);
  let st = startSearch(Object.keys(truth));
  let r = buildRound(pack, st);
  assert.equal(r.count, keys.length);
  for (const o of r.outputs) assert.equal(o.bytes.length, files.find((f) => f.name === o.name)!.bytes.length);
  st = applyRound(pack, { ...st, patterns: r.patterns }, r.patterns, Object.fromEntries(Object.keys(truth).map((t) => [t, [0]])));
  let rounds = 1;
  while (active(st).length && rounds < 14) {
    r = buildRound(pack, st);
    const heard: Record<string, number[]> = {};
    for (const w of active(st)) heard[w] = [...new Set(truth[w].map((k) => r.patterns[k]))];
    // sanity: the built pack really beeps differently for different patterns
    for (const w of active(st)) assert.ok(listen(r.outputs, truth[w][0]).length > 0, 'played sound beeps');
    st = applyRound(pack, { ...st, exact: r.exact }, r.patterns, heard);
    rounds++;
  }
  for (const w of st.weapons) {
    assert.ok(isFound(st, w), `${w} found (${st.sets[w]?.length})`);
    for (const k of truth[w]) assert.ok(st.sets[w]!.includes(k), `${w} keeps ${k}`);
    assert.deepEqual([...st.sets[w]!].sort(), [...truth[w]].sort(), `${w}: exactly its own sounds`);
  }
  assert.ok(rounds <= 10, `${rounds} rounds`); // a reload with 3 sounds narrows slower (3 of 6 patterns heard per round)
  const m = applySearch(shipped, st);
  assert.deepEqual(m.weapons, Object.keys(truth));
  const pf = streamsFor(m.mapping, 'pistol', 'fire').map((e) => `${e.file}:${e.stream}`);
  assert.deepEqual(pf.sort(), [...truth['pistol:fire']].sort(), 'exactly the found shot, old guess removed');
  // reload parts in the order they played
  const part = (slot: string) => streamsFor(m.mapping, 'pistol', slot).map((e) => `${e.file}:${e.stream}`);
  assert.deepEqual([part('mag_out'), part('mag_in'), part('slide')], truth['pistol:reload'].map((k) => [k]));
});

test('a pistol that sounds normal when EVERYTHING beeps → the game does not read the files', () => {
  let st = startSearch(['pistol:fire', 'pistol_mk2:fire']);
  const r = buildRound(pack, st);
  st = applyRound(pack, st, r.patterns, { 'pistol:fire': [], 'pistol_mk2:fire': [0] });
  assert.deepEqual(st.notLoaded, ['pistol:fire']);
  assert.deepEqual(active(st), ['pistol_mk2:fire']);
});
