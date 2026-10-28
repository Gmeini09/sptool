// Inhalte des Anleitungs-Panels: pro Seite eine ausführliche Erklärung und dazu Kapitel zum ganzen Ablauf.
import type { Route } from './store';

export interface Guide {
  title: string;
  intro: string;
  steps?: string[];
  tips?: string[];
  problems?: Array<{ q: string; a: string }>;
  next?: { label: string; route: Route };
}

export const PAGE_GUIDE: Partial<Record<Route, Guide>> = {
  home: {
    title: 'Startseite',
    intro: 'Hier siehst du auf einen Blick, wie weit dein Soundpack ist. Die vier Schritte in der Mitte führen dich vom leeren Pack bis zum fertigen Sound in FiveM – erledigte Schritte bekommen einen Haken.',
    steps: [
      'Klick auf den hervorgehobenen Schritt – er bringt dich genau dorthin, wo es weitergeht.',
      'Rechts siehst du, ob FiveM und GTA V auf deinem PC gefunden wurden.',
      'Unten findest du zuletzt gespielte Sounds und deine Soundpacks.',
    ],
    tips: ['Mit Strg K suchst du überall gleichzeitig: Sounds, Seiten und Einstellungen.'],
    next: { label: 'Soundpack anlegen', route: 'projects' },
  },
  projects: {
    title: 'Meine Soundpacks',
    intro: 'Ein Soundpack ist deine Sammlung von Waffensounds. Du kannst beliebig viele anlegen – zum Beispiel eins für „laut und knackig“ und eins für „realistisch“.',
    steps: [
      'Klick auf „Neues Soundpack“ und gib einen Namen ein.',
      'Klick bei deinem Pack auf „Öffnen“ – du landest in „Soundpack befüllen“.',
      '„Exportieren“ speichert dein Pack als .spproject-Datei, z. B. als Sicherung oder zum Weitergeben.',
    ],
    tips: ['Alles wird automatisch gespeichert – es gibt keinen Speichern-Knopf, den du vergessen kannst.', 'Mit „Duplizieren“ probierst du eine Variante aus, ohne dein Original zu verändern.'],
    next: { label: 'Soundpack befüllen', route: 'soundpack' },
  },
  library: {
    title: 'Sound-Bibliothek',
    intro: 'Hier liegen alle deine Sounds: selbst erstellte, bearbeitete und importierte. Jeder Sound ist eine Karte mit Wellenform.',
    steps: [
      'Klick auf ▶ auf einer Karte, um den Sound anzuhören.',
      'Links filterst du nach Waffe (Pistol, MK2, .50), Typ (Schuss, Schalldämpfer, Nachladen …) und Stil.',
      'Klick auf das Herz, um einen Sound als Favorit zu merken.',
      'Ein Doppelklick öffnet den Sound im Editor zum Anpassen.',
    ],
    tips: [
      'Stile kurz erklärt: Clean = sauber, Cracky = knackig hell, Heavy = wuchtig, Deep = tief, Punchy = druckvoll, Dense = dicht, Bright = hell.',
      'Eigene Sounds (MP3, WAV, OGG, M4A …) holst du mit „Sound importieren“ herein – Sounds aus einem fertigen Soundpack mit „Aus Soundpack holen“.',
      'In dein Pack kommen die Sounds erst in „Soundpack befüllen“.',
    ],
    next: { label: 'Soundpack befüllen', route: 'soundpack' },
  },
  generator: {
    title: 'Sound erstellen',
    intro: 'Hier entsteht ein ganz neuer Schuss – ohne Aufnahme, rein aus Einstellungen. Jeder Klick erzeugt eine eigene Variante.',
    steps: [
      'Wähle oben die Waffe und einen Stil.',
      'Klick auf „Sound erzeugen“ und dann auf Abspielen.',
      'Gefällt er fast? „Sanft variieren“ ändert ihn nur ein bisschen. „Zufällig“ würfelt alles neu.',
      'Mit den Reglern stellst du Bass, Knall, Ausklang und Echo gezielt ein.',
      '„In Bibliothek speichern“ behält ihn – danach kannst du ihn ins Pack legen.',
    ],
    tips: ['Alle erzeugten Sounds werden automatisch auf eine gleichmäßige Lautstärke gebracht.', '„Speichern und bearbeiten“ öffnet den neuen Sound direkt im Editor.'],
    next: { label: 'Zur Bibliothek', route: 'library' },
  },
  editor: {
    title: 'Sound bearbeiten',
    intro: 'Hier passt du einen vorhandenen Sound an. Das Original bleibt immer unverändert – du arbeitest an einer Kopie.',
    steps: [
      'Klick auf „Aus Bibliothek wählen“ und such dir einen Sound aus.',
      'Feinschliff: Regler für Lautstärke, Bass, Höhen, Länge und Hall.',
      'Oben schaltest du zwischen A (Original) und B (deine Version) um und hörst den Unterschied.',
      'Klick auf Speichern – deine Version landet als neuer Sound in der Bibliothek.',
    ],
    tips: ['Strg+Z macht den letzten Schritt rückgängig, Strg+Y wiederholt ihn.', 'Mit C probierst du eine zweite Variante, ohne B zu verlieren.', 'Eine rote Anzeige bedeutet Übersteuerung – dann etwas leiser drehen.'],
    next: { label: 'Soundpack befüllen', route: 'soundpack' },
  },
  soundpack: {
    title: 'Soundpack befüllen',
    intro: 'Das Herzstück: Hier legst du fest, welcher Sound im Spiel bei welcher Aktion läuft. Jede Waffe hat Slots – für den Schuss, den Schalldämpfer, das Nachladen und mehr.',
    steps: [
      'Wähle links die Waffe (Pistol, Pistol MK2 oder Pistol .50).',
      'Klick auf einen Slot, z. B. „Schuss“. Rechts erscheinen passende Sounds.',
      'Hör mit ▶ rein und klick auf den Sound, um ihn in den Slot zu legen – oder zieh ihn per Drag & Drop hinein.',
      'Mach das für jeden Slot, den du ändern willst. Leere Slots behalten den Original-Sound des Spiels.',
      'Mit „Ganzes Pack anhören“ hörst du alles hintereinander.',
    ],
    tips: [
      'Keine Lust auf Einzelarbeit? „Pack automatisch erstellen“ füllt alle Slots in einem Stil.',
      '„Pflicht“-Slots brauchen einen Sound, sobald du an der Waffe etwas änderst.',
      '„Fehlende ableiten“ erstellt z. B. den Schalldämpfer-Sound automatisch aus deinem Schuss.',
      'Über den Versionsverlauf (Pfeil-Symbol oben) gehst du zu einem früheren Stand zurück.',
    ],
    problems: [{ q: 'Beim Schalldämpfer hört man im Spiel den Original-Sound', a: 'Fülle den Slot „Schuss mit Schalldämpfer“ – oder nutze „Fehlende ableiten“. SP Tool schreibt ihn in dieselben Dateien wie den normalen Schuss.' }],
    next: { label: 'Weiter zu Bauen', route: 'build' },
  },
  weapons: {
    title: 'Waffen',
    intro: 'Technische Übersicht: welche Waffen SP Tool unterstützt, welche Slots sie haben und welche Aufsätze (z. B. Schalldämpfer) eigene Sounds nutzen.',
  },
  build: {
    title: 'Bauen',
    intro: 'Beim Bauen werden deine Sounds in die Dateien geschrieben, die GTA V und FiveM lesen (.rpf-Archive). Gespeichert wird immer eine ZIP-Datei – die Dateien darin ziehst du selbst direkt in GTA V › x64 › audio › sfx (nicht in einen Unterordner).',
    steps: [
      'Schritt 1 zeigt dein Soundpack – prüfe, ob die richtigen Slots befüllt sind.',
      'Schritt 2: Wähle ein Basis-Pack. Das sind die Dateien WEAPONS_PLAYER.rpf und RESIDENT.rpf eines Waffen-Soundpacks – markiere beide gleichzeitig.',
      'Schritt 3 prüft jeden Slot. Grün = wird ersetzt.',
      'Klick auf „Soundpack bauen“ und dann auf „Als ZIP speichern“.',
    ],
    tips: ['Das Basis-Pack wird nur gelesen, nie verändert – SP Tool erstellt neue Kopien.', 'Zu lange Sounds werden mit einer weichen Blende gekürzt, zu kurze mit Stille aufgefüllt.'],
    problems: [
      { q: 'Der Knopf „Soundpack bauen“ ist grau', a: 'Entweder ist noch kein Basis-Pack gewählt oder kein Slot befüllt. Die Prüfung in Schritt 3 zeigt, was fehlt.' },
      { q: 'Wo finde ich WEAPONS_PLAYER.rpf und RESIDENT.rpf?', a: 'In jedem Waffen-Soundpack für FiveM (meist im Ordner „mods“ des Packs). Wähle immer beide Dateien desselben Packs.' },
    ],
  },
  install: {
    title: 'Ins Spiel bringen',
    intro: 'SP Tool installiert nichts automatisch in FiveM: Jedes Pack kommt als ZIP-Datei in deine Downloads.',
    steps: [
      'ZIP-Datei entpacken.',
      'WEAPONS_PLAYER.rpf und RESIDENT.rpf in GTA V › x64 › audio › sfx ziehen (vorher die Originaldateien sichern).',
      'FiveM neu starten.',
    ],
    tips: ['Ältere Backups aus früheren Versionen findest du weiterhin unter „Backups“.'],
    problems: [{ q: 'Im Spiel hört sich nichts anders an', a: 'FiveM muss nach dem Kopieren neu gestartet werden. Prüfe außerdem in „Bauen“, ob die Slots grün (ersetzt) waren.' }],
    next: { label: 'Backups ansehen', route: 'backups' },
  },
  backups: {
    title: 'Backups',
    intro: 'Vor jeder Installation sichert SP Tool die Dateien, die ersetzt werden. So kommst du immer zurück – auch zu den Original-Sounds des Spiels.',
    steps: ['Such dir den Stand aus, zu dem du zurück willst (Datum und Pack-Name stehen dabei).', 'Klick auf „Wiederherstellen“ und bestätige.', 'Starte FiveM neu.'],
  },
  cloud: {
    title: 'Cloud',
    intro: 'Mit der Cloud sind deine Soundpacks auf jedem PC verfügbar, an dem du dich mit Discord anmeldest.',
    steps: ['Melde dich mit Discord an (Einstellungen → Konto).', 'Klick auf „Jetzt synchronisieren“.', 'Gibt es auf zwei PCs verschiedene Stände, entscheidest du, welcher gilt – oder behältst beide.'],
  },
  settings: {
    title: 'Einstellungen',
    intro: 'Hier stellst du Aussehen, Lautstärke, FiveM- und GTA-Pfad ein und verwaltest dein Konto und deine Lizenz.',
    steps: ['Konto: anmelden, Lizenz-Key einlösen, PCs verwalten.', 'FiveM / GTA V: Ordner wählen, falls sie nicht automatisch gefunden wurden.', 'Darstellung: Farben und Animationen.'],
    tips: ['„Einfache Ansicht“ blendet Experten-Werkzeuge aus. Schalte sie aus, wenn du alles sehen willst.'],
  },
  analyzer: {
    title: 'Pack-Analyse',
    intro: 'Für Fortgeschrittene: Öffnet vorhandene .rpf-Soundpacks, spielt jeden enthaltenen Sound ab und zeigt technische Details.',
    steps: ['Klick auf „.rpf-Archive öffnen“ und wähle ein Archiv.', 'Hör dir die Streams an und exportiere einzelne als WAV.'],
  },
  logs: {
    title: 'Protokoll',
    intro: 'Hier steht technisch genau, was die App getan hat. Wenn etwas nicht klappt, exportiere das Protokoll und schick es dem Support.',
  },
  admin: {
    title: 'Admin',
    intro: 'Nur für Admins: Lizenzen, Keys, Nutzer und App-Versionen verwalten. Die gleichen Funktionen gibt es im Discord-Bot (/sptool-key, /sptool-user, /sptool-update-senden).',
  },
};

export interface Chapter { id: string; title: string; icon: 'sparkles' | 'library' | 'layers' | 'hammer' | 'install' | 'archive' | 'key' | 'alert'; body: string[]; route?: Route; cta?: string }

export const CHAPTERS: Chapter[] = [
  {
    id: 'start', title: 'Erste Schritte', icon: 'sparkles', route: 'projects', cta: 'Soundpack anlegen',
    body: [
      'SP Tool ersetzt die Waffensounds in FiveM durch deine eigenen. Der Weg dahin hat vier Schritte: Sounds finden → ins Pack legen → bauen → als ZIP speichern.',
      'Leg zuerst unter „Meine Soundpacks“ ein neues Pack an. Alles, was du danach machst, wird automatisch gespeichert.',
    ],
  },
  {
    id: 'sounds', title: '1 · Sounds finden', icon: 'library', route: 'library', cta: 'Zur Bibliothek',
    body: [
      'In der Sound-Bibliothek liegen deine eigenen Sounds für Pistol, Pistol MK2 und Pistol .50 – importiert, erstellt oder bearbeitet.',
      'Mit „Sound erstellen“ erzeugst du neue Schüsse aus Einstellungen. Mit „Sound bearbeiten“ machst du vorhandene lauter, tiefer, kürzer oder knackiger.',
      'Eigene WAV-Dateien kannst du importieren – verwende nur Sounds, die du selbst gemacht hast oder nutzen darfst.',
    ],
  },
  {
    id: 'pack', title: '2 · Pack befüllen', icon: 'layers', route: 'soundpack', cta: 'Soundpack befüllen',
    body: [
      'Jede Waffe hat Slots: Schuss, Schuss mit Schalldämpfer, Magazin raus/rein, Schlitten, Nachladen fertig, Leerschuss, Ziehen und Wegstecken.',
      'Klick einen Slot an und wähle rechts einen Sound. Was leer bleibt, klingt im Spiel wie das Original.',
      '„Pack automatisch erstellen“ füllt alles in einem Stil – ideal für den Anfang.',
    ],
  },
  {
    id: 'build', title: '3 · Bauen', icon: 'hammer', route: 'build', cta: 'Zu Bauen',
    body: [
      'Beim Bauen schreibt SP Tool deine Sounds in .rpf-Archive. Dafür brauchst du ein Basis-Pack: WEAPONS_PLAYER.rpf und RESIDENT.rpf eines Waffen-Soundpacks.',
      'Das Basis-Pack wird nur gelesen. Heraus kommen neue Dateien mit deinen Sounds.',
    ],
  },
  {
    id: 'install', title: '4 · Ins Spiel bringen', icon: 'install', route: 'build', cta: 'Zu Bauen',
    body: [
      'SP Tool speichert dein Pack immer als ZIP-Datei in deinen Downloads – es wird nie automatisch in FiveM installiert.',
      'FiveM schließen, WEAPONS_PLAYER.rpf und RESIDENT.rpf aus der ZIP direkt in GTA V › x64 › audio › sfx ziehen (alte ersetzen), FiveM starten – fertig. „Prüfen“ zeigt dir vorher, ob alles richtig liegt.',
    ],
  },
  {
    id: 'backup', title: 'Zurück zum Original', icon: 'archive', route: 'backups', cta: 'Zu den Backups',
    body: ['Unter „Backups“ siehst du jeden gesicherten Stand. Ein Klick auf „Wiederherstellen“ bringt ihn zurück – auch die Original-Sounds des Spiels.'],
  },
  {
    id: 'account', title: 'Konto und Lizenz', icon: 'key', route: 'settings', cta: 'Zu den Einstellungen',
    body: [
      'Du meldest dich mit „Mit Discord anmelden“ an – dein Discord-Passwort gibst du dabei nie in SP Tool ein.',
      'Deinen Lizenz-Key löst du unter Einstellungen → Konto ein. Die Lizenz gilt für deinen Discord-Account und deine freigegebenen PCs.',
      'Neue Versionen bekommst du vom Discord-Bot per Nachricht: ZIP entpacken, SPTool.exe starten – deine Daten bleiben erhalten.',
    ],
  },
  {
    id: 'faq', title: 'Häufige Probleme', icon: 'alert',
    body: [
      'Windows warnt beim Start: Klick auf „Weitere Informationen“ → „Trotzdem ausführen“.',
      'FiveM wird nicht gefunden: In den Einstellungen unter FiveM den Ordner wählen, der „FiveM.app“ enthält.',
      'Im Spiel ändert sich nichts: Nach dem Erstellen auf „Prüfen“ klicken. Typisch: Die Dateien liegen in einem Unterordner von sfx, die alte Datei wurde nicht ersetzt, FiveM lief noch – oder die Waffe ist noch „ohne Wirkung“ (dann Test im Spiel).',
      'Neuer PC: Einfach mit Discord anmelden. Ist das PC-Limit erreicht, kann ein Admin einen alten PC freigeben.',
    ],
  },
];
