import pistol from '../../weapon_profiles/pistol.json';
import pistolMk2 from '../../weapon_profiles/pistol_mk2.json';
import pistol50 from '../../weapon_profiles/pistol50.json';
import type { WeaponProfile } from '../models/types';

/** German display labels for slot ids (the JSON data files keep their English labels). */
const SLOT_LABEL_DE: Record<string, string> = {
  fire: 'Schuss',
  suppressed_fire: 'Schuss mit Schalldämpfer',
  mag_out: 'Magazin raus',
  mag_in: 'Magazin rein',
  slide: 'Schlitten',
  reload_finish: 'Nachladen fertig',
  dry_fire: 'Leerschuss',
  draw: 'Ziehen',
  holster: 'Wegstecken',
};

/** German display texts for attachments, by kind. */
const ATTACHMENT_DE: Record<string, { label: string; note: string }> = {
  suppressor: {
    label: 'Schalldämpfer',
    note: 'Der einzige unterstützte Aufsatz. Sein Sound ist in jedem Soundpack enthalten, sonst spielt das Spiel mit Schalldämpfer den Original-Sound.',
  },
};

function localize(p: WeaponProfile): WeaponProfile {
  return {
    ...p,
    slots: p.slots.map((s) => ({ ...s, label: SLOT_LABEL_DE[s.id] ?? s.label })),
    attachments: p.attachments.map((a) => ({ ...a, ...(ATTACHMENT_DE[a.kind] ?? {}) })),
  };
}

/** Weapon profiles are data files (weapon_profiles/*.json); add a file + import to support a new weapon. */
export const WEAPON_PROFILES: WeaponProfile[] = ([pistol, pistolMk2, pistol50] as WeaponProfile[]).map(localize);
