import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from '../app/store';
import { Button, EmptyState } from '../components/ui';
import { appInfo } from '../services/system';
import { LOG_LEVELS, LOG_LEVEL_LABEL, clearLogs, formatLogs, getLogs, subscribeLogs, type LogLevel } from '../services/logger';
import { isTauri, openPath, saveBytes } from '../services/tauri';
import { Icon } from '../components/Icon';

export function LogsView() {
  const version = useSyncExternalStore(subscribeLogs, () => getLogs().length + ':' + (getLogs().at(-1)?.id ?? 0));
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [logDir, setLogDir] = useState<string | null>(null);
  useEffect(() => { void appInfo().then((i) => setLogDir(i?.logDir ?? null)); }, []);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return getLogs().filter((e) => (!levels.length || levels.includes(e.level)) && (!n || e.message.toLowerCase().includes(n) || e.detail?.toLowerCase().includes(n)));
  }, [version, levels, q]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [list.length]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(formatLogs(list)); toast('success', 'Protokoll kopiert', `${list.length} Zeile${list.length === 1 ? '' : 'n'}`); }
    catch { toast('error', 'Zwischenablage nicht verfügbar'); }
  };
  const exportFile = async () => {
    const path = await saveBytes(`sptool-log-${new Date().toISOString().slice(0, 10)}.txt`, new TextEncoder().encode(formatLogs(list)), { name: 'Textdatei', extensions: ['txt'] });
    if (path) toast('success', 'Protokoll exportiert', path);
  };

  return (
    <div className="logs">
      <div className="lib-toolbar" style={{ flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Protokoll durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Protokoll durchsuchen" />
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {LOG_LEVELS.map((l) => (
            <button key={l} className={`chip${levels.includes(l) ? ' accent' : ''}`} style={{ cursor: 'pointer' }} aria-pressed={levels.includes(l)} onClick={() => setLevels(levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l])}>{LOG_LEVEL_LABEL[l]}</button>
          ))}
        </div>
        <span className="spacer" />
        <Button size="sm" icon="copy" onClick={() => void copy()} disabled={!list.length}>Kopieren</Button>
        <Button size="sm" icon="export" onClick={() => void exportFile()} disabled={!list.length}>Exportieren</Button>
        <Button size="sm" icon="folder" disabled={!isTauri() || !logDir} title={isTauri() ? logDir ?? '' : 'Nur in der Windows-App'} onClick={() => logDir && openPath(logDir).catch((e) => toast('error', 'Ordner konnte nicht geöffnet werden', String(e)))}>Protokoll-Ordner öffnen</Button>
        <Button size="sm" variant="ghost" onClick={clearLogs}>Ansicht leeren</Button>
      </div>
      <div className="log-list" ref={listRef}>
        {list.length === 0 ? <EmptyState icon="logs" title="Keine Protokolleinträge" body={levels.length || q ? 'Nichts passt zu diesen Filtern.' : 'Hier erscheinen Meldungen der Audio-Engine, der Erkennung und von Importen.'} /> :
          list.map((e) => (
            <div key={e.id} className="log-row" onClick={() => e.detail && setOpen(open === e.id ? null : e.id)} style={{ cursor: e.detail ? 'pointer' : 'default' }}>
              <span className="faint num">{new Date(e.time).toLocaleTimeString('de-DE')}</span>
              <span className={`lv lv-${e.level}`}>{LOG_LEVEL_LABEL[e.level]}</span>
              <div>
                <span>{e.message}</span>{e.detail && <Icon name={open === e.id ? 'chevronDown' : 'chevron'} size={12} className="faint" />}
                {open === e.id && e.detail && <pre>{e.detail}</pre>}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
