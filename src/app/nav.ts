import type { IconName } from '../components/Icon';
import type { Route } from './store';

export interface NavItem {
  route: Route; label: string; icon: IconName; phase?: number; group: string; adminOnly?: boolean;
  /** Only shown in expert view (Settings → Simple view off). */
  advanced?: boolean;
  /** One plain sentence: what you do on this page. Used for tooltips and the page tip. */
  hint: string;
  /** Optional "how it works" in 2–4 short steps, shown in the page tip. */
  steps?: string[];
}

/**
 * Groups follow the way a soundpack is made: pick sounds → put them into the pack → build and install.
 * `phase` marks modules not yet built in this release (shown honestly as planned, expert view only).
 */
export const NAV: NavItem[] = [
  { route: 'home', label: 'Start', icon: 'home', group: 'Start', hint: 'Dein Startpunkt: die Schritte zu deinem ersten Soundpack und woran du zuletzt gearbeitet hast.' },
  { route: 'create', label: 'Soundpack erstellen', icon: 'hammer', group: 'Start', hint: 'Deine Sounds werden zum Soundpack: Pistol → MK2 → .50 → Nachladen → fertig in deinen Downloads.', steps: ['Zieh für jede Pistole einen Sound rein (MP3, WAV, OGG …) – oder hol ihn aus einem Soundpack', 'Nachladen: ganzen Reload-Sound reinziehen oder die Teile einzeln', '„Soundpack erstellen“ speichert WEAPONS_PLAYER.rpf + RESIDENT.rpf in Downloads › SP Tool'] },
  { route: 'projects', label: 'Meine Soundpacks', icon: 'folder', group: 'Start', advanced: true, hint: 'Erstelle ein neues Soundpack oder öffne eins, das du schon angefangen hast.', steps: ['Klick auf „Neues Soundpack“ und gib ihm einen Namen', 'Klick auf „Öffnen“ – du landest in „Soundpack befüllen“', '„Exportieren“ speichert eine Backup-Datei deines Packs'] },
  { route: 'library', label: 'Meine Sounds', icon: 'library', group: 'Sounds', hint: 'Hör dir alle Sounds an. Klick auf Abspielen zum Vorhören und aufs Herz, um einen Favoriten zu merken. In dein Pack kommen die Sounds unter „Soundpack befüllen“.', steps: ['Klick auf ▶ zum Anhören', 'Mit den Filtern zeigst du nur eine Waffe oder einen Stil', 'Einen guten gefunden? Gib ihm ein Herz oder öffne ihn in „Sound bearbeiten“'] },
  { route: 'generator', label: 'Sound erstellen', icon: 'sparkles', group: 'Sounds', advanced: true, hint: 'Erstelle deinen eigenen Schuss: Stil wählen, ein paar Regler bewegen, anhören, speichern.', steps: ['Wähle eine Waffe und einen Stil', 'Klick auf „Sound erzeugen“, dann auf ▶ zum Anhören', 'Nicht ganz richtig? Probier „Sanft variieren“', '„In Bibliothek speichern“ behält ihn'] },
  { route: 'editor', label: 'Sound bearbeiten', icon: 'wave', group: 'Sounds', advanced: true, hint: 'Mach einen Sound lauter, kürzer, heller oder tiefer.', steps: ['Wähle einen Sound aus der Bibliothek', 'Bewege die Regler', 'Vergleiche A (Original) und B (deine Version)', '„Speichern“ behält deine Version als neuen Sound'] },
  { route: 'soundpack', label: 'Soundpack befüllen', icon: 'layers', group: 'Soundpack von Hand', advanced: true, hint: 'Lege fest, welcher Sound für jede Waffe läuft: Schuss, Schalldämpfer, Nachladen und mehr.', steps: ['Wähle eine Waffe', 'Klick auf einen leeren Slot (Schuss, Schalldämpfer, Nachladen …) und wähle einen Sound', 'Mit „Ganzes Pack anhören“ hörst du das Ergebnis'] },
  { route: 'weapons', label: 'Waffen', icon: 'target', group: 'Soundpack von Hand', advanced: true, hint: 'Technische Übersicht der unterstützten Waffen und ihrer Sound-Slots.' },
  { route: 'build', label: 'Bauen', icon: 'hammer', group: 'Soundpack von Hand', advanced: true, hint: 'Macht aus deinem Soundpack die Spieldateien, die FiveM braucht.', steps: ['Prüfe, ob deine Slots befüllt sind', 'Wähle die .rpf-Dateien eines Soundpacks als Basis (WEAPONS_PLAYER.rpf + RESIDENT.rpf)', 'Klick auf „Soundpack bauen“'] },
  { route: 'backups', label: 'Backups', icon: 'archive', group: 'Soundpack von Hand', advanced: true, hint: 'Stell die originalen Spiel-Sounds oder ein früheres Pack mit einem Klick wieder her.', steps: ['Jede Installation legt automatisch ein Backup an', 'Klick auf „Wiederherstellen“, um zu diesem Stand zurückzukehren'] },
  { route: 'cloud', label: 'Cloud', icon: 'cloud', group: 'Konto', advanced: true, hint: 'Deine Soundpacks online gespeichert – auf jedem PC, an dem du dich anmeldest.' },
  { route: 'analyzer', label: 'Pack-Analyse', icon: 'box', group: 'Experte', advanced: true, hint: 'Öffnet vorhandene .rpf-Soundpacks, spielt ihre Sounds ab und ordnet sie Waffen-Slots zu.' },
  { route: 'settings', label: 'Einstellungen', icon: 'settings', group: 'Konto', hint: 'Aussehen, FiveM-Pfad, einfache oder Experten-Ansicht.' },
  { route: 'logs', label: 'Protokoll', icon: 'logs', group: 'Experte', advanced: true, hint: 'Technisches Protokoll dessen, was die App getan hat – hilfreich, wenn du ein Problem meldest.' },
  { route: 'admin', label: 'Admin', icon: 'shield', group: 'Experte', adminOnly: true, hint: 'Lizenzen, Keys, Nutzer und App-Versionen.' },
];

/** Navigation for the current user (admin items only for admins – the server enforces it anyway). */
export const visibleNav = (admin: boolean, simple = false) =>
  NAV.filter((n) => (!n.adminOnly || admin) && (!simple || !n.advanced))
    // the simple menu is one short list: Start, Soundpack erstellen, Meine Sounds, Einstellungen (+ Admin)
    .map((n) => (simple ? { ...n, group: 'SP Tool' } : n));

export const navLabel = (r: Route) => NAV.find((n) => n.route === r)?.label ?? '';
export const navHint = (r: Route) => NAV.find((n) => n.route === r)?.hint ?? '';
