import { useSyncExternalStore } from 'react';
import { checkForUpdate, getUpdate, installUpdate, onUpdate } from '../services/appUpdate';
import { useEffect, useState } from 'react';
import { AccountPanel } from './Account';
import { TierTable } from './Locked';
import { useCan } from '../account/perms';
import { accountsEnabled } from '../account/config';
import { runDetection } from '../app/App';
import { DEFAULT_SETTINGS, getState, setState, toast, updateSettings, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { Button, Slider, Toggle } from '../components/ui';
import { cacheStats, clearMetaCache } from '../library/assets';
import type { Style } from '../models/types';
import { logger } from '../services/logger';
import { isTauri, pickFolder } from '../services/tauri';
import { ThemePicker } from './Welcome';
import { FiveMCard, GtaCard } from './Home';
import { APP_VERSION } from '../components/Shell';
import { ChangeList, useChangelog } from '../components/Changelog';

type Sec = 'General' | 'Account' | 'Connections' | 'Appearance' | 'Audio' | 'FiveM' | 'GTA V' | 'Projects' | 'Build' | 'Marketplace' | 'Cloud' | 'Updates' | 'Backups' | 'Privacy' | 'Advanced';
const SECS: Array<{ id: Sec; phase?: number }> = [
  { id: 'General' }, { id: 'Account' }, { id: 'Connections', phase: 8 }, { id: 'Appearance' }, { id: 'Audio' }, { id: 'FiveM' }, { id: 'GTA V' },
  { id: 'Projects', phase: 3 }, { id: 'Build', phase: 4 }, { id: 'Marketplace', phase: 10 }, { id: 'Cloud', phase: 9 }, { id: 'Updates' },
  { id: 'Backups', phase: 4 }, { id: 'Privacy' }, { id: 'Advanced' },
];
const SEC_LABEL: Record<Sec, string> = {
  General: 'Allgemein', Account: 'Konto', Connections: 'Verbindungen', Appearance: 'Darstellung', Audio: 'Audio', FiveM: 'FiveM', 'GTA V': 'GTA V',
  Projects: 'Soundpacks', Build: 'Bauen', Marketplace: 'Marktplatz', Cloud: 'Cloud', Updates: 'Updates', Backups: 'Backups', Privacy: 'Datenschutz', Advanced: 'Erweitert',
};
const PLANNED_TEXT: Partial<Record<Sec, string>> = {
  Connections: 'Discord-Anmeldung über den offiziellen OAuth2-Ablauf, Konto-Verknüpfung, Rich Presence und Benachrichtigungen (nur wenn du zustimmst). SP Tool fragt nie nach deinem Discord-Passwort oder Token.',
  Projects: 'Soundpack-Ordner, Intervall für automatisches Speichern (30–60 s), Versionsverlauf und Wiederherstellung nach Abstürzen.',
  Build: 'Ausgabeordner, Strenge der Prüfung und Format-Optionen – verfügbar, sobald das Soundpack-Format anhand eines Referenz-Packs bestätigt ist.',
  Marketplace: 'Marktplatz-Region, Download-Ordner und Einstellungen für Empfehlungen.',
  Cloud: 'Cloud-Synchronisierung an/aus, Umgang mit Konflikten und Speicherverbrauch.',
  Updates: 'Update-Kanal (stabil/Beta), automatischer Download und Installation beim Neustart. Updates werden signiert, per Hash geprüft und können zurückgesetzt werden.',
  Backups: 'Speicherort der Backups, Aufbewahrungsdauer und Wiederherstellen der originalen Spieldateien.',
};

function Row({ t, d, children }: { t: string; d?: string; children: React.ReactNode }) {
  return <div className="set-row"><div className="grow"><div className="t">{t}</div>{d && <div className="d">{d}</div>}</div>{children}</div>;
}

export function SettingsView() {
  const s = useApp((x) => x.settings);
  const session = useApp((x) => x.session);
  const [sec, setSec] = useState<Sec>(() => (getState().settings.simpleMode ? 'Account' : 'General'));
  const devAllowed = useCan('devMode');
  const [name, setName] = useState(session?.displayName ?? '');
  const [stats, setStats] = useState(cacheStats());
  useEffect(() => setStats(cacheStats()), [sec]);
  const phase = SECS.find((x) => x.id === sec)?.phase;

  const locate = async (kind: 'fivem' | 'gta') => {
    const p = await pickFolder(kind === 'fivem' ? 'Wähle deinen FiveM-Ordner (enthält FiveM.app)' : 'Wähle deinen GTA-V-Ordner');
    if (p) { updateSettings(kind === 'fivem' ? { fivemPath: p } : { gtaPath: p }); await runDetection(); }
  };

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Bereiche der Einstellungen">
        {SECS.filter((x) => !s.simpleMode || ['Account', 'Appearance', 'Audio', 'Updates', 'Advanced'].includes(x.id)).map((x) => (
          <button key={x.id} className={`nav-item${sec === x.id ? ' active' : ''}`} style={{ padding: '7px 10px' }} onClick={() => setSec(x.id)}>
            <span className="n-label">{SEC_LABEL[x.id]}</span>{x.phase && <span className="soon">geplant</span>}
          </button>
        ))}
      </nav>
      <div className="settings-body" key={sec}>
        <h2>{SEC_LABEL[sec]}</h2>
        {phase ? (
          <div style={{ maxWidth: 680 }}>
            <p className="muted">{PLANNED_TEXT[sec]}</p>
            <div className="callout info"><Icon name="info" size={18} /><div className="small">Diese Einstellungen kommen mit Entwicklungsphase {phase}. Hier ist noch nichts aktiv – deshalb wird nichts angezeigt, was nicht funktionieren würde.</div></div>
          </div>
        ) : null}

        {sec === 'General' && <>
          <Row t="Standard-Soundstil" d="Wird beim Sound-Erstellen vorausgewählt und für Empfehlungen genutzt.">
            <select className="select" style={{ width: 180 }} value={s.defaultStyle} onChange={(e) => updateSettings({ defaultStyle: e.target.value as Style })}>
              {['Clean', 'Heavy', 'Deep', 'Punchy', 'Competitive', 'Realistic', 'Aggressive', 'Tactical', 'Modern'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Row>
          <Row t="Tastenkürzel" d="Strg+K Befehlspalette · Strg+G Sound erstellen · Leertaste Abspielen · Strg+Z / Strg+Y Rückgängig/Wiederholen · Strg+S Bearbeitung speichern"><span /></Row>
          <Row t="Version" d="SP Tool Desktop"><span className="num">{APP_VERSION}</span></Row>
        </>}

        {sec === 'Account' && accountsEnabled() && <><AccountPanel /><div className="set-row" style={{ display: 'block' }}><div className="t" style={{ marginBottom: 10 }}>Was dein Plan enthält</div><TierTable /></div></>}
        {sec === 'Account' && !accountsEnabled() && <>
          <Row t="Anzeigename" d="Wird in der App angezeigt. Dein Profil liegt nur auf diesem PC.">
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (session && name.trim()) { setState({ session: { ...session, displayName: name.trim().slice(0, 32) } }); toast('success', 'Name geändert'); } }}>
              <input className="input" style={{ width: 200 }} value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
              <Button size="sm" type="submit" disabled={!name.trim() || name.trim() === session?.displayName}>Speichern</Button>
            </form>
          </Row>
          <Row t="Plan" d="Diese Version hat keinen Lizenzserver eingerichtet (lokales Profil). Versionen mit SPTOOL_API_URL melden sich mit Discord an und binden die Lizenz an deine PCs."><span className="chip">Lokal · Free</span></Row>
          <Row t="Abmelden" d="Zurück zum Willkommensbildschirm. Deine Sounds, Favoriten und Einstellungen bleiben auf diesem PC.">
            <Button size="sm" onClick={() => { setState({ session: null, onboarded: false }); logger.info('Signed out of local profile'); }}>Abmelden</Button>
          </Row>
        </>}

        {sec === 'Appearance' && <>
          <div className="set-row" style={{ display: 'block' }}><div className="t" style={{ marginBottom: 12 }}>Design und Akzentfarbe</div><ThemePicker /></div>
          <Row t="Einfache Ansicht" d="Empfohlen für Anfänger. Zeigt nur, was du zum Erstellen eines Soundpacks brauchst. Schalte sie aus, um die Experten-Werkzeuge zu sehen (Pack-Analyse, Protokoll …)."><Toggle on={s.simpleMode} onChange={(v) => updateSettings({ simpleMode: v })} label="Einfache Ansicht" /></Row>
          <Row t="Seiten-Tipps" d="Die kurze Erklärung oben auf jeder Seite."><button className="btn sm" disabled={!s.hintsSeen.length} onClick={() => updateSettings({ hintsSeen: [] })}>Alle Tipps wieder anzeigen</button></Row>
          <Row t="Weniger Bewegung" d="Schaltet Animationen und Übergänge aus."><Toggle on={s.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} label="Weniger Bewegung" /></Row>
          <Row t="Größe der Oberfläche" d="Skaliert alle Texte und Bedienelemente.">
            <div style={{ width: 240 }}><Slider label="" value={s.uiScale} min={0.85} max={1.3} step={0.05} def={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateSettings({ uiScale: v })} /></div>
          </Row>
        </>}

        {sec === 'Audio' && <>
          <Row t="Lautstärke beim Vorhören" d="Lautstärke für die Wiedergabe in Bibliothek, Editor und beim Sound-Erstellen.">
            <div style={{ width: 240 }}><Slider label="" value={s.volume} min={0} max={1} step={0.01} def={0.85} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateSettings({ volume: v })} /></div>
          </Row>
          <Row t="Vorhören beim Drüberfahren" d="Spielt einen Sound ab, wenn du in der Bibliothek mit der Maus über seine Karte fährst."><Toggle on={s.hoverPreview} onChange={(v) => updateSettings({ hoverPreview: v })} label="Vorhören beim Drüberfahren" /></Row>
        </>}

        {sec === 'FiveM' && <>
          <div className="set-row" style={{ display: 'block' }}><FiveMCard /></div>
          <Row t="Eigener FiveM-Ordner" d={s.fivemPath || 'Nicht festgelegt – der Standard %LOCALAPPDATA%\\FiveM wird genutzt.'}>
            <div className="row">
              {s.fivemPath && <Button size="sm" variant="ghost" onClick={() => { updateSettings({ fivemPath: '' }); void runDetection(); }}>Zurücksetzen</Button>}
              <Button size="sm" onClick={() => void locate('fivem')} disabled={!isTauri()}>FiveM suchen</Button>
            </div>
          </Row>
          <Row t="Erneut erkennen" d="Prüft die Installationsorte erneut und ob FiveM gerade läuft."><Button size="sm" icon="refresh" onClick={() => void runDetection()} disabled={!isTauri()}>Erkennen</Button></Row>
        </>}

        {sec === 'GTA V' && <>
          <div className="set-row" style={{ display: 'block' }}><GtaCard /></div>
          <GtaList />
          <Row t="Eigener GTA-V-Ordner" d={s.gtaPath || 'Nicht festgelegt.'}>
            <div className="row">
              {s.gtaPath && <Button size="sm" variant="ghost" onClick={() => { updateSettings({ gtaPath: '' }); void runDetection(); }}>Zurücksetzen</Button>}
              <Button size="sm" onClick={() => void locate('gta')} disabled={!isTauri()}>GTA V suchen</Button>
            </div>
          </Row>
        </>}

        {sec === 'Updates' && <UpdatesPanel />}

        {sec === 'Privacy' && <>
          <p className="muted" style={{ maxWidth: 680 }}>Diese Version sendet keinerlei Daten: keine Statistiken, keine Absturzberichte, keine Telemetrie. Die Schalter merken sich deine Wahl für spätere Online-Funktionen; beide bleiben aus, solange du nicht zustimmst.</p>
          <Row t="Nutzungsstatistik" d="Nur mit deiner Zustimmung. Anonyme Nutzung der Funktionen."><Toggle on={s.analytics} onChange={(v) => updateSettings({ analytics: v })} label="Nutzungsstatistik" /></Row>
          <Row t="Absturzberichte" d="Nur mit deiner Zustimmung. Fehlerdetails ohne persönliche Daten."><Toggle on={s.crashReports} onChange={(v) => updateSettings({ crashReports: v })} label="Absturzberichte" /></Row>
        </>}

        {sec === 'Advanced' && <>
          <Row t="Entwicklermodus" d={devAllowed ? "Zeigt interne IDs, rohe Profildaten und andere technische Details." : "Braucht den Developer-Plan."}><Toggle on={s.devMode && devAllowed} onChange={(v) => devAllowed && updateSettings({ devMode: v })} label="Entwicklermodus" /></Row>
          <Row t="Cache für Wellenform und Analyse" d={`${stats.meta} Sounds analysiert · ${stats.audio} im Speicher. Wird bei Bedarf automatisch neu aufgebaut.`}>
            <Button size="sm" onClick={() => { const n = clearMetaCache(); setStats(cacheStats()); toast('success', 'Cache geleert', `${n} Einträge entfernt`); }}>Cache leeren</Button>
          </Row>
          <Row t="Einstellungen zurücksetzen" d="Stellt Darstellung und Audio auf die Standardwerte zurück. Deine Sounds bleiben erhalten.">
            <Button size="sm" variant="danger" onClick={() => { updateSettings({ ...DEFAULT_SETTINGS }); toast('info', 'Einstellungen zurückgesetzt'); }}>Einstellungen zurücksetzen</Button>
          </Row>
        </>}
      </div>
    </div>
  );
}

function GtaList() {
  const g = useApp((x) => x.gta);
  if (g.state !== 'done' || g.value.length < 2) return null;
  return (
    <div className="set-row" style={{ display: 'block' }}>
      <div className="t" style={{ marginBottom: 8 }}>Alle gefundenen Installationen</div>
      {g.value.map((x) => (
        <div key={x.path} className="row small" style={{ padding: '4px 0' }}>
          <span className={`chip ${x.valid ? 'ok' : 'err'}`}>{x.valid ? x.edition : 'Keine GTA5.exe'}</span><span className="faint">{x.source}</span><span className="path">{x.path}</span>
        </div>
      ))}
    </div>
  );
}

function ChangelogRow() {
  const entries = useChangelog();
  const [all, setAll] = useState(false);
  return (
    <div className="set-block" data-testid="changelog">
      <div className="row" style={{ justifyContent: 'space-between', margin: '18px 0 8px' }}>
        <div><b>Was ist neu?</b><div className="small muted">Alle Änderungen pro Version – aus dem Changelog der App und von dem, was beim Verteilen dazugeschrieben wurde.</div></div>
      </div>
      <ChangeList entries={entries} current={APP_VERSION} max={all ? undefined : 4} />
      {entries.length > 4 && <Button size="sm" variant="ghost" icon={all ? undefined : 'chevronDown'} onClick={() => setAll(!all)}>{all ? 'Weniger anzeigen' : `Alle ${entries.length} Versionen anzeigen`}</Button>}
    </div>
  );
}

function UpdatesPanel() {
  const s = useApp((x) => x.settings);
  const u = useSyncExternalStore(onUpdate, getUpdate);
  const busy = u.phase !== 'idle' && u.phase !== 'error';
  const status = u.phase === 'checking' ? 'Suche nach Updates…'
    : u.available ? `Version ${u.available.version} ist verfügbar.`
    : u.error ? u.error
    : u.checkedAt ? `Du hast die neueste Version (${APP_VERSION}).` : `Installiert: Version ${APP_VERSION}.`;
  return <>
    <Row t="Automatisch nach Updates suchen" d="Beim Start und alle paar Stunden. Ein Update installierst du immer selbst mit einem Klick – deine Soundpacks, Einstellungen und die Anmeldung bleiben erhalten."><Toggle on={s.checkUpdates} onChange={(v) => updateSettings({ checkUpdates: v })} label="Automatisch nach Updates suchen" /></Row>
    <Row t="Updates" d={status}>
      <div className="row" style={{ gap: 8 }}>
        {u.available && <Button size="sm" variant="primary" icon="download" disabled={busy} onClick={() => void installUpdate()}>Jetzt aktualisieren</Button>}
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => void checkForUpdate(true)}>Nach Updates suchen</Button>
      </div>
    </Row>
    <ChangelogRow />
  </>;
}
