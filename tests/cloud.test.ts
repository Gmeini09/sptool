import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, contentHash, type CloudProject } from '../src/projects/cloudStatus';
import { newProject } from '../src/projects/project';

const proj = (id: string, name = id) => ({ ...newProject(name, 'me'), id });
const cloud = (id: string, rev: number, deleted = false): CloudProject => ({ id, name: id, rev, updatedAt: 1, size: 10, deleted });

test('content hash ignores timestamps and snapshots, sees real changes', () => {
  const p = proj('prj-a');
  assert.equal(contentHash(p), contentHash({ ...p, updatedAt: 999, snapshots: [{ at: 1, label: 'x', weapons: {} }] }));
  assert.notEqual(contentHash(p), contentHash({ ...p, weapons: { pistol: { fire: { entryId: 'x' } } } }));
  assert.notEqual(contentHash(p), contentHash({ ...p, name: 'other' }));
});

test('every sync status', () => {
  const ps = ['prj-syn', 'prj-mod', 'prj-new', 'prj-con', 'prj-loc', 'prj-del', 'prj-delmod', 'prj-same'].map((id) => proj(id));
  const h = (p: ReturnType<typeof proj>) => contentHash(p);
  const local = ps.map((p) => ({ project: p, hash: h(p) }));
  const meta = {
    'prj-syn': { rev: 2, hash: h(ps[0]) }, 'prj-mod': { rev: 2, hash: 'old' }, 'prj-new': { rev: 1, hash: h(ps[2]) },
    'prj-con': { rev: 1, hash: 'old' }, 'prj-del': { rev: 3, hash: h(ps[5]) }, 'prj-delmod': { rev: 3, hash: 'old' },
  };
  const remote = [cloud('prj-syn', 2), cloud('prj-mod', 2), cloud('prj-new', 2), cloud('prj-con', 2), cloud('prj-del', 4, true), cloud('prj-delmod', 4, true), cloud('prj-same', 1), cloud('prj-only', 1), cloud('prj-gone', 5, true)];
  const st = Object.fromEntries(computeStatus(local, remote, meta).map((r) => [r.id, r.status]));
  assert.deepEqual(st, {
    'prj-syn': 'synced', 'prj-mod': 'modified', 'prj-new': 'cloud-newer', 'prj-con': 'conflict', 'prj-loc': 'local-only',
    'prj-del': 'deleted-in-cloud', 'prj-delmod': 'conflict', 'prj-same': 'conflict', 'prj-only': 'cloud-only',
  });
});

test('deleted here / unlinked are remembered and never auto-synced', () => {
  const p = proj('prj-keep');
  const h = contentHash(p);
  // deleted on this PC: the cloud copy waits for a decision instead of coming back as cloud-only
  let st = computeStatus([], [cloud('prj-gone-here', 3)], { 'prj-gone-here': { rev: 3, hash: 'x', removed: true } });
  assert.equal(st[0].status, 'removed-here');
  // removed from the cloud but kept locally: not 'local-only' (which would upload again)
  st = computeStatus([{ project: p, hash: h }], [cloud('prj-keep', 4, true)], { 'prj-keep': { rev: 4, hash: h, unlinked: true } });
  assert.equal(st[0].status, 'unlinked');
  // another PC uploaded it again meanwhile → normal rules apply
  st = computeStatus([{ project: p, hash: h }], [cloud('prj-keep', 5)], { 'prj-keep': { rev: 4, hash: h, unlinked: true } });
  assert.equal(st[0].status, 'cloud-newer');
});
