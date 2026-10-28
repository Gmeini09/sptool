// Bar under the top bar when a newer SP Tool is available: one click downloads, checks and installs it.
import { useSyncExternalStore } from 'react';
import { getUpdate, installUpdate, onUpdate, openUpdatePrompt, postponeUpdate, skipUpdate } from '../services/appUpdate';
import { Icon } from './Icon';
import { Button, Modal, Progress } from './ui';
import { ChangeList } from './Changelog';

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export function UpdateBanner() {
  const u = useSyncExternalStore(onUpdate, getUpdate);
  const a = u.available;
  if (!a || u.prompt || (u.dismissed === a.version && u.phase === 'idle')) return null;
  const busy = u.phase === 'downloading' || u.phase === 'installing' || u.phase === 'restarting';
  const text = u.phase === 'downloading' ? `Lade Version ${a.version} herunter…`
    : u.phase === 'installing' ? 'Prüfe und installiere das Update…'
    : u.phase === 'restarting' ? 'Fertig – SP Tool startet gleich neu.'
    : u.phase === 'error' ? `Update fehlgeschlagen: ${u.error}`
    : `Neue Version ${a.version} ist da (${mb(a.size)}). Deine Soundpacks und Einstellungen bleiben erhalten.`;
  return (
    <div className={`update-bar${u.phase === 'error' ? ' err' : ''}`} role="status">
      <span className="update-ic"><Icon name={u.phase === 'error' ? 'alert' : u.phase === 'restarting' ? 'checkCircle' : 'download'} size={16} /></span>
      <div className="grow">
        <div>{text}</div>
        {u.phase === 'downloading' && <Progress value={u.progress} />}
      </div>
      {!busy && <button className="btn primary sm" onClick={() => void installUpdate()}>{u.phase === 'error' ? 'Nochmal versuchen' : 'Jetzt aktualisieren'}</button>}
      {!busy && a.changes.length > 0 && u.phase !== 'error' && <button className="btn ghost sm" onClick={openUpdatePrompt}>Was ist neu?</button>}
      {!busy && <button className="btn ghost sm" onClick={postponeUpdate}>Später</button>}
    </div>
  );
}

/**
 * Window after login / start when the admin has pushed a newer version: what is new, and the choice –
 * install now, later (asks again next start) or skip this version.
 */
export function UpdatePrompt() {
  const u = useSyncExternalStore(onUpdate, getUpdate);
  const a = u.available;
  if (!a || !u.prompt) return null;
  const busy = u.phase === 'downloading' || u.phase === 'installing' || u.phase === 'restarting';
  return (
    <Modal onClose={() => { if (!busy) postponeUpdate(); }}>
      <div className="update-prompt" data-testid="update-prompt">
        <div className="row" style={{ gap: 10, marginBottom: 8 }}>
          <div className="qp-badge"><Icon name="download" size={18} /></div>
          <h3 className="grow" style={{ margin: 0 }}>Update auf SP Tool {a.version}</h3>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>Eine neue Version ist da ({mb(a.size)}). Deine Soundpacks, Einstellungen und die Anmeldung bleiben erhalten. Du entscheidest, ob du sie jetzt installierst.</p>
        {a.changes.length > 0 && <div className="update-notes"><b className="cl-title">Was ist neu?{a.changes.length > 1 ? ` (${a.changes.length} Versionen)` : ''}</b><ChangeList entries={a.changes} /></div>}
        {u.phase === 'downloading' && <Progress value={u.progress} label={`Lade Version ${a.version} herunter…`} />}
        {u.phase === 'installing' && <div className="small muted"><span className="spinner" /> Prüfe und installiere das Update…</div>}
        {u.phase === 'restarting' && <div className="small"><Icon name="checkCircle" size={14} /> Fertig – SP Tool startet gleich neu.</div>}
        {u.phase === 'error' && <div className="small" style={{ color: 'var(--error)' }}>Update fehlgeschlagen: {u.error}</div>}
        {!busy && (
          <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Button variant="primary" icon="download" onClick={() => void installUpdate()}>{u.phase === 'error' ? 'Nochmal versuchen' : 'Jetzt aktualisieren'}</Button>
            <Button variant="ghost" onClick={postponeUpdate}>Später</Button>
            <span className="grow" />
            <Button variant="ghost" onClick={skipUpdate}>Diese Version überspringen</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
