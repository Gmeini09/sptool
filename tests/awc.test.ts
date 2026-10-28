// AWC format tests. The round-trip test runs against real containers when
// SPTOOL_REF_AWC_DIR points to a folder of .awc files (not shipped: game/mod content).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AwcError, computePeakChunk, parseAwc, replaceStreamAudio, streamToAudio, writeAwc } from '../src/formats/awc';

const dir = process.env.SPTOOL_REF_AWC_DIR;
const fixtures = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.awc')).map((f) => join(dir, f)) : [];

test('reference AWCs round-trip byte-identically', { skip: fixtures.length ? false : 'set SPTOOL_REF_AWC_DIR to run' }, () => {
  let streams = 0;
  for (const f of fixtures) {
    const bytes = new Uint8Array(readFileSync(f));
    const awc = parseAwc(bytes);
    streams += awc.streams.length;
    const out = writeAwc(awc);
    assert.equal(out.length, bytes.length, `${f} length`);
    const firstDiff = out.findIndex((b, i) => b !== bytes[i]);
    assert.equal(firstDiff, -1, `${f} differs at byte ${firstDiff}`);
  }
  console.log(`  ${fixtures.length} containers, ${streams} streams identical`);
});

test('replacing a stream produces a valid, re-parsable container', { skip: fixtures.length ? false : 'set SPTOOL_REF_AWC_DIR to run' }, () => {
  const awc = parseAwc(new Uint8Array(readFileSync(fixtures[1])));
  const target = awc.streams[0];
  const sr = 44100, n = sr; // 1 s test tone
  const ch = new Float32Array(n).map((_, i) => 0.4 * Math.sin((2 * Math.PI * 180 * i) / sr) * Math.exp(-i / 8000));
  const repl = replaceStreamAudio(target, { sampleRate: sr, channels: [ch, ch] });
  const next = writeAwc({ ...awc, streams: awc.streams.map((s) => (s.id === target.id ? repl : s)) });
  const back = parseAwc(next);
  const s = back.streams.find((x) => x.id === target.id)!;
  assert.equal(s.format.sampleRate, target.format.sampleRate, 'keeps original sample rate');
  assert.equal(s.format.headroom, target.format.headroom, 'keeps headroom');
  assert.equal(s.format.samples * 2, s.data.length);
  assert.ok(Math.abs(s.format.samples - Math.round(n * target.format.sampleRate / sr)) <= 1);
  const a = streamToAudio(s);
  assert.ok(Math.max(...a.channels[0].map(Math.abs)) > 0.99, 'normalised to full scale like the reference');
  assert.equal(back.streams.length, awc.streams.length);
  for (const o of awc.streams) if (o.id !== target.id) assert.deepEqual(back.streams.find((x) => x.id === o.id)!.data, o.data, 'other streams untouched');
});

test('peak chunk formula', () => {
  const pcm = new Int16Array(4096 * 3 + 10);
  pcm[5000] = -1234; pcm[9000] = 20000;
  const pk = computePeakChunk(pcm)!;
  const v = new DataView(pk.buffer);
  assert.equal(pk.length, 4);
  assert.equal(v.getUint16(0, true), 2468);
  assert.equal(v.getUint16(2, true), 40000);
});

test('rejects non-AWC data', () => {
  assert.throws(() => parseAwc(new Uint8Array(64)), AwcError);
});

test('joaat matches the GTA reference value', async () => {
  const { joaat, KNOWN_STREAM_NAMES, streamHash } = await import('../src/formats/knownNames');
  assert.equal(joaat('weapon_pistol'), 0x1b06d571);
  assert.equal(streamHash('PTL_PISTOL_FAR_1'), 0x1e2137c5);
  assert.equal(KNOWN_STREAM_NAMES.size, 24);
});
