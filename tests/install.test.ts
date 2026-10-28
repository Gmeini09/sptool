import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalArchiveName } from '../src/services/install';

test('archive names are normalised to what FiveM expects', () => {
  const cases: Array<[string, string]> = [
    ['WEAPONS_PLAYER.rpf', 'WEAPONS_PLAYER.rpf'], ['WEAPONS_PLAYER_4.rpf', 'WEAPONS_PLAYER.rpf'], ['WEAPONS_PLAYER_5_7.rpf', 'WEAPONS_PLAYER.rpf'],
    ['weapons_player (2).rpf', 'WEAPONS_PLAYER.rpf'], ['RESIDENT_9303d5.rpf', 'RESIDENT.rpf'], ['RESIDENT__1_.rpf', 'RESIDENT.rpf'],
    ['RESIDENT_5_6.rpf', 'RESIDENT.rpf'], ['resident.rpf', 'RESIDENT.rpf'], ['my_custom.rpf', 'my_custom.rpf'],
  ];
  for (const [i, o] of cases) assert.equal(canonicalArchiveName(i), o, i);
});
