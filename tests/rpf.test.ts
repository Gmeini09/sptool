// RPF tests run against the reference archive when SPTOOL_REF_RPF points to it (not shipped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fitStreamAudio, parseAwc, streamToAudio, writeAwc } from '../src/formats/awc';
import { findAwcs, patchAwcInPlace, readRpfHeader, RpfError } from '../src/formats/rpf';

const path = process.env.SPTOOL_REF_RPF;
const has = !!path && existsSync(path);
const skip = has ? false : 'set SPTOOL_REF_RPF to run';

test('reads RPF7 header and detects NG encryption', { skip }, () => {
  const h = readRpfHeader(new Uint8Array(readFileSync(path!)));
  assert.equal(h.encryption, 'ng');
  assert.ok(h.entryCount > 1);
});

test('finds every unencrypted AWC container', { skip }, () => {
  const found = findAwcs(new Uint8Array(readFileSync(path!)));
  const expected = Number(process.env.SPTOOL_REF_AWC_COUNT ?? found.length);
  assert.equal(found.length, expected);
  for (const f of found) assert.equal(f.offset % 512, 0);
});

test('same-size replacement leaves every other byte untouched', { skip }, () => {
  const arc = new Uint8Array(readFileSync(path!));
  const found = findAwcs(arc);
  const target = found.find((f) => f.awc.streams.length > 1)!;
  const s0 = target.awc.streams[0];
  const sr = 44100, len = Math.round(sr * 0.9);
  const tone = new Float32Array(len).map((_, i) => Math.sin((2 * Math.PI * 140 * i) / sr) * Math.exp(-i / 6000));
  const { stream } = fitStreamAudio(s0, { sampleRate: sr, channels: [tone] });
  const newAwc = writeAwc({ ...target.awc, streams: target.awc.streams.map((s) => (s.id === s0.id ? stream : s)) });
  assert.equal(newAwc.length, target.length, 'container size unchanged');
  const out = patchAwcInPlace(arc, target, newAwc);
  assert.equal(out.length, arc.length);
  let diffOutside = 0;
  for (let i = 0; i < arc.length; i++) if (out[i] !== arc[i] && (i < target.offset || i >= target.offset + target.length)) diffOutside++;
  assert.equal(diffOutside, 0, 'no byte outside the container changed');
  assert.ok(readFileSync(path!).equals(Buffer.from(arc)), 'original buffer untouched');
  const back = parseAwc(out.subarray(target.offset, target.offset + target.length));
  const s = back.streams.find((x) => x.id === s0.id)!;
  assert.equal(s.format.samples, s0.format.samples);
  assert.equal(s.format.headroom, s0.format.headroom);
  assert.ok(Math.max(...streamToAudio(s).channels[0].map(Math.abs)) > 0.99);
  for (const o of target.awc.streams) if (o.id !== s0.id) assert.deepEqual(back.streams.find((x) => x.id === o.id)!.data, o.data);
});

test('refuses size-changing patches', { skip }, () => {
  const arc = new Uint8Array(readFileSync(path!));
  const t = findAwcs(arc)[0];
  assert.throws(() => patchAwcInPlace(arc, t, new Uint8Array(t.length + 16)), RpfError);
});

test('rejects non-RPF data', () => {
  assert.throws(() => readRpfHeader(new Uint8Array(32)), RpfError);
});
