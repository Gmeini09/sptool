import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, integratedLufs } from '../src/dsp/analysis';
import { biquadCoeffs, biquadMagnitudeDb } from '../src/dsp/biquad';
import { SUPPRESSOR_DERIVE, applyRegions, freshEdit, mergeEdit, renderEdit } from '../src/dsp/chain';
import { limit } from '../src/dsp/dynamics';
import { pitchShift, changeSpeed } from '../src/dsp/stretch';
import { makeAudio, lengthOf } from '../src/dsp/types';
import { decodeWav, encodeWav, WavError } from '../src/dsp/wav';

const sine = (freq: number, sec: number, amp = 0.5, sr = 48000) => {
  const a = makeAudio(sr, Math.round(sec * sr), 2);
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) ch[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return a;
};

test('WAV 16/24/32f round trip', () => {
  const a = sine(440, 0.1);
  for (const [bits, float] of [[16, false], [24, false], [32, true]] as const) {
    const b = decodeWav(encodeWav(a, bits, float));
    assert.equal(b.sampleRate, 48000);
    assert.equal(b.channels.length, 2);
    assert.equal(lengthOf(b), lengthOf(a));
    const err = Math.max(...Array.from(b.channels[0]).map((v, i) => Math.abs(v - a.channels[0][i])));
    assert.ok(err < (bits === 16 ? 1e-4 : 1e-6), `error ${err} for ${bits}`);
  }
});

test('WAV decoder rejects garbage', () => {
  assert.throws(() => decodeWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), WavError);
});

test('LUFS of 997 Hz sine at -20 dBFS ≈ -23 LUFS (BS.1770 reference)', () => {
  // A full-scale-referenced sine at amplitude 0.1 per channel, stereo → about -20 LUFS + 3 dB for 2 ch... use mono-equivalent check
  const a = sine(997, 3, Math.pow(10, -20 / 20));
  const l = integratedLufs(a);
  // Stereo sine at -20 dBFS peak: -20 -3 (RMS) +3 (two channels) -0.691+0.691 ≈ -20.0 (K-weight ≈ 0 dB at 1 kHz)
  assert.ok(Math.abs(l - -20) < 0.3, `got ${l}`);
});

test('biquad shelf gain matches spec at extremes', () => {
  const c = biquadCoeffs('lowshelf', 48000, 120, 0.707, 6);
  assert.ok(Math.abs(biquadMagnitudeDb(c, 48000, 20) - 6) < 0.6);
  assert.ok(Math.abs(biquadMagnitudeDb(c, 48000, 10000)) < 0.2);
});

test('limiter keeps peaks under ceiling', () => {
  const a = sine(200, 0.3, 1.8);
  limit(a, -1);
  assert.ok(analyze(a).peakDb <= -0.99);
});

test('regions: trim + cut remove the right amount', () => {
  const a = sine(100, 1);
  const e = mergeEdit(freshEdit(), { trimStart: 0.1, trimEnd: 0.9, cuts: [{ start: 0.4, end: 0.5 }] });
  const r = applyRegions(a, e);
  assert.equal(lengthOf(r), Math.round(0.7 * 48000));
});

test('pitch shift keeps duration, speed changes it', () => {
  const a = sine(440, 0.5);
  assert.equal(lengthOf(pitchShift(a, 5)), lengthOf(a));
  assert.ok(Math.abs(lengthOf(changeSpeed(a, 2)) - lengthOf(a) / 2) <= 1);
});

test('the suppressor derivation renders finite audio without clipping', () => {
  const a = sine(150, 0.6, 0.9);
  const s = analyze(renderEdit(a, mergeEdit(freshEdit(), SUPPRESSOR_DERIVE)));
  assert.ok(Number.isFinite(s.peakDb));
  assert.ok(s.peakDb <= -0.7, `peak ${s.peakDb}`);
});

test('render never mutates the original (non-destructive)', () => {
  const a = sine(300, 0.2);
  const copy = new Float32Array(a.channels[0]);
  renderEdit(a, mergeEdit(freshEdit(), { gainDb: 6, reverb: { enabled: true, room: 0.5, damping: 0.5, mix: 0.3 } }));
  assert.deepEqual(a.channels[0], copy);
});
