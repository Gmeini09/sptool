import type { EditState } from '../dsp/chain';
import type { SynthParams } from '../synth/synth';

export type WeaponId = 'pistol' | 'pistol_mk2' | 'pistol50';
export type SoundType = 'fire' | 'suppressor' | 'reload' | 'mechanical' | 'handling';
export type Style =
  | 'Clean' | 'Heavy' | 'Deep' | 'Punchy' | 'Competitive' | 'Realistic' | 'Aggressive' | 'Arcade' | 'Bass'
  | 'Short' | 'Sharp' | 'Modern' | 'Tactical' | 'Dry' | 'Metallic' | 'Soft' | 'Fast' | 'Cracky' | 'Echo' | 'Balanced' | 'Dense' | 'Bright'
  | 'Street' | 'Thunder' | 'Snap' | 'Loud' | 'Boom' | 'Crisp' | 'Subsonic' | 'Gambo' | 'Gangwar' | 'Hood';

export type SoundSource = 'builtin' | 'generated' | 'imported' | 'edit' | 'marketplace';

export interface SoundStats {
  duration: number;
  peakDb: number;
  lufs: number;
}

export interface LibraryEntry {
  id: string;
  name: string;
  creator: string;
  license: string;
  /** human readable provenance, e.g. "procedural:v1 seed 42" */
  sourceInfo: string;
  source: SoundSource;
  weapon: WeaponId | 'universal';
  type: SoundType;
  /** sub-kind inside a type, e.g. "Magazine Out" */
  component?: string;
  style: Style;
  tags: string[];
  version: string;
  createdAt: number;
  /** how to obtain audio */
  synth?: SynthParams;
  /** imported audio lives in IndexedDB under this key */
  blobKey?: string;
  /** bundled audio file (Turbo sounds), relative to the app */
  asset?: string;
  /** recommended Turbo sound – listed first */
  featured?: boolean;
  /** non-destructive edit of another entry */
  edit?: { baseId: string; state: EditState; markers?: number[] };
  /** cleared from the import list in "Soundpack erstellen" – kept only because a saved soundpack still uses it */
  hidden?: boolean;
  /** estimate before first render; replaced by real stats once analysed */
  estDuration: number;
}

export interface WeaponProfile {
  id: WeaponId;
  displayName: string;
  internalName: string;
  shortName: string;
  previewModel: string | null;
  slots: { id: string; label: string; type: SoundType; required: boolean }[];
  audioContainer: string | null;
  installMapping: unknown | null;
  supportedFeatures: string[];
  formatStatus: string;
  attachments: WeaponAttachment[];
}

export interface WeaponAttachment {
  /** GTA V component name, e.g. COMPONENT_AT_PI_SUPP_02 */
  component: string;
  label: string;
  kind: 'suppressor';
  /** sound slots used while this attachment is equipped */
  soundSlots: string[];
  note: string;
}

export const WEAPON_LABEL: Record<WeaponId | 'universal', string> = {
  pistol: 'Pistol',
  pistol_mk2: 'Pistol MK2',
  pistol50: 'Pistol .50',
  universal: 'Universell',
};

export const TYPE_LABEL: Record<SoundType, string> = {
  fire: 'Schuss',
  suppressor: 'Schalldämpfer',
  reload: 'Nachladen',
  mechanical: 'Mechanik',
  handling: 'Handhabung',
};
