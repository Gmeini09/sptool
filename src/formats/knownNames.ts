// Stream names confirmed against the reference soundpack: each name's 29-bit Jenkins hash
// matches a stream id, and only names that are part of a consistent series are listed
// (single random hash matches are rejected). See docs/REFERENCE_ANALYSIS.md.

export function joaat(s: string): number {
  let h = 0;
  const t = s.toLowerCase();
  for (let i = 0; i < t.length; i++) {
    h = (h + t.charCodeAt(i)) >>> 0;
    h = (h + (h << 10)) >>> 0;
    h = (h ^ (h >>> 6)) >>> 0;
  }
  h = (h + (h << 3)) >>> 0;
  h = (h ^ (h >>> 11)) >>> 0;
  h = (h + (h << 15)) >>> 0;
  return h;
}

export const streamHash = (name: string) => joaat(name) & 0x1fffffff;

const CONFIRMED = [
  'PTL_PISTOL_MID_1', 'PTL_PISTOL_MID_2', 'PTL_PISTOL_FAR_1', 'PTL_PISTOL_FAR_2',
  'PISTOL_DRY_FIRE_01', 'SMG_DRY_FIRE_01', 'RIFLE_DRY_FIRE_01', 'SHOTGUN_DRY_FIRE_01',
  'PISTOL_IMPACT_01', 'PISTOL_IMPACT_02', 'PISTOL_IMPACT_04', 'PISTOL_IMPACT_05', 'PISTOL_IMPACT_06',
  'PISTOL_IMPACT_08', 'PISTOL_IMPACT_09', 'PISTOL_IMPACT_11',
  'SMG_IMPACT_01', 'SMG_IMPACT_03', 'SMG_IMPACT_04', 'SMG_IMPACT_06', 'SMG_IMPACT_08', 'SMG_IMPACT_12',
  'SMG_IMPACT_14', 'SMG_IMPACT_15',
];

export const KNOWN_STREAM_NAMES: ReadonlyMap<number, string> = new Map(CONFIRMED.map((n) => [streamHash(n), n]));
