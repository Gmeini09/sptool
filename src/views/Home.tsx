import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { runDetection } from '../app/App';
import { navigate, openInEditor, openProject, useApp } from '../app/store';
import { filledCount, validateProject } from '../projects/project';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { Icon } from '../components/Icon';
import { MiniWave } from '../components/MiniWave';
import { CountUp } from '../components/CountUp';
import { Button, EmptyState, fmtDur } from '../components/ui';
import { entryById, useEntryMeta } from '../library/assets';
import { turboCatalog } from '../library/turbo';
import type { LibraryEntry } from '../models/types';
import { WEAPON_LABEL } from '../models/types';
import { isTauri, openPath } from '../services/tauri';
import { previewEntry, usePlayingKey } from '../audio/preview';
import { toast } from '../app/store';

export function FiveMCard({ compact, onLocate }: { compact?: boolean; onLocate?: () => void }) {
  const f = useApp((s) => s.fivem);
  let status: ReactElement, detail = '', path: string | null = null;
  if (f.state === 'checking') status = <span className="chip">Wird geprüft…</span>;
  else if (f.state === 'unavailable') { status = <span className="chip">Nur in der Windows-App</span>; detail = 'Die Suche läuft in der Windows-App.'; }
  else if (f.state === 'error') { status = <span className="chip err">Fehler</span>; detail = f.message; }
  else if (f.value.detected) { status = <span className="chip ok"><Icon name="check" size={13} />{f.value.running ? 'Gefunden · läuft' : 'Gefunden'}</span>; path = f.value.root; }
  else { status = <span className="chip err">Nicht gefunden</span>; detail = `${f.value.checked.length} Orte geprüft.`; }
  return (
    <div className="sys-row">
      <Icon name="gamepad" size={20} />
      <div className="grow">
        <div className="row" style={{ gap: 8 }}><strong>FiveM</strong>{status}</div>
        {path ? <div className="path" title={path}>{path}</div> : detail && <div className="faint small">{detail}</div>}
      </div>
      {path && !compact && <Button size="sm" icon="folder" onClick={() => openPath(path!).catch((e) => toast('error', 'Ordner konnte nicht geöffnet werden', String(e)))}>Ordner öffnen</Button>}
      {onLocate && !(f.state === 'done' && f.value.detected) && <Button size="sm" onClick={onLocate}>FiveM suchen</Button>}
    </div>
  );
}

export function GtaCard({ compact, onLocate }: { compact?: boolean; onLocate?: () => void }) {
  const g = useApp((s) => s.gta);
  let status: ReactElement, detail = '';
  const valid = g.state === 'done' ? g.value.filter((x) => x.valid) : [];
  if (g.state === 'checking') status = <span className="chip">Wird geprüft…</span>;
  else if (g.state === 'unavailable') { status = <span className="chip">Nur in der Windows-App</span>; detail = 'Die Suche läuft in der Windows-App.'; }
  else if (g.state === 'error') { status = <span className="chip err">Fehler</span>; detail = g.message; }
  else if (valid.length) status = <span className="chip ok"><Icon name="check" size={13} />{valid[0].source} · {valid[0].edition}</span>;
  else { status = <span className="chip err">Nicht gefunden</span>; detail = 'Rockstar, Steam, Epic Games und die FiveM-Konfiguration geprüft.'; }
  return (
    <div className="sys-row">
      <Icon name="box" size={20} />
      <div className="grow">
        <div className="row" style={{ gap: 8 }}><strong>GTA V</strong>{status}</div>
        {valid.length ? <div className="path" title={valid[0].path}>{valid[0].path}{valid.length > 1 ? `  (+${valid.length - 1} weitere)` : ''}</div> : detail && <div className="faint small">{detail}</div>}
      </div>
      {onLocate && !valid.length && <Button size="sm" onClick={onLocate}>GTA V suchen</Button>}
      {!compact && null}
    </div>
  );
}

function RecentRow({ e }: { e: LibraryEntry }) {
  const meta = useEntryMeta(e);
  const playing = usePlayingKey() === e.id;
  return (
    <div className="recent-item" onClick={() => openInEditor(e.id)}>
      <button className={`play-btn${playing ? ' playing' : ''}`} aria-label={playing ? 'Stopp' : 'Abspielen'} onClick={(ev) => { ev.stopPropagation(); void previewEntry(e); }}>
        <Icon name={playing ? 'stop' : 'play'} size={13} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
        <div className="faint small">{WEAPON_LABEL[e.weapon]} · {meta ? fmtDur(meta.duration) : '…'}</div>
      </div>
      <MiniWave peaks={meta?.peaks} height={26} />
    </div>
  );
}

/** Guided path for beginners: each step is ticked off from the real project state. */
export function FirstPackSteps() {
  const projects = useApp((s) => s.projects);
  const currentId = useApp((s) => s.currentProjectId);
  const p = projects.find((x) => x.id === currentId) ?? projects[0];
  const filled = p ? WEAPON_PROFILES.reduce((n, w) => n + filledCount(p, w), 0) : 0;
  const complete = !!p && filled > 0 && validateProject(p, WEAPON_PROFILES).ok;
  const steps = [
    { t: 'Soundpack anlegen', d: p ? `„${p.name}“ ist bereit.` : 'Gib ihm einen Namen – das ist alles.', done: !!p, go: () => navigate('projects'), cta: p ? 'Ändern' : 'Starten' },
    { t: 'Sounds für deine Waffen wählen', d: filled ? `${filled} Sound-Slots befüllt.` : 'Für jede Waffe: Schuss, Schalldämpfer, Nachladen … Klick auf einen Slot und wähle einen Sound.', done: filled > 0, go: () => (p ? openProject(p.id) : navigate('projects')), cta: filled ? 'Bearbeiten' : 'Wählen' },
    { t: 'Prüfen, ob alles vollständig ist', d: complete ? 'Keine Probleme gefunden.' : filled ? '„Soundpack befüllen“ zeigt dir, was noch fehlt.' : 'Passiert automatisch, sobald du Sounds gewählt hast.', done: complete, go: () => (p ? openProject(p.id) : navigate('projects')), cta: complete ? 'Ansehen' : 'Prüfen' },
    { t: 'Bauen und als ZIP speichern', d: 'Je ein Klick. Die Dateien aus der ZIP ziehst du selbst in GTA V › x64 › audio › sfx.', done: false, go: () => navigate('build'), cta: 'Bauen' },
  ];
  const current = steps.findIndex((x) => !x.done);
  return (
    <div className="steps-guide">
      {steps.map((x, i) => (
        <button key={x.t} className={`step-card${x.done ? ' done' : ''}${i === current ? ' current' : ''}`} onClick={x.go}>
          <span className="step-n">{x.done ? <Icon name="check" size={15} /> : i + 1}</span>
          <div style={{ minWidth: 0 }}><div className="step-t">{x.t}</div><div className="step-d">{x.d}</div></div>
          <span className="step-go">{x.cta} →</span>
        </button>
      ))}
    </div>
  );
}

/** Simple start page: one big button, two shortcuts, nothing else. */
function SimpleHome() {
  const session = useApp((s) => s.session);
  const user = useApp((s) => s.userEntries);
  const projects = useApp((s) => s.projects);
  const own = user.filter((u) => u.source === 'imported').length;
  return (
    <div className="page simple-home">
      <h2>Hallo {session?.displayName} 👋</h2>
      <button className="qp-hero big" onClick={() => navigate('create')}>
        <span className="qp-hero-icon"><Icon name="hammer" size={26} /></span>
        <span className="grow"><b>Soundpack erstellen</b><span>Sounds reinziehen (MP3, WAV …) oder aus einem fertigen SP nehmen – Pistol, MK2, .50, Nachladen. Fertig in deinen Downloads.</span></span>
        <span className="qp-hero-go">Los →</span>
      </button>
      <div className="simple-cards">
        <button onClick={() => navigate('library')}><Icon name="library" size={20} /><div><b>Meine Sounds</b><span>{own ? `${own} importiert · ${turboCatalog().length} Turbo` : `${turboCatalog().length} Turbo-Sounds anhören`}</span></div></button>
        <button onClick={() => navigate('settings')}><Icon name="settings" size={20} /><div><b>Einstellungen</b><span>Aussehen, Konto, Ansicht</span></div></button>
      </div>
      {projects.length > 0 && <p className="small faint">Zuletzt erstellt: {projects.slice(0, 3).map((p) => p.name).join(' · ')}</p>}
    </div>
  );
}

export function HomeView() {
  const simple = useApp((s) => s.settings.simpleMode);
  return simple ? <SimpleHome /> : <ExpertHome />;
}

function ExpertHome() {
  const session = useApp((s) => s.session);
  const favorites = useApp((s) => s.favorites);
  const recent = useApp((s) => s.recent);
  const user = useApp((s) => s.userEntries);
  const fivem = useApp((s) => s.fivem);
  const projects = useApp((s) => s.projects);
  const currentId = useApp((s) => s.currentProjectId);
  const recentEntries = useMemo(() => recent.map((id) => entryById(id)).filter(Boolean).slice(0, 6) as LibraryEntry[], [recent, user]);
  const generated = user.filter((u) => u.source === 'generated').length;
  const edits = user.filter((u) => u.source === 'edit').length;

  return (
    <div className="page">
      <div className="hero">
        <section className="panel hero-main hud-frame">
          <h2>Willkommen zurück, {session?.displayName}</h2>
          <p>Am schnellsten mit „Soundpack erstellen“. Oder von Hand in vier Schritten – klick auf einen Schritt, um dort weiterzumachen.</p>
          <button className="qp-hero" onClick={() => navigate('create')}>
            <span className="qp-hero-icon"><Icon name="hammer" size={22} /></span>
            <span className="grow"><b>Soundpack erstellen</b><span>Eigene Sounds reinziehen (MP3, WAV …) oder aus einem Soundpack holen – Pistol, MK2, .50, Nachladen. Fertig in deinen Downloads.</span></span>
            <span className="qp-hero-go">Los →</span>
          </button>
          <FirstPackSteps />
          <div className="quick" style={{ marginTop: 16 }}>
            <button onClick={() => navigate('library')}><Icon name="library" /><div><div className="q-t">Meine Sounds</div><div className="q-d">{user.length + turboCatalog().length} Sounds in der Bibliothek</div></div></button>
            <button onClick={() => navigate('generator')}><Icon name="sparkles" /><div><div className="q-t">Sound erstellen</div><div className="q-d">Stil wählen, Regler bewegen</div></div></button>
            <button onClick={() => navigate('editor')}><Icon name="wave" /><div><div className="q-t">Sound bearbeiten</div><div className="q-d">Lauter, kürzer, tiefer</div></div></button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h3>System</h3><span className="spacer" /><Button size="sm" variant="ghost" icon="refresh" onClick={() => void runDetection()} disabled={!isTauri()}>Erneut suchen</Button></div>
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <FiveMCard />
            <GtaCard />
            <div className="sys-row">
              <Icon name="hammer" size={20} />
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><strong>Soundpack-Format</strong><span className="chip ok"><Icon name="check" size={12} />29 Spieldateien bekannt</span></div>
                <div className="faint small">Geprüft mit 12 Creator-Archiven. Beim Bauen wird die Waffen-Zuordnung genutzt; gespeichert wird immer eine ZIP-Datei.</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="stats">
        <div className="panel stat"><div className="s-k"><Icon name="layers" size={15} />Meine Soundpacks</div><div className="s-v"><CountUp value={projects.length} /></div><div className="s-d">{projects.length ? 'Unter „Meine Soundpacks“ öffnen' : 'Noch keins gespeichert'}</div></div>
        <div className="panel stat"><div className="s-k"><Icon name="heart" size={15} />Favoriten</div><div className="s-v"><CountUp value={favorites.length} /></div><div className="s-d">{favorites.length ? 'In der Bibliothek filtern' : 'Tippe bei einem Sound aufs Herz'}</div></div>
        <div className="panel stat"><div className="s-k"><Icon name="sparkles" size={15} />Deine Sounds</div><div className="s-v"><CountUp value={user.length} /></div><div className="s-d">{generated} erzeugt · {edits} bearbeitet · {user.length - generated - edits} importiert</div></div>
        <div className="panel stat"><div className="s-k"><Icon name="gamepad" size={15} />FiveM</div><div className="s-v" style={{ fontSize: 18 }}>{fivem.state === 'done' ? (fivem.value.detected ? 'Gefunden' : 'Nicht gefunden') : fivem.state === 'unavailable' ? 'Nur Windows-App' : '…'}</div><div className="s-d">{fivem.state === 'done' && fivem.value.running ? 'Läuft gerade' : 'Installiertes Pack: keins'}</div></div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h3>Zuletzt gespielt</h3><span className="spacer" />{recentEntries.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate('library')}>Bibliothek öffnen</Button>}</div>
          <div className="panel-body">
            {recentEntries.length ? <div className="recent-list">{recentEntries.map((e) => <RecentRow key={e.id} e={e} />)}</div>
              : <EmptyState icon="wave" title="Noch nichts abgespielt" body="Sounds, die du abspielst oder bearbeitest, erscheinen hier für den schnellen Zugriff." action={<Button variant="primary" onClick={() => navigate('library')}>Sounds durchstöbern</Button>} />}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Meine Soundpacks</h3><span className="spacer" />{projects.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate('projects')}>Alle Soundpacks</Button>}</div>
          <div className="panel-body">
            {projects.length ? (
              <div className="recent-list">
                {projects.slice(0, 5).map((p) => {
                  const filled = WEAPON_PROFILES.reduce((n, w) => n + filledCount(p, w), 0);
                  const ok = validateProject(p, WEAPON_PROFILES).ok;
                  return (
                    <div key={p.id} className="recent-item" onClick={() => openProject(p.id)}>
                      <Icon name="layers" size={18} />
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div><div className="faint small">v{p.version} · {filled} Slots{p.id === currentId ? ' · geöffnet' : ''}</div></div>
                      {filled > 0 && (ok ? <span className="chip ok">Vollständig</span> : <span className="chip warn">Zu beheben</span>)}
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState icon="folder" title="Noch keine Soundpacks" body="Erstelle dein erstes Soundpack – wähle Sounds für jeden Pistolen-Slot, auch für den Schalldämpfer." action={<Button variant="primary" icon="plus" onClick={() => navigate('projects')}>Neues Soundpack</Button>} />}
          </div>
        </section>
      </div>
    </div>
  );
}
