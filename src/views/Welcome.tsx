import { useState } from 'react';
import { DecorWave } from '../components/MiniWave';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { navigate, setState, updateSettings, useApp, type AccentId, type ThemeId } from '../app/store';
import { runDetection } from '../app/App';
import { isTauri, pickFolder } from '../services/tauri';
import { logger } from '../services/logger';
import type { Style } from '../models/types';
import { FiveMCard, GtaCard } from './Home';
import { accountsEnabled } from '../account/config';
import { ActivationChecklist } from './Account';

export const THEMES: Array<{ id: ThemeId; label: string; bg: string; side: string }> = [
  { id: 'turbo', label: 'Turbo Design', bg: '#03050a', side: '#1f7bff' },
  { id: 'sp-dark', label: 'SP Dark', bg: '#08090C', side: '#12151B' },
  { id: 'pure-black', label: 'Tiefschwarz', bg: '#000000', side: '#0D0E10' },
  { id: 'graphite', label: 'Graphit', bg: '#121316', side: '#1D1F24' },
  { id: 'midnight', label: 'Mitternacht', bg: '#070A12', side: '#111827' },
];
export const ACCENTS: Array<{ id: AccentId; color: string; label: string }> = [
  { id: 'blue', color: '#5865F2', label: 'Blau' },
  { id: 'purple', color: '#8B5CF6', label: 'Lila' },
  { id: 'white', color: '#E6E9EF', label: 'Weiß' },
  { id: 'red', color: '#E5484D', label: 'Rot' },
];
const STYLES: Style[] = ['Clean', 'Heavy', 'Deep', 'Punchy', 'Competitive', 'Realistic', 'Aggressive', 'Tactical', 'Modern', 'Cracky', 'Echo', 'Balanced', 'Dense', 'Bright', 'Street', 'Snap', 'Loud', 'Boom', 'Gambo', 'Gangwar', 'Hood'];

export function ThemePicker() {
  const s = useApp((x) => x.settings);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="theme-tiles">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-tile${s.theme === t.id ? ' on' : ''}`} onClick={() => updateSettings({ theme: t.id })}>
            <div className="tt-prev" style={{ background: t.bg }}><div style={{ background: t.side }} /><div /></div>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {s.theme !== 'turbo' && <div className="row">
        <span className="muted small" style={{ width: 60 }}>Akzent</span>
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button key={a.id} className={`swatch${s.accent === a.id ? ' on' : ''}`} style={{ background: a.color }} title={a.label} aria-label={a.label} onClick={() => updateSettings({ accent: a.id })} />
          ))}
        </div>
      </div>}
    </div>
  );
}

export function WelcomeView() {
  const session = useApp((s) => s.session);
  const settings = useApp((s) => s.settings);
  const accounts = accountsEnabled();
  const [step, setStep] = useState(accounts ? 0 : session ? 1 : 0);
  const [name, setName] = useState('');

  const createProfile = () => {
    const displayName = name.trim() || 'Creator';
    setState({ session: { mode: 'offline', displayName, createdAt: Date.now() } });
    logger.info('Local profile created');
    setStep(1);
  };
  const chooseFolder = async (kind: 'fivem' | 'gta') => {
    const p = await pickFolder(kind === 'fivem' ? 'Wähle deinen FiveM-Ordner (enthält FiveM.app)' : 'Wähle deinen GTA-V-Ordner');
    if (p) { updateSettings(kind === 'fivem' ? { fivemPath: p } : { gtaPath: p }); void runDetection(); }
  };
  const finish = (to: 'home' | 'library') => { setState({ onboarded: true }); navigate(to); };

  return (
    <div className="welcome">
      <section className="welcome-brand brand-hero">
        <div className="row brand-row"><img className="brand-emblem" src="assets/brand/emblem.jpg" height={34} alt="" /><span className="brand-name" style={{ fontSize: 17 }}>SP Tool</span><span className="brand-by">von Turbo Design</span></div>
        <h1 className="shine-text">Soundpack-Ersteller für FiveM</h1>
        <p>Wähle eine Waffe, importier deine eigenen Sounds, bearbeite sie im Editor und bau dein eigenes Pack.</p>
        <DecorWave className="welcome-wave" bars={120} />
        <div className="claim">Erstellen. Vorhören. Bauen. Installieren.</div>
      </section>
      <section className="welcome-side">
        <div className="welcome-card">
          <div className="steps" aria-label={`Schritt ${step + 1} von 5`}>{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>

          {step === 0 && accounts && (
            <div className="col" style={{ gap: 16 }}>
              <div><h2>Deine Lizenz</h2><p className="muted" style={{ margin: 0 }}>SP Tool ist für dein Discord-Konto und diesen PC freigeschaltet.</p></div>
              <ActivationChecklist />
              <div className="row"><span className="spacer" /><Button variant="primary" onClick={() => setStep(1)}>Weiter</Button></div>
            </div>
          )}

          {step === 0 && !accounts && (
            <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); createProfile(); }}>
              <div>
                <h2>Willkommen bei SP Tool</h2>
                <p className="muted" style={{ margin: 0 }}>Leg ein lokales Profil an, um loszulegen. Alles, was du erstellst, bleibt auf diesem PC.</p>
              </div>
              <label className="field">Anzeigename
                <input className="input" autoFocus value={name} maxLength={32} placeholder="Creator" onChange={(e) => setName(e.target.value)} />
              </label>
              <Button variant="primary" size="lg" type="submit">Offline weiter</Button>
              <div className="callout info small">
                <Icon name="info" size={16} />
                <div>Die Anmeldung mit einem SP-Tool-Konto oder Discord, Cloud-Soundpacks und der Marktplatz brauchen den Online-Server, der in dieser Version noch nicht enthalten ist. Dein lokales Profil kannst du später verknüpfen.</div>
              </div>
            </form>
          )}

          {step === 1 && (
            <div className="col" style={{ gap: 14 }}>
              <div>
                <h2>FiveM und GTA V finden</h2>
                <p className="muted" style={{ margin: 0 }}>SP Tool sucht an den üblichen Installationsorten. Du kannst jederzeit einen eigenen Ordner angeben.</p>
              </div>
              {!isTauri() && <div className="callout small"><Icon name="alert" size={16} /><div>Du nutzt die Browser-Vorschau. Die Suche braucht die Windows-App, deshalb zeigt dieser Schritt hier keine Ergebnisse.</div></div>}
              <div className="panel"><div className="panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                <FiveMCard compact onLocate={isTauri() ? () => chooseFolder('fivem') : undefined} />
                <GtaCard compact onLocate={isTauri() ? () => chooseFolder('gta') : undefined} />
              </div></div>
              <div className="row"><Button variant="ghost" onClick={() => setStep(0)}>Zurück</Button><span className="spacer" /><Button icon="refresh" onClick={() => void runDetection()} disabled={!isTauri()}>Erneut suchen</Button><Button variant="primary" onClick={() => setStep(2)}>Weiter</Button></div>
            </div>
          )}

          {step === 2 && (
            <div className="col" style={{ gap: 16 }}>
              <div><h2>Wähle ein Aussehen</h2><p className="muted" style={{ margin: 0 }}>Du kannst das später unter Einstellungen → Aussehen ändern.</p></div>
              <ThemePicker />
              <div className="row"><Button variant="ghost" onClick={() => setStep(1)}>Zurück</Button><span className="spacer" /><Button variant="primary" onClick={() => setStep(3)}>Weiter</Button></div>
            </div>
          )}

          {step === 3 && (
            <div className="col" style={{ gap: 16 }}>
              <div><h2>Dein Standard-Soundstil</h2><p className="muted" style={{ margin: 0 }}>Damit wird die Bibliothek vorgefiltert und „Sound erstellen“ vorbelegt.</p></div>
              <div className="style-pick">
                {STYLES.map((s) => <button key={s} className={settings.defaultStyle === s ? 'on' : ''} onClick={() => updateSettings({ defaultStyle: s })}>{s}</button>)}
              </div>
              <div className="row"><Button variant="ghost" onClick={() => setStep(2)}>Zurück</Button><span className="spacer" /><Button variant="primary" onClick={() => setStep(4)}>Weiter</Button></div>
            </div>
          )}

          {step === 4 && (
            <div className="col" style={{ gap: 16 }}>
              <div><h2>Alles bereit, {session?.displayName}</h2><p className="muted" style={{ margin: 0 }}>Hör dich zuerst durch die Bibliothek – drück bei einer beliebigen Karte auf Abspielen oder öffne einen Sound im Editor.</p></div>
              <Button variant="primary" size="lg" icon="library" onClick={() => finish('library')}>Sound-Bibliothek öffnen</Button>
              <Button size="lg" onClick={() => finish('home')}>Zur Startseite</Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
