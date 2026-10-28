// Changelog views: the list of versions with their changes, and „Neu in SP Tool …“ once after an update.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { bundledChangelog, changesBetween, getServerHistory, mergeChangelog, onServerHistory, type ChangeEntry } from '../services/changelog';
import { versionCmp } from '../services/appRelease';
import { getUpdate, onUpdate } from '../services/appUpdate';
import { useAccount } from '../account/account';
import { Icon } from './Icon';
import { Button, Modal } from './ui';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/** Versions with their changes, newest first. `current` marks the installed version. */
export function ChangeList({ entries, current, max }: { entries: ChangeEntry[]; current?: string; max?: number }) {
  const shown = max ? entries.slice(0, max) : entries;
  if (!shown.length) return <div className="small muted">Noch keine Änderungen eingetragen.</div>;
  return (
    <div className="changelog">
      {shown.map((e) => (
        <section key={e.version} className="cl-entry">
          <div className="cl-head">
            <b>Version {e.version}</b>
            {e.version === current && <span className="chip ok">installiert</span>}
            {e.date && <span className="faint small">{e.date}</span>}
          </div>
          <ul>{e.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

/** Built-in changelog plus the admin's texts from the server (when known), newest first. */
export function useChangelog(): ChangeEntry[] {
  const hist = useSyncExternalStore(onServerHistory, getServerHistory);
  return mergeChangelog(hist, bundledChangelog());
}

const SEEN_KEY = 'sptool:seen-version';
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (v: string) => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* storage blocked */ } };

/** Version this PC ran before (null on the first start). Remembered right away, so the window shows only once. */
const previous = (() => { const p = readSeen(); writeSeen(APP_VERSION); return p; })();

/**
 * „Neu in SP Tool 1.9.7“ – once after an update, with everything since the version this PC had before.
 * Waits until the user is signed in (so the admin's texts are there) and no update window is open.
 */
export function WhatsNew() {
  const entries = useChangelog();
  const ready = useAccount((a) => a.phase === 'ready');
  const upd = useSyncExternalStore(onUpdate, getUpdate);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const fresh = !!previous && versionCmp(APP_VERSION, previous) > 0;
  useEffect(() => {
    if (!fresh || done || !ready) return;
    const t = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(t);
  }, [fresh, done, ready]);
  if (!open || done || upd.prompt) return null;
  const list = changesBetween(entries, previous, APP_VERSION);
  if (!list.length) return null;
  const close = () => { setDone(true); setOpen(false); };
  return (
    <Modal onClose={close}>
      <div className="update-prompt" data-testid="whats-new">
        <div className="row" style={{ gap: 10, marginBottom: 8 }}>
          <div className="qp-badge"><Icon name="sparkles" size={18} /></div>
          <h3 className="grow" style={{ margin: 0 }}>Neu in SP Tool {APP_VERSION}</h3>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>Das Update ist installiert. Das hat sich seit Version {previous} geändert:</p>
        <div className="update-notes"><ChangeList entries={list} /></div>
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><Button variant="primary" onClick={close}>Alles klar</Button></div>
      </div>
    </Modal>
  );
}
