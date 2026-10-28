// Changelog: CHANGELOG.md is read the way the app reads it; the admin's „Was ist neu?“ wins for its version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changesBetween, mergeChangelog, notesToItems, parseChangelog } from '../src/services/changelog';

const md = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('CHANGELOG.md: every version is recognised, newest first, and the current version has an entry', () => {
  const log = parseChangelog(md);
  assert.ok(log.length >= 8);
  assert.equal(log[0].version, pkg.version, 'write the changes of the new version into CHANGELOG.md');
  for (let i = 1; i < log.length; i++) assert.ok(log[i - 1].version !== log[i].version);
  assert.ok(log.every((e) => e.items.length > 0 && e.items.every((it) => !it.startsWith('-'))));
  assert.equal(log.find((e) => e.version === '1.9.6')!.date, '12.10.2026');
  assert.equal(log.find((e) => e.version === '1.9.5')!.date, null);
  // the intro text above the first version is not a change
  assert.ok(!log.some((e) => e.items.some((it) => it.includes('So erkennt SP Tool'))));
});

test('notes: bullets in any style, plain lines and indented continuations', () => {
  assert.deepEqual(notesToItems('- a\n• b\n* c\n– d\n1. e\nf\n   weiter'), ['a', 'b', 'c', 'd', 'e', 'f weiter']);
  assert.deepEqual(notesToItems('\r\n\n  '), []);
});

test('merge: admin text replaces the changelog of its version, versions only on the server are added', () => {
  const app = parseChangelog('## 1.2.0 – 1.1.2026\n- neu A\n## 1.1.0\n- alt');
  const merged = mergeChangelog([{ version: '1.3.0', notes: 'Nur vom Admin', at: Date.UTC(2026, 9, 12) }, { version: '1.2.0', notes: '- vom Admin' }, { version: '1.1.0', notes: '' }, { version: 'x', notes: 'kaputt' }], app);
  assert.deepEqual(merged.map((e) => [e.version, e.source, e.items]), [['1.3.0', 'admin', ['Nur vom Admin']], ['1.2.0', 'admin', ['vom Admin']], ['1.1.0', 'app', ['alt']]]);
  assert.equal(merged[1].date, '1.1.2026', 'no upload time → the changelog date stays');
  assert.deepEqual(changesBetween(merged, '1.1.0', '1.3.0').map((e) => e.version), ['1.3.0', '1.2.0'], 'everything after the installed version');
  assert.deepEqual(changesBetween(merged, null, '1.2.0').map((e) => e.version), ['1.2.0', '1.1.0']);
});
