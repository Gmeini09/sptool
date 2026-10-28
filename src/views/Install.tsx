// Install to FiveM + Backups. Every install backs up what it replaces first and can be undone.
import { useEffect, useMemo, useState } from 'react';
import { navigate, notify, toast, useApp } from '../app/store';
import { runDetection } from '../app/App';
import { Icon } from '../components/Icon';
import { Button, DoneMark, EmptyState, Modal, Progress } from '../components/ui';
import { readRpfHeader } from '../formats/rpf';
import {
  KNOWN_ARCHIVES, canonicalArchiveName, deleteBackup, getPendingInstall, installFiles, listBackups, listMods, onPendingInstall,
  restoreBackup, setPendingInstall, type Backup, type InstallError, type ModFile,
} from '../services/install';
import { nativeInfo } from '../services/native';

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (ms: number) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

interface Item { source: string; target: string; bytes: Uint8Array; valid: boolean; problem?: string }

function toItem(name: string, bytes: Uint8Array): Item {
  let valid = true, problem: string | undefined;
  try { readRpfHeader(bytes); } catch (e) { valid = false; problem = e instanceof Error ? e.message : 'Kein RPF-Archiv'; }
  return { source: name, target: canonicalArchiveName(name), bytes, valid, problem };
}

function useNative() {
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => { void nativeInfo().then((i) => setNative(!!i)); }, []);
  return native;
}

function NeedsWindowsApp() {
  return <EmptyState icon="monitor" title="Nur in der Windows-App" body="Zum Installieren und Wiederherstellen braucht SP Tool Zugriff auf deinen FiveM-Ordner. Öffne SP Tool über die Desktop-App (SPTool.exe)." />;
}

function FiveMState() {
  const fivem = useApp((s) => s.fivem);
  if (fivem.state === 'checking') return <div className="inst-state"><span className="spinner" /> FiveM wird gesucht…</div>;
  if (fivem.state !== 'done' || !fivem.value.detected) {
    return (
      <div className="inst-state bad"><Icon name="alert" size={16} /><div><b>FiveM wurde nicht gefunden.</b> Leg den FiveM-Ordner unter Einstellungen → FiveM fest und prüfe dann erneut.</div>
        <Button size="sm" onClick={() => navigate('settings')}>Einstellungen öffnen</Button></div>
    );
  }
  const v = fivem.value;
  return (
    <div className={`inst-state${v.running ? ' warn' : ' ok'}`}>
      <Icon name={v.running ? 'alert' : 'check'} size={16} />
      <div>{v.running ? <><b>FiveM läuft.</b> Schließ es vor dem Installieren – Dateien, die gerade benutzt werden, lassen sich nicht sicher ersetzen.</> : <><b>FiveM gefunden</b> · <span className="mono small">{v.appDir}\mods</span></>}</div>
      <Button size="sm" variant="ghost" icon="refresh" onClick={() => void runDetection()}>Erneut prüfen</Button>
    </div>
  );
}

export function InstallView() {
  const native = useNative();
  const fivem = useApp((s) => s.fivem);
  const [items, setItems] = useState<Item[]>([]);
  const [pack, setPack] = useState('');
  const [version, setVersion] = useState('1.0');
  const [mods, setMods] = useState<ModFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<number | null>(null);
  const [done, setDone] = useState<Backup | null>(null);

  const refreshMods = () => { void listMods().then(setMods).catch(() => setMods(null)); };
  useEffect(() => {
    const take = () => {
      const p = getPendingInstall();
      if (!p) return;
      setItems(p.files.map((f) => toItem(f.name, f.bytes)));
      setPack(p.pack); setVersion(p.version); setDone(null);
      setPendingInstall(null);
    };
    take();
    return onPendingInstall(take);
  }, []);
  useEffect(() => { if (native) refreshMods(); }, [native, fivem.state]);

  if (native === false) return <div className="page"><NeedsWindowsApp /></div>;

  const ready = fivem.state === 'done' && fivem.value.detected;
  const running = fivem.state === 'done' && fivem.value.running;
  const targets = items.map((i) => i.target.toLowerCase());
  const dup = targets.some((t, i) => targets.indexOf(t) !== i);
  const replaces = new Set((mods ?? []).map((m) => m.name.toLowerCase()));
  const checks = [
    { ok: ready, label: 'FiveM gefunden' },
    { ok: ready && !running, label: 'FiveM ist geschlossen' },
    { ok: items.length > 0 && items.every((i) => i.valid), label: 'Dateien sind gültige GTA-V-Archive (RPF7)' },
    { ok: items.length > 0 && !dup, label: 'Jeder Zielname kommt nur einmal vor' },
    { ok: true, label: 'Von jeder ersetzten Datei wird vorher ein Backup erstellt' },
  ];
  const canInstall = checks.every((c) => c.ok) && !busy;

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const add: Item[] = [];
    for (const f of Array.from(list)) add.push(toItem(f.name, new Uint8Array(await f.arrayBuffer())));
    setItems((cur) => [...cur, ...add]);
    if (!pack) setPack('Mein Soundpack');
    setDone(null);
  };

  const install = async () => {
    setBusy('Wird vorbereitet…'); setProg(0);
    try {
      const b = await installFiles(items.map((i) => ({ name: i.target, bytes: i.bytes })), pack.trim() || 'Soundpack', version.trim() || '1.0',
        (d, t) => { setBusy(d < t ? `Kopiere ${d + 1} / ${t}…` : 'Backup und Installation…'); setProg(d < t ? d / t : null); });
      setDone(b); setItems([]);
      toast('success', 'Soundpack installiert', 'Starte FiveM, um es zu hören. Vorher wurde ein Backup erstellt.');
      notify('Soundpack installiert', `${b.installed?.length ?? 0} Archiv(e) · Backup ${b.id}`);
      refreshMods();
    } catch (e) {
      const err = e as InstallError;
      toast('error', err.code === 'running' ? 'FiveM läuft' : 'Installation fehlgeschlagen', err.message);
      if (err.code === 'running') void runDetection();
    } finally { setBusy(null); setProg(null); }
  };

  return (
    <div className="page install-page">
      <div className="panel">
        <div className="panel-head"><h3>1 · FiveM gefunden?</h3></div>
        <div className="panel-body"><FiveMState /></div>
      </div>

      {done && (
        <div className="panel inst-done">
          <div className="panel-body row">
            <DoneMark />
            <div className="grow"><b>Installiert: {done.installed?.map((f) => f.name).join(' + ')}</b><div className="muted small">Backup {done.id} enthält die vorherigen Dateien. Unter „Backups“ kannst du das jederzeit rückgängig machen.</div></div>
            <Button icon="archive" onClick={() => navigate('backups')}>Backups öffnen</Button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head row"><h3 className="grow">2 · Dateien zum Installieren</h3>
          <label className="btn sm"><Icon name="upload" size={15} />.rpf-Dateien hinzufügen<input type="file" accept=".rpf" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} /></label>
        </div>
        <div className="panel-body">
          {!items.length ? (
            <EmptyState icon="install" title="Keine Dateien ausgewählt" body="Bau ein Soundpack, exportiere eins aus der Pack-Analyse oder füge .rpf-Dateien hinzu, die du schon hast." action={<Button icon="box" onClick={() => navigate('analyzer')}>Pack-Analyse öffnen</Button>} />
          ) : (
            <div className="inst-list">
              {items.map((it, i) => (
                <div key={i} className={`inst-row${it.valid ? '' : ' bad'}`}>
                  <Icon name={it.valid ? 'box' : 'alert'} size={18} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis"><b>{it.source}</b> <span className="faint small">· {fmtSize(it.bytes.byteLength)}</span></div>
                    {it.valid ? <div className="small muted">Wird installiert als{' '}
                      <select className="select inline" value={it.target} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
                        {[...new Set([it.target, ...KNOWN_ARCHIVES])].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>{' '}{replaces.has(it.target.toLowerCase()) ? <span className="chip warn">ersetzt aktuelle Datei – mit Backup</span> : <span className="chip">neue Datei</span>}
                    </div> : <div className="small err-text">{it.problem}</div>}
                  </div>
                  <button className="icon-btn" title="Entfernen" aria-label="Entfernen" onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
                </div>
              ))}
              <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
                <label className="field grow"><span className="small muted">Pack-Name</span><input className="input" value={pack} maxLength={80} onChange={(e) => setPack(e.target.value)} placeholder="z. B. Turbo Pistol Pack" /></label>
                <label className="field" style={{ width: 120 }}><span className="small muted">Version</span><input className="input" value={version} maxLength={20} onChange={(e) => setVersion(e.target.value)} /></label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>3 · Installieren</h3></div>
        <div className="panel-body">
          <ul className="inst-checks">{checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}><Icon name={c.ok ? 'check' : 'dot'} size={15} />{c.label}</li>)}</ul>
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="primary" size="lg" icon="install" disabled={!canInstall} onClick={() => void install()}>{busy ?? 'In FiveM installieren'}</Button>
            {busy && <span className="spinner" />}
          </div>
          {busy && <Progress value={prog} label={busy} />}
        </div>
      </div>

      {mods && (
        <div className="panel">
          <div className="panel-head"><h3>Aktuell im mods-Ordner von FiveM</h3></div>
          <div className="panel-body">
            {mods.length ? <div className="inst-mods">{mods.map((m) => <div key={m.name} className="row"><Icon name="box" size={15} /><span className="grow">{m.name}</span><span className="faint small">{fmtSize(m.size)} · {fmtDate(m.modified)}</span></div>)}</div>
              : <div className="muted small">Keine .rpf-Dateien – FiveM nutzt die originalen Spielsounds.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function BackupsView() {
  const native = useNative();
  const [list, setList] = useState<Backup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ b: Backup; action: 'restore' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => { void listBackups().then((l) => { setList(l); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e))); };
  useEffect(() => { if (native) load(); }, [native]);

  // the oldest backup that contains a file holds that file's original state
  const originals = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of [...(list ?? [])].reverse()) for (const f of b.files) if (!seen.has(f.name.toLowerCase())) seen.set(f.name.toLowerCase(), b.id);
    return new Set(seen.values());
  }, [list]);

  if (native === false) return <div className="page"><NeedsWindowsApp /></div>;

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === 'restore') {
        const safety = await restoreBackup(confirm.b.id);
        toast('success', 'Backup wiederhergestellt', `Der vorherige Zustand wurde als Backup ${safety.id} gesichert – du kannst das also rückgängig machen.`);
      } else {
        await deleteBackup(confirm.b.id);
        toast('success', 'Backup gelöscht');
      }
      setConfirm(null); load();
    } catch (e) {
      toast('error', confirm.action === 'restore' ? 'Wiederherstellen fehlgeschlagen' : 'Löschen fehlgeschlagen', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="page install-page">
      <div className="callout info"><Icon name="shield" size={18} /><div className="small">SP Tool sichert jede Datei, bevor sie ersetzt wird, prüft sie mit einem SHA-256-Hash und stellt nur Dateien wieder her, deren Hash noch stimmt. Vor dem Wiederherstellen wird der aktuelle Zustand gesichert, also lässt sich auch das rückgängig machen.</div></div>
      {error && <div className="callout danger"><Icon name="alert" size={18} /><div className="small">{error}</div></div>}
      {list && !list.length && <EmptyState icon="archive" title="Keine Backups" body="SP Tool installiert nichts mehr automatisch in FiveM – deine Packs kommen als ZIP in die Downloads. Backups aus früheren Versionen würden hier stehen." />}
      {list && list.length > 0 && (
        <div className="backup-list">
          {list.map((b) => (
            <div key={b.id} className="panel backup-row">
              <div className="panel-body row">
                <Icon name={b.kind === 'install' ? 'archive' : 'undo'} size={20} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <b>{b.kind === 'install' ? `Vor Installation von ${b.pack}` : `Vor Wiederherstellung von ${b.pack}`}</b>
                    {b.version && <span className="chip">v{b.version}</span>}
                    {originals.has(b.id) && <span className="chip accent">enthält Originaldateien</span>}
                  </div>
                  <div className="small muted">{fmtDate(b.createdAt)} · {fmtSize(b.size)} · {b.files.map((f) => `${f.name}${f.existed ? '' : ' (war neu)'}`).join(', ')}</div>
                </div>
                <Button icon="undo" onClick={() => setConfirm({ b, action: 'restore' })}>Wiederherstellen</Button>
                <button className="icon-btn" title="Backup löschen" aria-label="Backup löschen" onClick={() => setConfirm({ b, action: 'delete' })}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <Modal onClose={() => !busy && setConfirm(null)}>
          <h3>{confirm.action === 'restore' ? 'Dieses Backup wiederherstellen?' : 'Dieses Backup löschen?'}</h3>
          <p className="muted">{confirm.action === 'restore'
            ? `Der mods-Ordner von FiveM wird auf den Stand vom ${fmtDate(confirm.b.createdAt)} zurückgesetzt: ${confirm.b.files.map((f) => (f.existed ? `${f.name} wird zurückgelegt` : `${f.name} wird entfernt`)).join(', ')}. FiveM muss geschlossen sein.`
            : 'Die gesicherten Dateien werden endgültig gelöscht. Dein installiertes Soundpack bleibt unverändert.'}</p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setConfirm(null)} disabled={busy}>Abbrechen</Button>
            <Button variant={confirm.action === 'delete' ? 'danger' : 'primary'} icon={confirm.action === 'restore' ? 'undo' : 'trash'} disabled={busy} onClick={() => void run()}>{confirm.action === 'restore' ? 'Wiederherstellen' : 'Löschen'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
