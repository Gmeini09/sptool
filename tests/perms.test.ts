// Licence levels in the app: Free < Premium < Creator < Admin < Developer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
(globalThis as unknown as { localStorage: unknown }).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const P = await import('../src/account/perms');

test('every key can create soundpacks – including importing own sounds', () => {
  for (const f of ['soundpack', 'projects', 'library', 'weapons', 'wavImport'] as const) assert.equal(P.FEATURES[f], 'free', f);
});

test('Premium is more than Free, Creator everything but admin, Admin manages, Developer all', () => {
  const can = (t: (typeof P.TIERS)[number], f: keyof typeof P.FEATURES) => P.tierAtLeast(t, P.FEATURES[f]);
  assert.ok(can('premium', 'editor') && !can('free', 'editor'));
  for (const f of Object.keys(P.FEATURES) as Array<keyof typeof P.FEATURES>) {
    assert.equal(can('creator', f), f !== 'admin', `Creator ${f}`);
    assert.ok(can('admin', f) && can('developer', f), `Admin/Developer ${f}`);
  }
  assert.deepEqual(P.grantablePlans('admin'), ['free', 'premium', 'creator']);
  assert.deepEqual(P.grantablePlans('developer'), ['free', 'premium', 'creator', 'admin', 'developer']);
  assert.deepEqual(P.grantablePlans('creator'), []);
});

test('tickets: "tier" wins (Admin is "developer" in the plan for old apps), unknown is Free', () => {
  assert.equal(P.ticketTier({ plan: 'developer', tier: 'admin' }), 'admin');
  assert.equal(P.ticketTier({ plan: 'developer', tier: 'developer' }), 'developer');
  assert.equal(P.ticketTier({ plan: 'developer' }), 'developer');
  assert.equal(P.ticketTier({ plan: 'premium' }), 'premium');
  assert.equal(P.ticketTier({ plan: 'whatever', tier: 'god' }), 'free');
  assert.equal(P.levelLabel('developer'), 'Developer');
  assert.equal(P.levelLabel('admin'), 'Admin');
});
