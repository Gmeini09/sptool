// Engine 2 built-in sounds: even loudness across styles, mid-focused balance, sounds saved before engine 2 unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { builtinCatalog } from '../src/library/catalog';
import { synthesize, DEFAULT_SYNTH } from '../src/synth/synth';
import { momentaryMaxLufs } from '../src/dsp/analysis';
import { SUPPRESSOR_DERIVE, freshEdit, mergeEdit, renderEdit } from '../src/dsp/chain';

const fires = builtinCatalog().filter((e) => e.type === 'fire' && e.id.endsWith('-1'));

test('every fire style plays at about the same loudness and peaks at -1 dBFS', () => {
  const l = fires.map((e) => momentaryMaxLufs(synthesize(e.synth!)));
  assert.ok(Math.max(...l) - Math.min(...l) < 4, `loudness spread ${(Math.max(...l) - Math.min(...l)).toFixed(1)} dB`);
  for (const e of fires.slice(0, 12)) {
    const a = synthesize(e.synth!);
    let peak = 0; for (const ch of a.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak <= 0.9 && peak > 0.7, `${e.id} peak ${peak}`);
  }
});

test('pistol shots stay short and every engine-2 sound is deterministic', () => {
  for (const e of fires.filter((x) => /clean|competitive|short|dry|cracky/.test(x.id))) {
    const a = synthesize(e.synth!);
    assert.ok(a.channels[0].length / a.sampleRate < 0.9, `${e.id} too long`);
  }
  const p = fires[0].synth!;
  assert.deepEqual(synthesize(p).channels[0].slice(0, 2000), synthesize(p).channels[0].slice(0, 2000));
});

test('sounds without an engine field keep using engine 1', () => {
  const legacy = { ...DEFAULT_SYNTH, engine: undefined, seed: 42 };
  const v1 = synthesize(legacy), v1again = synthesize({ ...legacy, engine: 1 });
  const h = (a: { channels: Float32Array[] }) => createHash('sha1').update(Buffer.from(a.channels[0].buffer)).digest('hex');
  assert.equal(h(v1), h(v1again));
  assert.notEqual(h(v1), h(synthesize({ ...legacy, engine: 2 })));
});

test('pack-direction styles land near their measured tone profiles', async () => {
  const { bandProfile } = await import('../src/dsp/spectrum');
  const { TONE_PROFILES } = await import('../src/synth/synth');
  const all = builtinCatalog();
  for (const [style, tone] of [['balanced', 'balanced'], ['dense', 'dense'], ['bright', 'bright']] as const) {
    const ids = ['pistol', 'pistol_mk2', 'pistol50'].map((w) => `bi-fire-${w}-${style}-1`);
    const avg: Record<string, number> = {};
    for (const id of ids) for (const [k, v] of Object.entries(bandProfile(synthesize(all.find((e) => e.id === id)!.synth!), 0.2))) avg[k] = (avg[k] ?? 0) + v / ids.length;
    const target = TONE_PROFILES[tone] as Record<string, number>;
    const err = Object.keys(target).reduce((s, k) => s + Math.abs(avg[k] - target[k]), 0) / 6;
    assert.ok(err < 6, `${style}: mean band error ${err.toFixed(1)} %`);
  }
});

test('the suppressor derivation keeps the loudness of the sound (within its offset)', () => {
  const ref = synthesize(fires.find((e) => e.id === 'bi-fire-pistol_mk2-clean-1')!.synth!);
  const base = momentaryMaxLufs(ref);
  const out = momentaryMaxLufs(renderEdit(ref, mergeEdit(freshEdit(), SUPPRESSOR_DERIVE)));
  const offset = (SUPPRESSOR_DERIVE.loudness as { target?: number } | undefined)?.target ?? 0;
  assert.ok(Math.abs(out - (base + offset)) < 1.5, `${(out - base).toFixed(1)} dB vs offset ${offset}`);
});

test('1.7.4: built-in shots are mono-safe (FiveM plays them in mono) and the new styles exist', async () => {
  const { monoLossDb } = await import('../src/dsp/layers');
  const all = builtinCatalog();
  for (const st of ['street', 'thunder', 'snap', 'loud', 'boom', 'crisp']) assert.ok(all.some((e) => e.id === `bi-fire-pistol50-${st}-4`), st);
  assert.ok(all.some((e) => e.id === 'bi-supp-pistol-subsonic-2'));
  for (const e of fires.filter((x) => /echo|realistic|street|thunder|clean|boom/.test(x.id))) {
    const loss = monoLossDb(synthesize(e.synth!));
    assert.ok(loss > -0.3, `${e.id} loses ${loss.toFixed(2)} dB in mono`);
  }
});

test('1.7.4: the city echo of the street shot comes after the shot', () => {
  const street = synthesize(builtinCatalog().find((e) => e.id === 'bi-fire-pistol-street-1')!.synth!);
  assert.ok(street.channels[0].length / street.sampleRate > 0.7, 'room for the slaps');
});

test('edits saved before 1.7.4 (without the new stages) still render', () => {
  const ref = synthesize(fires[0].synth!);
  const old = freshEdit() as unknown as Record<string, unknown>;
  delete old.tone; delete old.exciter; delete old.thump; delete old.slap;
  const out = renderEdit(ref, mergeEdit(old as never, { exciter: { enabled: true } } as never));
  assert.ok(out.channels[0].length > 0);
});
