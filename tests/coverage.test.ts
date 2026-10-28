import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/dsp/analysis';
import { renderEdit } from '../src/dsp/chain';
import { makeAudio } from '../src/dsp/types';
import { checkAttachmentCoverage, deriveEdit } from '../src/weapons/coverage';
import { WEAPON_PROFILES } from '../src/weapons/profiles';

test('suppressor is the only attachment on every pistol', () => {
  for (const p of WEAPON_PROFILES) {
    assert.equal(p.attachments.length, 1, p.id);
    assert.equal(p.attachments[0].kind, 'suppressor');
    assert.ok(!p.slots.some((s) => s.id === 'flashlight_toggle'));
    assert.ok(p.attachments.every((a) => /^COMPONENT_[A-Z0-9_]+$/.test(a.component)), p.id);
    assert.ok(p.attachments.some((a) => a.kind === 'suppressor'), `${p.id} has a suppressor`);
    for (const a of p.attachments) for (const s of a.soundSlots) assert.ok(p.slots.some((x) => x.id === s), `${p.id}: slot ${s} exists`);
  }
});

test('untouched weapon raises no attachment issue', () => {
  assert.deepEqual(checkAttachmentCoverage(WEAPON_PROFILES[1], new Set()), []);
});

test('changing fire without a suppressor sound is flagged', () => {
  const mk2 = WEAPON_PROFILES.find((p) => p.id === 'pistol_mk2')!;
  const issues = checkAttachmentCoverage(mk2, new Set(['fire']));
  assert.deepEqual(issues.map((i) => i.slot), ['suppressed_fire']);
  assert.equal(issues.find((i) => i.slot === 'suppressed_fire')!.deriveFrom, 'fire');
});

test('fully covered weapon passes', () => {
  const p = WEAPON_PROFILES[0];
  assert.deepEqual(checkAttachmentCoverage(p, new Set(['fire', 'suppressed_fire'])), []);
});

test('derived suppressor sound is darker and still clean', () => {
  const sr = 44100, a = makeAudio(sr, sr / 2, 2);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < a.channels[0].length; i++) { const v = rnd() * Math.exp(-i / 4000) * 0.8; a.channels[0][i] = v; a.channels[1][i] = v; }
  const out = renderEdit(a, deriveEdit('suppressed_fire')!);
  const hf = (x: Float32Array) => { let s = 0; for (let i = 1; i < x.length; i++) s += Math.abs(x[i] - x[i - 1]); return s / x.length; };
  const r = analyze(out);
  assert.ok(r.peakDb <= -0.9 && !r.clipping);
  assert.ok(hf(out.channels[0]) / Math.max(...out.channels[0].map(Math.abs)) < hf(a.channels[0]) / 0.8 * 0.5, 'high frequencies reduced');
});
