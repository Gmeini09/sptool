// SP Tool Cloud: every project with its sync status. Safe cases sync automatically;
// conflicts always wait for a decision and never lose data.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { navigate, useApp } from '../app/store';
import { accountsEnabled } from '../account/config';
import { Icon, type IconName } from '../components/Icon';
import { Button, DoneMark, EmptyState, Modal, Toggle } from '../components/ui';
import { autoSyncEnabled, getCloud, onCloud, refreshCloud, resolve, setAutoSync, syncNow, type CloudRow, type CloudStatus } from '../projects/cloud';

const STATUS: Record<CloudStatus, { label: string; icon: IconName; cls: string }> = {
  synced: { label: 'Synchronisiert', icon: 'check', cls: 'ok' },
  modified: { label: 'Auf diesem PC geändert – wird beim nächsten Abgleich hochgeladen', icon: 'upload', cls: 'info' },
  'cloud-newer': { label: 'Neuere Version in der Cloud – wird beim nächsten Abgleich heruntergeladen', icon: 'download', cls: 'info' },
  'local-only': { label: 'Nur auf diesem PC – wird beim nächsten Abgleich hochgeladen', icon: 'upload', cls: 'info' },
  'cloud-only': { label: 'Nur in der Cloud – wird beim nächsten Abgleich heruntergeladen', icon: 'download', cls: 'info' },
  conflict: { label: 'Hier und auf einem anderen PC geändert – wähle, was du behalten willst', icon: 'alert', cls: 'warn' },
  'deleted-in-cloud': { label: 'Auf einem anderen PC aus der Cloud gelöscht', icon: 'trash', cls: 'warn' },
  'removed-here': { label: 'Auf diesem PC gelöscht – noch in der Cloud', icon: 'trash', cls: 'warn' },
  unlinked: { label: 'Nur auf diesem PC – aus der Cloud entfernt, wird nicht erneut hochgeladen', icon: 'lock', cls: 'info' },
};
const fmtMB = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const ago = (t: number | null) => { if (!t) return 'noch nie'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} Min.` : new Date(t).toLocaleString('de-DE'); };

export function CloudView() {
  const c = useSyncExternalStore(onCloud, getCloud);
  const projectsVersion = useApp((s) => s.projects);
  const [auto, setAuto] = useState(autoSyncEnabled());
  const [confirm, setConfirm] = useState<CloudRow | null>(null);
  useEffect(() => { if (accountsEnabled()) void refreshCloud().catch(() => {}); }, [projectsVersion]);

  if (!accountsEnabled()) return <div className="page"><EmptyState icon="cloud" title="Melde dich an, um die Cloud zu nutzen" body="SP Tool Cloud hält deine Soundpacks auf all deinen PCs synchron. Dafür musst du mit deinem SP Tool-Konto angemeldet sein." /></div>;

  const order: CloudStatus[] = ['conflict', 'deleted-in-cloud', 'removed-here', 'unlinked', 'modified', 'local-only', 'cloud-newer', 'cloud-only', 'synced'];
  const rows = [...c.rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
  const pending = rows.filter((r) => r.status !== 'synced' && r.status !== 'unlinked').length;
  const u = c.usage;

  return (
    <div className="page install-page">
      <div className="panel">
        <div className={`panel-body cloud-head${c.busy ? ' busy' : ''}`}>
          {!c.busy && !c.error && rows.length > 0 && !pending ? <DoneMark key={c.lastSync ?? 0} small /> : <Icon name="cloud" size={22} />}
          <div className="grow">
            <b>{c.error ? 'Cloud nicht erreichbar' : pending ? `${pending} Soundpack${pending > 1 ? 's' : ''} nicht synchron` : rows.length ? 'Alles ist synchron' : 'Noch keine Soundpacks'}</b>
            <div className="small muted">{c.error ?? `Letzter Abgleich: ${ago(c.lastSync)}`}{u ? ` · ${fmtMB(u.bytes)} von ${fmtMB(u.maxBytes)} belegt` : ''}</div>
            {u && <div className="cloud-bar"><i style={{ width: `${Math.min(100, (u.bytes / u.maxBytes) * 100)}%` }} /></div>}
          </div>
          <Toggle on={auto} label="Automatisch synchronisieren" onChange={(v) => { setAuto(v); setAutoSync(v); }} />
          <Button variant="primary" icon="refresh" disabled={c.busy} onClick={() => void syncNow()}>{c.busy ? 'Wird synchronisiert…' : 'Jetzt synchronisieren'}</Button>
        </div>
      </div>

      <div className="callout info small"><Icon name="shield" size={16} /><div>Soundpacks und die Sounds darin werden mit deinem Discord-Konto gespeichert. Jede Änderung wird mit dem Stand in der Cloud abgeglichen – wurde ein Soundpack auf zwei PCs geändert, fragt SP Tool nach, statt zu überschreiben. Der Versionsverlauf (Zwischenstände) bleibt auf dem jeweiligen PC.</div></div>

      {!rows.length && !c.busy && <EmptyState icon="folder" title="Noch nichts zu synchronisieren" body="Erstelle ein Soundpack – es wird beim nächsten Abgleich hochgeladen." action={<Button icon="plus" onClick={() => navigate('projects')}>Meine Soundpacks öffnen</Button>} />}

      <div className="backup-list">
        {rows.map((r) => {
          const st = STATUS[r.status];
          return (
            <div key={`${r.id}:${r.status}`} className={`panel cloud-row ${st.cls}`}>
              <div className="panel-body row">
                <Icon name={st.icon} size={18} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis"><b>{r.name}</b>{r.cloud && !r.cloud.deleted && <span className="faint small"> · Rev. {r.cloud.rev} · {fmtMB(r.cloud.size)}</span>}</div>
                  <div className="small muted">{st.label}</div>
                </div>
                {r.status === 'conflict' && r.cloud?.deleted && <>
                  <Button size="sm" disabled={c.busy} onClick={() => void resolve(r, 'local')}>Behalten und erneut hochladen</Button>
                  <Button size="sm" variant="danger" disabled={c.busy} onClick={() => void resolve(r, 'remove-local')}>Remove here too</Button>
                </>}
                {r.status === 'conflict' && !r.cloud?.deleted && <>
                  <Button size="sm" disabled={c.busy} onClick={() => void resolve(r, 'local')}>Version dieses PCs behalten</Button>
                  <Button size="sm" disabled={c.busy} onClick={() => void resolve(r, 'cloud')}>Cloud-Version verwenden</Button>
                  <Button size="sm" variant="primary" disabled={c.busy} onClick={() => void resolve(r, 'both')}>Beide behalten</Button>
                </>}
                {r.status === 'deleted-in-cloud' && <>
                  <Button size="sm" disabled={c.busy} onClick={() => void resolve(r, 'local')}>Upload again</Button>
                  <Button size="sm" variant="danger" disabled={c.busy} onClick={() => void resolve(r, 'remove-local')}>Remove here too</Button>
                </>}
                {r.status === 'removed-here' && <>
                  <Button size="sm" disabled={c.busy} onClick={() => void resolve(r, 'restore')}>Hier wiederherstellen</Button>
                  <Button size="sm" variant="danger" disabled={c.busy} onClick={() => void resolve(r, 'delete-cloud')}>Auch aus der Cloud löschen</Button>
                </>}
                {r.status === 'unlinked' && <Button size="sm" disabled={c.busy} onClick={() => void resolve(r, 'local')}>Upload again</Button>}
                {r.cloud && !r.cloud.deleted && r.status !== 'conflict' && r.status !== 'removed-here' && (
                  <button className="icon-btn" title="Aus der Cloud löschen" aria-label="Aus der Cloud löschen" disabled={c.busy} onClick={() => setConfirm(r)}><Icon name="trash" size={16} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <h3>„{confirm.name}“ aus der Cloud löschen?</h3>
          <p className="muted">{confirm.local ? 'Das Soundpack bleibt auf diesem PC und wird nur wieder hochgeladen, wenn du das willst. Andere PCs werden gefragt, ob sie ihre Kopie entfernen sollen.' : 'Dieses Soundpack gibt es nur in der Cloud und ist danach endgültig weg.'}</p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setConfirm(null)}>Abbrechen</Button>
            <Button variant="danger" icon="trash" disabled={c.busy} onClick={() => { void resolve(confirm, 'delete-cloud'); setConfirm(null); }}>Aus der Cloud löschen</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
