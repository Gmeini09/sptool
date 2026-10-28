// Attachment coverage: a soundpack that changes a weapon must also cover every sound slot an
// attachment switches to. Otherwise, with e.g. a suppressor equipped, the game plays the
// original sound (or a stale copy) and the pack "bugs". The build refuses such packs unless
// the missing slots are filled – optionally derived automatically from the base sound.
import { SUPPRESSOR_DERIVE, mergeEdit, freshEdit, type EditState } from '../dsp/chain';
import type { WeaponAttachment, WeaponProfile } from '../models/types';

export interface CoverageIssue {
  weapon: string;
  attachment: WeaponAttachment;
  slot: string;
  slotLabel: string;
  /** slot the missing sound can be derived from */
  deriveFrom: string | null;
  message: string;
}

/** Slot a derived attachment sound is made from. */
export const DERIVE_FROM: Record<string, string> = { suppressed_fire: 'fire' };

/** Edit recipe that turns a normal shot into a plausible suppressed shot. */
export { SUPPRESSOR_DERIVE };

export function deriveEdit(slot: string, base: EditState = freshEdit()): EditState | null {
  if (slot === 'suppressed_fire') return mergeEdit(base, SUPPRESSOR_DERIVE);
  return null;
}

/**
 * @param assigned slot ids that the pack provides a sound for (for this weapon)
 */
export function checkAttachmentCoverage(profile: WeaponProfile, assigned: ReadonlySet<string>): CoverageIssue[] {
  const touchesWeapon = profile.slots.some((s) => assigned.has(s.id));
  if (!touchesWeapon) return []; // weapon untouched → original sounds stay consistent
  const issues: CoverageIssue[] = [];
  for (const att of profile.attachments) {
    for (const slot of att.soundSlots) {
      if (assigned.has(slot)) continue;
      const label = profile.slots.find((s) => s.id === slot)?.label ?? slot;
      const from = DERIVE_FROM[slot] && assigned.has(DERIVE_FROM[slot]) ? DERIVE_FROM[slot] : null;
      issues.push({
        weapon: profile.displayName,
        attachment: att,
        slot,
        slotLabel: label,
        deriveFrom: from,
        message: `${profile.displayName}: „${label}“ hat keinen Sound. Mit ${att.label} würde das Spiel den Original-Sound abspielen.`,
      });
    }
  }
  // de-duplicate slots shared by several attachments
  return issues.filter((x, i) => issues.findIndex((y) => y.slot === x.slot) === i);
}
