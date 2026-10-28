// Built-in SP Tool library: ~620 procedurally generated, royalty-free sounds (synthesis engine 2).
// Deterministic: the same catalog (ids, names, params) is produced on every machine.
import { type LibraryEntry, type SoundType, type Style, type WeaponId } from '../models/types';
import { type SynthKind, type SynthParams, DEFAULT_SYNTH, SYNTH_VERSION, mulberry32 } from '../synth/synth';

export const BUILTIN_LICENSE = 'SP Tool Lizenz für mitgelieferte Sounds – lizenzfrei, prozedural erzeugt';
const CREATOR = 'SP Tool';

type Macro = Partial<Omit<SynthParams, 'kind' | 'seed'>>;

export const FIRE_STYLES: Record<string, Macro> = {
  Clean: { punch: 0.55, bass: 0.4, transient: 0.55, metal: 0.25, tail: 0.35, room: 0.2, noise: 0.35, dynamics: 0.3 },
  Heavy: { punch: 0.85, bass: 0.85, transient: 0.6, metal: 0.35, tail: 0.6, room: 0.35, noise: 0.6, dynamics: 0.6, pitch: -1.5 },
  Deep: { punch: 0.6, bass: 0.9, transient: 0.4, metal: 0.2, tail: 0.7, room: 0.4, noise: 0.5, dynamics: 0.45, pitch: -3.5 },
  Punchy: { punch: 0.95, bass: 0.6, transient: 0.85, metal: 0.3, tail: 0.3, room: 0.2, noise: 0.5, dynamics: 0.55 },
  Competitive: { punch: 0.75, bass: 0.35, transient: 0.9, metal: 0.25, tail: 0.15, room: 0.08, noise: 0.4, dynamics: 0.5, length: 0.75 },
  Realistic: { punch: 0.6, bass: 0.55, transient: 0.6, metal: 0.45, tail: 0.65, room: 0.55, noise: 0.6, dynamics: 0.35 },
  Aggressive: { punch: 0.95, bass: 0.75, transient: 0.85, metal: 0.4, tail: 0.5, room: 0.3, noise: 0.85, dynamics: 0.9 },
  Arcade: { punch: 0.7, bass: 0.3, transient: 0.8, metal: 0.15, tail: 0.25, room: 0.15, noise: 0.3, dynamics: 0.6, pitch: 4 },
  Bass: { punch: 0.65, bass: 1, transient: 0.45, metal: 0.2, tail: 0.5, room: 0.3, noise: 0.45, dynamics: 0.5, pitch: -2 },
  Short: { punch: 0.7, bass: 0.45, transient: 0.7, metal: 0.25, tail: 0.08, room: 0.05, noise: 0.4, dynamics: 0.45, length: 0.6 },
  Sharp: { punch: 0.7, bass: 0.3, transient: 1, metal: 0.4, tail: 0.3, room: 0.2, noise: 0.55, dynamics: 0.5, pitch: 2 },
  Modern: { punch: 0.8, bass: 0.65, transient: 0.7, metal: 0.3, tail: 0.45, room: 0.3, noise: 0.5, dynamics: 0.65 },
  Tactical: { punch: 0.65, bass: 0.5, transient: 0.65, metal: 0.45, tail: 0.3, room: 0.18, noise: 0.45, dynamics: 0.45, pitch: -0.5 },
  Dry: { punch: 0.7, bass: 0.45, transient: 0.7, metal: 0.3, tail: 0.05, room: 0, noise: 0.4, dynamics: 0.4, length: 0.7 },
  Metallic: { punch: 0.6, bass: 0.4, transient: 0.7, metal: 0.95, tail: 0.4, room: 0.25, noise: 0.5, dynamics: 0.45, pitch: 1 },
  // popular in the FiveM scene: a sharp, bright "crack" and the RP city sound with slap-back echo
  Cracky: { punch: 0.8, bass: 0.4, transient: 1, metal: 0.35, tail: 0.3, room: 0.15, noise: 0.85, dynamics: 0.65, pitch: 1 },
  Echo: { punch: 0.75, bass: 0.6, transient: 0.7, metal: 0.3, tail: 0.85, room: 0.45, noise: 0.55, dynamics: 0.5, pitch: -0.5 },
  // in the direction of the community packs (tone profiles measured from them – see TONE_PROFILES)
  Balanced: { punch: 0.75, bass: 0.45, transient: 0.75, metal: 0.35, tail: 0.3, room: 0.15, noise: 0.6, dynamics: 0.55, tone: 'balanced' },
  Dense: { punch: 0.95, bass: 0.55, transient: 0.6, metal: 0.3, tail: 0.3, room: 0.12, noise: 0.6, dynamics: 0.95, tone: 'dense' },
  Bright: { punch: 0.7, bass: 0.3, transient: 1, metal: 0.45, tail: 0.25, room: 0.12, noise: 0.9, dynamics: 0.6, pitch: 1, tone: 'bright' },
  // 1.7.4: loud FiveM-style shots with new layers (city echo, supersonic ring), mono-safe for the game
  Street: { punch: 0.85, bass: 0.55, transient: 0.9, metal: 0.3, tail: 0.4, room: 0.15, noise: 0.8, ring: 0.3, dynamics: 0.7, slaps: 0.75, monoSafe: true, tone: 'balanced' },
  Thunder: { punch: 0.95, bass: 0.9, transient: 0.7, metal: 0.25, tail: 0.55, room: 0.2, noise: 0.6, dynamics: 0.75, pitch: -2, slaps: 0.6, monoSafe: true, tone: 'balanced' },
  Snap: { punch: 0.75, bass: 0.35, transient: 1, metal: 0.4, tail: 0.18, room: 0.08, noise: 0.85, dynamics: 0.7, pitch: 1.5, ring: 0.8, monoSafe: true, tone: 'bright', length: 0.8 },
  Loud: { punch: 1, bass: 0.6, transient: 0.9, metal: 0.3, tail: 0.3, room: 0.1, noise: 0.7, dynamics: 1, ring: 0.35, monoSafe: true, tone: 'dense' },
  Boom: { punch: 1, bass: 1, transient: 0.75, metal: 0.2, tail: 0.45, room: 0.18, noise: 0.6, dynamics: 0.8, pitch: -2.5, slaps: 0.35, monoSafe: true, tone: 'balanced' },
  Crisp: { punch: 0.8, bass: 0.45, transient: 0.95, metal: 0.55, tail: 0.25, room: 0.1, noise: 0.75, dynamics: 0.65, pitch: 0.5, ring: 0.5, monoSafe: true, tone: 'bright' },
  // German gangwar / "Gambo" server taste: very loud, short and dry so shots stay clear in big fights, hard crack + punch
  Gambo: { punch: 0.85, bass: 0.6, transient: 1, metal: 0.3, tail: 0.08, room: 0.04, noise: 0.85, dynamics: 1, ring: 0.2, monoSafe: true, tone: 'gambo', length: 0.6 },
  Gangwar: { punch: 0.95, bass: 0.75, transient: 0.95, metal: 0.25, tail: 0.12, room: 0.05, noise: 0.75, dynamics: 1, monoSafe: true, tone: 'gambo', length: 0.65 },
  Hood: { punch: 0.85, bass: 0.65, transient: 0.95, metal: 0.3, tail: 0.1, room: 0.05, noise: 0.85, dynamics: 0.95, ring: 0.15, slaps: 0.4, monoSafe: true, tone: 'gambo', length: 0.65 },
};

export const SUPPRESSOR_STYLES: Record<string, Macro> = {
  Clean: { punch: 0.5, bass: 0.35, transient: 0.3, metal: 0.4, tail: 0.25, room: 0.1, noise: 0.3, dynamics: 0.2 },
  Deep: { punch: 0.6, bass: 0.85, transient: 0.25, metal: 0.3, tail: 0.4, room: 0.15, noise: 0.4, dynamics: 0.3, pitch: -3 },
  Soft: { punch: 0.3, bass: 0.3, transient: 0.1, metal: 0.25, tail: 0.15, room: 0.05, noise: 0.25, dynamics: 0.1 },
  Dry: { punch: 0.5, bass: 0.35, transient: 0.3, metal: 0.4, tail: 0.02, room: 0, noise: 0.3, dynamics: 0.25, length: 0.7 },
  Realistic: { punch: 0.5, bass: 0.45, transient: 0.35, metal: 0.55, tail: 0.35, room: 0.25, noise: 0.45, dynamics: 0.25 },
  Competitive: { punch: 0.65, bass: 0.3, transient: 0.55, metal: 0.45, tail: 0.1, room: 0.05, noise: 0.35, dynamics: 0.35, length: 0.75 },
  Heavy: { punch: 0.75, bass: 0.75, transient: 0.4, metal: 0.4, tail: 0.4, room: 0.2, noise: 0.5, dynamics: 0.45, pitch: -1.5 },
  Short: { punch: 0.55, bass: 0.35, transient: 0.35, metal: 0.35, tail: 0.05, room: 0.03, noise: 0.3, dynamics: 0.3, length: 0.6 },
  Tactical: { punch: 0.55, bass: 0.45, transient: 0.35, metal: 0.6, tail: 0.2, room: 0.1, noise: 0.35, dynamics: 0.3 },
  Metallic: { punch: 0.5, bass: 0.3, transient: 0.4, metal: 1, tail: 0.25, room: 0.15, noise: 0.35, dynamics: 0.3, pitch: 1.5 },
  Modern: { punch: 0.65, bass: 0.55, transient: 0.45, metal: 0.45, tail: 0.3, room: 0.15, noise: 0.4, dynamics: 0.45 },
  Balanced: { punch: 0.6, bass: 0.4, transient: 0.4, metal: 0.5, tail: 0.15, room: 0.08, noise: 0.4, dynamics: 0.35, tone: 'balanced' },
  Subsonic: { punch: 0.4, bass: 0.45, transient: 0.2, metal: 0.75, tail: 0.1, room: 0.05, noise: 0.3, dynamics: 0.3, monoSafe: true },
  Street: { punch: 0.6, bass: 0.45, transient: 0.45, metal: 0.5, tail: 0.25, room: 0.1, noise: 0.4, dynamics: 0.45, monoSafe: true },
};

const RELOAD_KINDS: Array<{ kind: SynthKind; label: string; de: string; type: SoundType }> = [
  { kind: 'mag_out', label: 'Magazine Out', de: 'Magazin raus', type: 'reload' },
  { kind: 'mag_in', label: 'Magazine In', de: 'Magazin rein', type: 'reload' },
  { kind: 'mag_drop', label: 'Magazine Drop', de: 'Magazin fallen lassen', type: 'reload' },
  { kind: 'mag_tap', label: 'Magazine Tap', de: 'Magazin anklopfen', type: 'reload' },
  { kind: 'slide_pull', label: 'Slide Pull', de: 'Schlitten ziehen', type: 'mechanical' },
  { kind: 'slide_release', label: 'Slide Release', de: 'Schlitten loslassen', type: 'mechanical' },
  { kind: 'chamber', label: 'Chamber', de: 'Durchladen', type: 'mechanical' },
  { kind: 'mech_click', label: 'Mechanical Click', de: 'Mechanik-Klick', type: 'mechanical' },
  { kind: 'reload_finish', label: 'Reload Finish', de: 'Nachladen fertig', type: 'reload' },
  { kind: 'reload_fast', label: 'Fast Reload', de: 'Schnelles Nachladen', type: 'reload' },
  { kind: 'reload_heavy', label: 'Heavy Reload', de: 'Schweres Nachladen', type: 'reload' },
  { kind: 'reload_clean', label: 'Clean Reload', de: 'Sauberes Nachladen', type: 'reload' },
  { kind: 'reload_metallic', label: 'Metallic Reload', de: 'Metallisches Nachladen', type: 'reload' },
  { kind: 'reload_tactical', label: 'Tactical Reload', de: 'Taktisches Nachladen', type: 'reload' },
];

const HANDLING_KINDS: Array<{ kind: SynthKind; label: string; de: string }> = [
  { kind: 'draw', label: 'Weapon Draw', de: 'Waffe ziehen' },
  { kind: 'holster', label: 'Weapon Holster', de: 'Waffe wegstecken' },
  { kind: 'equip', label: 'Equip', de: 'Ausrüsten' },
  { kind: 'inspect', label: 'Inspect', de: 'Ansehen' },
  { kind: 'trigger', label: 'Trigger', de: 'Abzug' },
  { kind: 'dry_fire', label: 'Dry Fire', de: 'Leerschuss' },
  { kind: 'safety', label: 'Safety Click', de: 'Sicherung klicken' },
  { kind: 'mechanical', label: 'Mechanical', de: 'Mechanik' },
  { kind: 'metal_move', label: 'Metal Movement', de: 'Metallbewegung' },
  { kind: 'polymer_move', label: 'Polymer Movement', de: 'Polymerbewegung' },
  { kind: 'grip', label: 'Grip', de: 'Griff' },
  { kind: 'mag_handling', label: 'Magazine Handling', de: 'Magazin-Handhabung' },
];

/** German display label for a sound's `component` (the stored component value stays English). */
export const COMPONENT_LABEL: Record<string, string> = Object.fromEntries([...RELOAD_KINDS, ...HANDLING_KINDS].map((k) => [k.label, k.de]));

const MECH_STYLES: Array<{ style: Style; macro: Macro }> = [
  { style: 'Clean', macro: { metal: 0.45, noise: 0.35, bass: 0.35, room: 0.1 } },
  { style: 'Heavy', macro: { metal: 0.35, noise: 0.55, bass: 0.8, room: 0.2, pitch: -2 } },
  { style: 'Metallic', macro: { metal: 0.95, noise: 0.45, bass: 0.3, room: 0.2, pitch: 1 } },
  { style: 'Tactical', macro: { metal: 0.6, noise: 0.4, bass: 0.45, room: 0.08 } },
  { style: 'Deep', macro: { metal: 0.3, noise: 0.45, bass: 0.7, room: 0.25, pitch: -3.5 } },
  { style: 'Sharp', macro: { metal: 0.75, noise: 0.35, bass: 0.25, room: 0.05, pitch: 2.5 } },
  { style: 'Soft', macro: { metal: 0.2, noise: 0.3, bass: 0.3, room: 0.05, pitch: -1 } },
  { style: 'Realistic', macro: { metal: 0.55, noise: 0.55, bass: 0.5, room: 0.35 } },
  { style: 'Crisp', macro: { metal: 0.8, noise: 0.3, bass: 0.35, room: 0.03, pitch: 1.5 } },
];

export const WEAPONS: Array<{ id: WeaponId; short: string; caliber: number; pitch: number }> = [
  { id: 'pistol', short: 'Pistol', caliber: 0.4, pitch: 0.5 },
  { id: 'pistol_mk2', short: 'MK2', caliber: 0.55, pitch: 0 },
  { id: 'pistol50', short: '.50', caliber: 0.92, pitch: -1.5 },
];

const pad = (n: number) => String(n).padStart(2, '0');

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function params(kind: SynthKind, seed: number, macro: Macro, extra: Macro, jitter: number): SynthParams {
  const r = mulberry32(seed);
  const j = (v: number) => Math.min(1, Math.max(0, v + (r() * 2 - 1) * jitter));
  const base = { ...DEFAULT_SYNTH, ...macro, ...extra };
  return {
    ...base,
    kind,
    seed,
    punch: j(base.punch), bass: j(base.bass), transient: j(base.transient), metal: j(base.metal),
    tail: j(base.tail), room: j(base.room), noise: j(base.noise), dynamics: j(base.dynamics),
    pitch: base.pitch + (r() * 2 - 1) * jitter * 3,
    length: base.length * (1 + (r() * 2 - 1) * jitter * 0.4),
  };
}

function estFireDuration(p: SynthParams) {
  return p.kind === 'suppressed'
    ? (0.22 + p.tail * 0.5 + p.caliber * 0.15) * p.length
    : (0.35 + p.tail * 1.5 + p.caliber * 0.45 + p.room * 0.3) * p.length + (p.slaps ? 0.45 + p.slaps * 0.35 : 0);
}

let cached: LibraryEntry[] | null = null;

export function builtinCatalog(): LibraryEntry[] {
  if (cached) return cached;
  const out: LibraryEntry[] = [];
  const created = Date.UTC(2026, 9, 1);
  const add = (e: Omit<LibraryEntry, 'creator' | 'license' | 'version' | 'createdAt' | 'source' | 'sourceInfo'>) =>
    out.push({ ...e, creator: CREATOR, license: BUILTIN_LICENSE, version: '1.0.0', createdAt: created, source: 'builtin', sourceInfo: `procedural:v${SYNTH_VERSION} seed ${e.synth?.seed}` });

  // all built-in shots are mono-safe since 1.7.4 (FiveM plays them as mono streams – no comb filtering in the game)
  // Fire: 29 styles × 3 weapons × 4 variants = 348
  for (const w of WEAPONS) {
    for (const [style, macro] of Object.entries(FIRE_STYLES)) {
      for (let v = 1; v <= 4; v++) {
        const id = `bi-fire-${w.id}-${style.toLowerCase()}-${v}`;
        const p = params('fire', hashString(id), macro, { caliber: w.caliber, pitch: (macro.pitch ?? 0) + w.pitch, monoSafe: true }, 0.12);
        add({
          id, name: `${style} ${w.short} ${pad(v)}`, weapon: w.id, type: 'fire', style: style as Style,
          tags: [style.toLowerCase(), w.short.toLowerCase(), 'fire'], synth: p, estDuration: estFireDuration(p),
        });
      }
    }
  }
  // Suppressor: 14 styles × 3 weapons × 2 = 84
  for (const w of WEAPONS) {
    for (const [style, macro] of Object.entries(SUPPRESSOR_STYLES)) {
      for (let v = 1; v <= 2; v++) {
        const id = `bi-supp-${w.id}-${style.toLowerCase()}-${v}`;
        const p = params('suppressed', hashString(id), macro, { caliber: w.caliber, pitch: (macro.pitch ?? 0) + w.pitch, monoSafe: true }, 0.1);
        add({
          id, name: `${style} Schalldämpfer ${w.short} ${pad(v)}`, weapon: w.id, type: 'suppressor', style: style as Style,
          tags: [style.toLowerCase(), 'suppressor', w.short.toLowerCase()], synth: p, estDuration: estFireDuration(p),
        });
      }
    }
  }
  // Reload + mechanical: 14 kinds × 9 styles = 126
  for (const k of RELOAD_KINDS) {
    MECH_STYLES.forEach(({ style, macro }, i) => {
      const w = WEAPONS[i % 3];
      const id = `bi-mech-${k.kind}-${style.toLowerCase()}`;
      const p = params(k.kind, hashString(id), { ...macro, dynamics: 0.3, tail: 0.2 }, { caliber: w.caliber }, 0.1);
      add({
        id, name: `${k.de} ${style} ${pad(i + 1)}`, weapon: i % 4 === 3 ? 'universal' : w.id, type: k.type, component: k.label,
        style, tags: [style.toLowerCase(), k.label.toLowerCase(), k.type], synth: p, estDuration: 0.4,
      });
    });
  }
  // Handling: 12 kinds × 5 = 60
  for (const k of HANDLING_KINDS) {
    MECH_STYLES.slice(0, 5).forEach(({ style, macro }, i) => {
      const id = `bi-hand-${k.kind}-${style.toLowerCase()}`;
      const p = params(k.kind, hashString(id), { ...macro, dynamics: 0.25 }, {}, 0.1);
      add({
        id, name: `${k.de} ${style} ${pad(i + 1)}`, weapon: 'universal', type: 'handling', component: k.label,
        style, tags: [style.toLowerCase(), k.label.toLowerCase(), 'handling'], synth: p, estDuration: 0.4,
      });
    });
  }
  cached = out;
  return out;
}
