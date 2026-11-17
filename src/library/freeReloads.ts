// Free reload recordings from the internet that come with SP Tool (all CC0, see src/assets/free/LICENSES.txt).
// Each one is offered as a whole reload: it plays as ONE sound when the weapon is reloaded.
import type { LibraryEntry } from '../models/types';
import { WHOLE_RELOAD } from './turbo';

const FREE: Array<[id: string, name: string, creator: string, page: string, file: string, dur: number]> = [
  ['free-reload-1', 'Pistole nachladen (Magazin + Schlitten)', 'zer0_sol', 'https://opengameart.org/content/handgun-reload-sound-effect', 'reload-zer0sol.wav', 1.59],
  ['free-reload-2', 'Pistole nachladen (Airsoft)', 'SpringySpringo', 'https://opengameart.org/content/gun-reload-sounds', 'reload-springyspringo.wav', 1.58],
];

let cached: LibraryEntry[] | null = null;
export function freeReloads(): LibraryEntry[] {
  cached ??= FREE.map(([id, name, creator, page, file, dur]) => ({
    id, name, creator, license: 'CC0 1.0 (gemeinfrei)', sourceInfo: page, source: 'builtin', weapon: 'universal',
    type: 'reload', component: WHOLE_RELOAD, style: 'Realistic', tags: ['frei', 'cc0', 'reload'], version: '1.0.0',
    createdAt: Date.UTC(2026, 9, 28), asset: `assets/free/${file}`, estDuration: dur,
  }));
  return cached;
}
