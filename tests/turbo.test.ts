// The Turbo sounds shipped with SP Tool: every catalog entry has its file, names and ids are unique,
// shots fit every pistol, reloads are offered as whole reloads, recommendations cover several styles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { turboCatalog, featuredFirst, WHOLE_RELOAD } = await import('../src/library/turbo');
const { slotMatches } = await import('../src/projects/project');

test('Turbo catalog: files, unique names and ids, numbering', () => {
  const cat = turboCatalog();
  assert.equal(cat.length, 232);
  assert.equal(new Set(cat.map((e) => e.id)).size, cat.length);
  assert.equal(new Set(cat.map((e) => e.name)).size, cat.length);
  for (const e of cat) assert.ok(existsSync(new URL(`../src/${e.asset}`, import.meta.url)), String(e.asset));
  const shots = cat.filter((e) => e.type === "fire"), reloads = cat.filter((e) => e.type === "reload");
  assert.equal(shots.length, 190);
  assert.equal(reloads.length, 42);
  // one running number in list order: recommended shots, other shots, reloads
  assert.deepEqual(cat.map((e) => e.name), cat.map((_, i) => `Turbo ${i + 1}`));
  assert.ok(cat.slice(0, 20).every((e) => e.featured) && cat.slice(190).every((e) => e.type === 'reload'));
});

test('Turbo shots fit every pistol, reloads are whole reloads, recommendations come first', () => {
  const cat = turboCatalog();
  const shot = cat.find((e) => e.type === 'fire')!;
  for (const w of ['pistol', 'pistol_mk2', 'pistol50'] as const) assert.ok(slotMatches(shot, w, 'fire'), w);
  assert.ok(!slotMatches(shot, 'pistol', 'suppressed_fire'));
  assert.ok(cat.filter((e) => e.type === 'reload').every((e) => e.component === WHOLE_RELOAD && !slotMatches(e, 'pistol', 'mag_in')));
  const rec = cat.filter((e) => e.featured);
  assert.equal(rec.length, 20);
  assert.ok(rec.every((e) => e.type === 'fire'));
  assert.ok(new Set(rec.map((e) => e.style)).size >= 6, 'recommendations cover several styles');
  assert.ok(new Set(cat.filter((e) => e.type === 'fire').map((e) => e.style)).size >= 6, 'shots have measured styles');
  const ordered = featuredFirst(cat);
  assert.ok(ordered.slice(0, 20).every((e) => e.featured));
});
