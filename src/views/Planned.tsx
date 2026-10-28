import type { Route } from '../app/store';
import { navigate } from '../app/store';
import { NAV } from '../app/nav';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';

const PLANS: Partial<Record<Route, { title: string; lead: string; items: string[]; formatGate?: boolean; online?: boolean }>> = {
  projects: {
    title: 'Meine Soundpacks',
    lead: 'Soundpack-Projekte fassen Waffen, Slot-Belegung, Bearbeitungen und Bau-Einstellungen in einer .spproject-Datei zusammen.',
    items: ['Soundpacks erstellen, öffnen, duplizieren und umbenennen', 'Automatisches Speichern nach jeder Änderung und alle 30–60 s', 'Wiederherstellung nach Absturz: wiederherstellen oder verwerfen', 'Schnappschüsse mit wiederherstellbarem Versionsverlauf'],
  },
  soundpack: {
    title: 'Soundpack befüllen',
    lead: 'Das Herz von SP Tool: Waffenauswahl links, 3D-Vorschau in der Mitte, Sound-Slots und Details rechts.',
    items: ['Zieh eine Sound-Karte auf einen Waffen-Slot (Schuss, Schalldämpfer, Magazin rein/raus, Schlitten, Nachladen fertig, Leerschuss, Ziehen, Wegstecken)', 'Slot-Status pro Waffe, z. B. Pistol MK2 7 / 9', 'Pack automatisch erstellen, Zufalls-Pack und ganzes Pack anhören', 'Lautstärke-Angleichung über das ganze Pack'],
  },
  mixer: {
    title: 'Mixer',
    lead: 'Kanalzüge für jede Ebene eines erzeugten Schusses: Transiente, Hauptteil, Bass, Mechanik, Ausklang und Raum.',
    items: ['Pegelanzeige, Verstärkung, Stumm und Solo pro Kanal', 'EQ und Effekte pro Ebene', 'Wird mit dem Soundpack gespeichert'],
  },
  marketplace: {
    title: 'SP-Marktplatz',
    lead: 'Soundpacks und einzelne Sounds von Creatorn entdecken, kaufen und installieren.',
    items: ['Bereiche für Empfohlen, Im Trend, Neu, Kostenlos und Bestbewertet', 'Vorhören vor dem Kauf', 'Signierte .sppack-Pakete mit Hash- und Manifest-Prüfung', 'Bewertungen und Rezensionen von verifizierten Besitzern'],
    online: true,
  },
  downloads: {
    title: 'Downloads',
    lead: 'Fortschritt, Geschwindigkeit und Status der Marktplatz-Downloads mit Pause, Fortsetzen und Abbrechen.',
    items: ['Integritätsprüfung (Hash, Größe, Manifest), bevor etwas installiert wird', 'Alle installierten Marktplatz-Packs aktualisieren'],
    online: true,
  },
  cloud: {
    title: 'Cloud',
    lead: 'Optionale Cloud-Kopien deiner Soundpacks mit konfliktsicherer Synchronisierung.',
    items: ['Cloud-Soundpacks synchronisieren, herunterladen, umbenennen, duplizieren und löschen', 'Status: synchronisiert, wird synchronisiert, lokal geändert, Cloud neuer, Konflikt', 'Bei Konflikt: lokal behalten, Cloud nehmen oder beide duplizieren – nie stilles Überschreiben'],
    online: true,
  },
  build: {
    title: 'Soundpack bauen',
    lead: 'Prüft das Soundpack, rendert jede Bearbeitung, wandelt in die nötigen GTA/FiveM-Formate um und packt das Ergebnis.',
    items: ['Prüft fehlende Pflicht-Slots, Format, Länge, Spitzenpegel, Übersteuerung und Speicherplatz', 'Fortschritt pro Waffe mit Abbrechen', 'Klare Fehlermeldungen mit Lösungsvorschlag'],
    formatGate: true,
  },
  install: {
    title: 'In FiveM installieren',
    lead: 'Sichere Installation: in einen temporären Ordner schreiben, prüfen, sichern, ersetzen, erneut prüfen – oder zurückrollen.',
    items: ['Prüft, ob FiveM geschlossen ist, ein Backup existiert und das gebaute Pack gültig ist', 'Bietet an, FiveM zu schließen, wenn es läuft', 'Fasst nie Dateien an, die es nicht wiederherstellen kann'],
    formatGate: true,
  },
  backups: {
    title: 'Backups',
    lead: 'Ein automatisches Backup vor jeder Installation, mit Datum, Pack, Version, Dateien, Größe und Hash.',
    items: ['Wiederherstellen, Original wiederherstellen und vorherige Version wiederherstellen', 'Per Hash geprüfte Wiederherstellung'],
    formatGate: true,
  },
};

export function PlannedView({ route }: { route: Route }) {
  const plan = PLANS[route];
  const nav = NAV.find((n) => n.route === route);
  if (!plan || !nav) return null;
  return (
    <div className="planned">
      <div className="p-head">
        <div className="p-icon"><Icon name={nav.icon} size={26} /></div>
        <div>
          <span className="chip">Entwicklungsphase {nav.phase}</span>
          <h2>{plan.title}</h2>
          <p className="muted" style={{ margin: 0 }}>{plan.lead}</p>
        </div>
      </div>
      <ul>
        {plan.items.map((i) => <li key={i}><Icon name="dot" size={16} />{i}</li>)}
      </ul>
      {plan.formatGate && (
        <div className="callout">
          <Icon name="lock" size={18} />
          <div>
            <strong>Gesperrt, bis die Waffen-Zuordnung geprüft ist.</strong>
            <div className="muted small" style={{ marginTop: 4 }}>
              Das Audio-Containerformat (AWC, PCM 16-bit) ist mit deinem Referenz-Pack geprüft und kann byte-genau geschrieben werden. Noch offen: welcher Stream zu welchem Waffen-Slot gehört und wo das Pack installiert wird. SP Tool rät das nicht, deshalb bleibt dieses Modul aus und deine FiveM-Dateien bleiben unberührt. Bis dahin kannst du mit der Pack-Analyse Packs untersuchen und angepasste Kopien von Hand exportieren.
            </div>
          </div>
        </div>
      )}
      {plan.online && (
        <div className="callout info">
          <Icon name="cloud" size={18} />
          <div className="small">Benötigt den Online-Server von SP Tool (Konten, Speicher, API), der in einer eigenen Projektphase entsteht. Lokale Funktionen laufen auch ohne ihn weiter.</div>
        </div>
      )}
      <div className="row" style={{ marginTop: 22 }}>
        <Button variant="primary" icon="library" onClick={() => navigate('library')}>Sound-Bibliothek öffnen</Button>
        <Button icon="wave" onClick={() => navigate('editor')}>Editor öffnen</Button>
      </div>
    </div>
  );
}
