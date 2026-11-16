import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinCatalog } from '../src/library/catalog';
import { addSnapshot, assign, autoPack, deriveSlot, filledCount, newProject, parseProjectFile, ProjectFileError, restoreSnapshot, slotMatches, validateProject, PROJECT_FORMAT, PROJECT_VERSION } from '../src/projects/project';
import { WEAPON_PROFILES } from '../src/weapons/profiles';

const lib = builtinCatalog();
const mk2 = WEAPON_PROFILES.find((p) => p.id === 'pistol_mk2')!;

// the kill sound is always the user's own import – the built-in library has none
const weaponSlots = (prof: (typeof WEAPON_PROFILES)[number]) => prof.slots.filter((s) => s.type !== 'kill');

test('every weapon slot of every pistol has library sounds', () => {
  for (const prof of WEAPON_PROFILES) for (const s of weaponSlots(prof)) {
    assert.ok(lib.some((e) => slotMatches(e, prof.id, s.id)), `${prof.id}/${s.id}`);
  }
});

test('auto pack fills all slots in the chosen style and passes validation', () => {
  const p = autoPack(newProject('Heavy', 'me'), WEAPON_PROFILES, lib, 'Heavy', ['pistol', 'pistol_mk2', 'pistol50'], 7);
  for (const prof of WEAPON_PROFILES) assert.equal(filledCount(p, prof), weaponSlots(prof).length, prof.id);
  const fire = lib.find((e) => e.id === p.weapons.pistol_mk2!.fire.entryId)!;
  assert.equal(fire.style, 'Heavy');
  assert.equal(fire.weapon, 'pistol_mk2');
  assert.ok(validateProject(p, WEAPON_PROFILES).ok);
});

test('fire without suppressor fails validation; deriving fixes it', () => {
  let p = assign(newProject('x', 'me'), 'pistol_mk2', 'fire', { entryId: 'bi-fire-pistol_mk2-heavy-4' });
  const v = validateProject(p, WEAPON_PROFILES);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((x) => x.slot === 'suppressed_fire' && x.fix === 'derive'));
  p = deriveSlot(p, 'pistol_mk2', 'suppressed_fire');
  const a = p.weapons.pistol_mk2!.suppressed_fire;
  assert.equal(a.entryId, 'bi-fire-pistol_mk2-heavy-4');
  assert.equal(a.derivedFrom, 'fire');
  assert.ok(a.edit?.lowpass.enabled);
  assert.ok(validateProject(p, WEAPON_PROFILES).ok, JSON.stringify(validateProject(p, WEAPON_PROFILES).problems));
  assert.equal(filledCount(p, mk2), 2);
});

test('snapshots restore and keep a backup', () => {
  let p = assign(newProject('x', 'me'), 'pistol', 'fire', { entryId: 'a' });
  p = addSnapshot(p, 'one');
  p = assign(p, 'pistol', 'fire', { entryId: 'b' });
  const r = restoreSnapshot(p, p.snapshots[0].at);
  assert.equal(r.weapons.pistol!.fire.entryId, 'a');
  assert.equal(r.snapshots[0].label, 'Vor dem Wiederherstellen');
  assert.equal(r.snapshots[0].weapons.pistol!.fire.entryId, 'b');
});

test('project file parsing validates input', () => {
  const p = assign(newProject('Turbo', 'me'), 'pistol50', 'fire', { entryId: 'x' });
  const ok = parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, project: p, entries: [], blobs: {} }));
  assert.equal(ok.project.name, 'Turbo');
  assert.equal(ok.project.weapons.pistol50!.fire.entryId, 'x');
  assert.throws(() => parseProjectFile('nope'), ProjectFileError);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: 'other' })), ProjectFileError);
  assert.throws(() => parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, version: 99, project: p })), ProjectFileError);
  const bad = parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, version: 1, project: { ...p, weapons: { evil_gun: { fire: { entryId: 'x' } }, pistol: { fire: { nope: 1 } } } } }));
  assert.deepEqual(Object.keys(bad.project.weapons), ['pistol']);
  assert.deepEqual(bad.project.weapons.pistol, {});
});
