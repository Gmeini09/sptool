import { test } from 'node:test';
import assert from 'node:assert/strict';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { compareWithMods, sha256Hex } = await import('../src/services/modsCheck');

const built = [{ name: 'WEAPONS_PLAYER.rpf', sha256: 'new-wp' }, { name: 'RESIDENT.rpf', sha256: 'new-rs' }];
const f = (path: string, sha256: string, modified = 1) => ({ path, name: path.split('\\').pop()!, depth: path.split('\\').length - 1, size: 1, modified, sha256 });

test('both new files directly in mods → ok', () => {
  const r = compareWithMods(built, { modsDir: 'M', running: false, files: [f('WEAPONS_PLAYER.rpf', 'new-wp'), f('RESIDENT.rpf', 'new-rs')] });
  assert.ok(r.allOk);
});
test('old pack still at top, new one in a subfolder, a renamed copy, FiveM running', () => {
  const r = compareWithMods(built, { modsDir: 'M', running: true, files: [f('WEAPONS_PLAYER.rpf', 'old'), f('testest\\WEAPONS_PLAYER.rpf', 'new-wp'), f('RESIDENT (2).rpf', 'new-rs')] });
  assert.equal(r.allOk, false);
  assert.deepEqual(r.files.map((x) => x.state.kind), ['subfolder', 'renamed']);
  assert.ok(r.running);
});
test('old file only / missing', () => {
  const r = compareWithMods(built, { modsDir: 'M', running: false, files: [f('weapons_player.rpf', 'old', 5)] });
  assert.deepEqual(r.files.map((x) => x.state), [{ kind: 'old', modified: 5 }, { kind: 'missing' }]);
});
test('sha256Hex', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
