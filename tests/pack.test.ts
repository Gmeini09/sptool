// Multi-archive tests against the reference pack (not shipped). Set SPTOOL_REF_RPF and
// SPTOOL_REF_RPF2 to two archives of the same pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fitStreamAudio, parseAwc } from '../src/formats/awc';
import { exportPack, openPack } from '../src/formats/pack';

const a = process.env.SPTOOL_REF_RPF, b = process.env.SPTOOL_REF_RPF2;
const skip = a && b && existsSync(a) && existsSync(b) ? false : 'set SPTOOL_REF_RPF and SPTOOL_REF_RPF2 to run';
const load = () => openPack([a!, b!].map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) })));

test('detects containers shared between archives', { skip }, () => {
  const pack = load();
  const shared = pack.groups.filter((g) => new Set(g.refs.map((r) => r.archive)).size > 1);
  console.log(`  ${pack.groups.length} unique containers, ${shared.length} shared by both archives`);
  assert.equal(shared.length, Number(process.env.SPTOOL_REF_SHARED ?? shared.length));
  assert.ok(shared.length > 0);
});

test('replacing a stream in a shared container patches every copy identically', { skip }, () => {
  const pack = load();
  const g = pack.groups.find((x) => new Set(x.refs.map((r) => r.archive)).size > 1)!;
  const s0 = g.awc.streams[0];
  const tone = new Float32Array(30000).map((_, i) => Math.sin(i / 7) * Math.exp(-i / 5000));
  const { stream } = fitStreamAudio(s0, { sampleRate: 44100, channels: [tone] });
  const outs = exportPack(pack, new Map([[g.id, new Map([[s0.id, stream]])]]));
  assert.equal(outs.length, 2, 'both archives exported');
  const copies = g.refs.map((r) => {
    const o = outs.find((x) => x.name === pack.archives[r.archive].name)!;
    assert.equal(o.bytes.length, pack.archives[r.archive].bytes.length, 'archive size unchanged');
    return o.bytes.subarray(r.offset, r.offset + r.length);
  });
  for (const c of copies.slice(1)) assert.ok(Buffer.from(c).equals(Buffer.from(copies[0])), 'all copies identical');
  const back = parseAwc(copies[0]).streams.find((x) => x.id === s0.id)!;
  assert.notDeepEqual(back.data, s0.data, 'stream really replaced');
  // originals untouched
  assert.ok(Buffer.from(pack.archives[0].bytes).equals(readFileSync(a!)));
});

test('unshared container only touches its own archive', { skip }, () => {
  const pack = load();
  const g = pack.groups.find((x) => x.refs.length === 1)!;
  const s0 = g.awc.streams[0];
  const { stream } = fitStreamAudio(s0, { sampleRate: 44100, channels: [new Float32Array(1000).fill(0.2)] });
  const outs = exportPack(pack, new Map([[g.id, new Map([[s0.id, stream]])]]));
  assert.equal(outs.length, 1);
  assert.equal(outs[0].name, pack.archives[g.refs[0].archive].name);
});
