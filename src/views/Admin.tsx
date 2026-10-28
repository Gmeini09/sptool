// Admin panel: users (by Discord ID), licenses, devices (HWID bindings), bans, roles, license keys, audit log.
// Every action is checked and logged by the server – this view only calls the admin API.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Icon } from '../components/Icon';
import { Button, EmptyState, Modal, Segmented } from '../components/ui';
import { CountUp } from '../components/CountUp';
import { discordAvatarUrl, planLabel } from '../components/Shell';
import { api, ApiError, refresh, useAccount, type License, type PublicDevice, type PublicUser } from '../account/account';
import { OWNER_DISCORD_ID } from '../account/config';
import { TIER_LABEL, grantablePlans, tierAtLeast, tierOfPlan, useTier, type Tier } from '../account/perms';
import { toast } from '../app/store';
import { CopyId, DeviceList, errText } from './Account';
import { fmtAgo, fmtDate, fmtDateTime } from './adminFmt';
import { getRelease, onRelease, pushRelease, refreshRelease, versionCmp } from '../services/appRelease';
import { bundledNotes } from '../services/changelog';
import { downloadDetectionFeedback } from '../services/detectionFeedback';
import { saveBytes } from '../services/tauri';

/** Plans the signed-in admin may hand out: Admin up to Creator, Developer everything (the server enforces the same). */
const usePlans = () => grantablePlans(useTier());
const isSnowflake = (s: string) => /^\d{15,21}$/.test(s);

interface Stats { users: number; activeLicenses: number; devices: number; openKeys: number; banned: number; logins24h: number }
interface UserRow extends PublicUser { license: License | null; deviceCount: number }
interface KeyRow { key: string; plan: string; days: number | null; maxDevices: number; note: string | null; createdAt: number; redeemedBy: string | null; redeemedAt: number | null; revoked: boolean }
interface AuditRow { id: number; at: number; actor: string; action: string; target: string | null; detail: Record<string, unknown> | null }

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await fn()); setError(''); } catch (e) { setError(errText(e)); }
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, error, busy, reload: load };
}

function UserAvatar({ u, size = 32 }: { u: { id: string; avatar: string | null; globalName: string | null; username: string }; size?: number }) {
  const [broken, setBroken] = useState(false);
  const url = discordAvatarUrl(u.id, u.avatar);
  const st = { width: size, height: size, fontSize: size * 0.42 };
  if (url && !broken) return <img className="avatar" style={st} src={url} alt="" onError={() => setBroken(true)} />;
  return <div className="avatar" style={st}>{(u.globalName || u.username || '?').slice(0, 1).toUpperCase()}</div>;
}

const licChip = (l: License | null) => {
  if (!l) return <span className="chip">Keine Lizenz</span>;
  if (!l.active) return <span className="chip err">{l.revoked ? 'Widerrufen' : 'Abgelaufen'}</span>;
  return <span className={`chip ${tierAtLeast(tierOfPlan(l.tier ?? l.plan), 'admin') ? 'accent' : 'ok'}`}>{planLabel(l.tier ?? l.plan)}{l.expiresAt ? ` · ${fmtDate(l.expiresAt)}` : ''}</span>;
};

export function AdminView() {
  const isAdmin = useAccount((a) => a.me?.user.role === 'admin');
  const [tab, setTab] = useState<'users' | 'keys' | 'audit'>('users');
  const [open, setOpen] = useState<string | null>(null);
  const stats = useLoad(() => api<Stats>('GET', '/admin/stats'), [tab, open]);
  if (!isAdmin) return <EmptyState icon="lock" title="Nur für Admins" body="Dieser Bereich ist nur für SP-Tool-Admins zugänglich." />;
  const s = stats.data;
  const tiles: Array<[string, number | undefined, string]> = [
    ['Nutzer', s?.users, 'user'], ['Aktive Lizenzen', s?.activeLicenses, 'key'], ['Gebundene PCs', s?.devices, 'monitor'],
    ['Offene Keys', s?.openKeys, 'tag'], ['Gesperrt', s?.banned, 'ban'], ['Anmeldungen 24 h', s?.logins24h, 'bolt'],
  ];
  return (
    <div className="admin page">
      <div className="admin-head rise">
        <div>
          <h2 className="shine-text">Kontrollzentrum</h2>
          <div className="muted small">Lizenzen sind an Discord-IDs gebunden und auf PCs (HWID) festgelegt. Alles, was du hier tust, wird protokolliert.</div>
        </div>
      </div>
      <div className="admin-stats rise">
        {tiles.map(([label, v, icon]) => (
          <div key={label} className="panel stat">
            <div className="s-k"><Icon name={icon as never} size={15} />{label}</div>
            <div className="s-v">{v == null ? '–' : <CountUp value={v} />}</div>
          </div>
        ))}
      </div>
      <BotAppCard />
      <FeedbackCard />
      <div className="row rise" style={{ margin: '18px 0 14px' }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'users', label: 'Nutzer' }, { value: 'keys', label: 'Lizenz-Keys' }, { value: 'audit', label: 'Aktivitätsprotokoll' }]} />
      </div>
      {tab === 'users' && <UsersTab onOpen={setOpen} />}
      {tab === 'keys' && <KeysTab />}
      {tab === 'audit' && <AuditTab onOpen={setOpen} />}
      {open && <UserModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── "Falsch erkannt" corrections from all users (features only) → file for improving the detection ──
function FeedbackCard() {
  const [busy, setBusy] = useState(false);
  const get = async () => {
    setBusy(true);
    try {
      const { count, blob } = await downloadDetectionFeedback();
      if (!count) { toast('info', 'Noch keine Korrekturen', 'Sobald Nutzer „ist Nachladen“ / „ist ein Schuss“ klicken, landen sie hier.'); return; }
      await saveBytes(`sptool-erkennung-feedback-${new Date().toISOString().slice(0, 10)}.json`, new Uint8Array(await blob.arrayBuffer()), { name: 'JSON', extensions: ['json'] });
      toast('success', `${count} Korrekturen gespeichert`, 'Schick die Datei an Claude, um die Erkennung damit zu verbessern.');
    } catch (e) { toast('error', 'Download fehlgeschlagen', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="inst-state rise" style={{ marginTop: 10 }}>
      <Icon name="sparkles" size={18} />
      <div className="grow"><b>Erkennung verbessern</b><div className="small muted">Korrekturen der Nutzer („ist Nachladen“ / „ist ein Schuss“) – nur Messwerte, kein Audio.</div></div>
      <Button size="sm" icon="download" disabled={busy} onClick={() => void get()}>Korrekturen herunterladen</Button>
    </div>
  );
}

// ── push an update to all users ─────────────────────────────────────────────
function BotAppCard() {
  const r = useSyncExternalStore(onRelease, getRelease);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { void refreshRelease(); }, []);
  const cmp = r.appVersion ? versionCmp(r.appVersion, r.botVersion) : null;
  // the notes box starts with what is already pushed for this version – else with its CHANGELOG.md entry
  const fromLog = bundledNotes(r.appVersion);
  useEffect(() => {
    if (touched || cmp === null) return;
    if (cmp === 0) setNotes(r.botNotes || fromLog);
    else if (cmp > 0) setNotes(fromLog);
  }, [r.botNotes, cmp, touched, fromLog]);
  const prefilled = !!fromLog && notes.trim() === fromLog.trim();
  const cls = r.error ? 'bad' : cmp === null ? '' : cmp > 0 ? 'warn' : 'ok';
  const state = !r.appVersion ? 'Verteilen geht nur in der Windows-App.'
    : cmp! > 0 ? `Dieser PC hat v${r.appVersion} – noch nicht verteilt. Erst nach „An alle verteilen“ sehen die Nutzer das Update.`
    : cmp === 0 ? `v${r.appVersion} ist verteilt. Nutzer mit älterer Version sehen das Update nach dem Login und entscheiden selbst.`
    : `Verteilt ist schon die neuere v${r.botVersion} – öffne diese Version, um sie zu verteilen.`;
  return (
    <div className={`inst-state ${cls} rise`} style={{ marginTop: 16, alignItems: 'flex-start' }} data-testid="push-update">
      <Icon name={r.error ? 'alert' : cmp === 0 ? 'check' : 'upload'} size={18} />
      <div className="grow col" style={{ gap: 8 }}>
        <div>
          <b>Update an alle verteilen: </b>
          {r.botVersion ? `verteilt ist v${r.botVersion}` : 'noch keine Version verteilt'}
          {r.appVersion && <span className="faint"> · dieser PC nutzt v{r.appVersion}</span>}
          <div className="small muted">{r.error ?? state} Key-DMs von /sptool-key enthalten immer die verteilte Version.</div>
        </div>
        {r.appVersion && cmp! >= 0 && <>
          <textarea className="input" rows={3} maxLength={1000} placeholder="Was ist neu? (sehen die Nutzer im Update-Fenster, z. B. „Drag & Drop, bessere Reload-Erkennung“)"
            value={notes} onChange={(e) => { setNotes(e.target.value); setTouched(true); }} style={{ width: '100%', minHeight: 76, height: 'auto', resize: 'vertical', paddingTop: 8 }} />
          <div className="small muted">{prefilled ? 'Aus dem Changelog dieser Version übernommen – du kannst es ändern oder ergänzen.' : fromLog ? <>Eigener Text. <button className="link-btn" onClick={() => { setNotes(fromLog); setTouched(true); }}>Changelog-Eintrag einsetzen</button></> : 'Für diese Version gibt es keinen Changelog-Eintrag – schreib kurz, was neu ist.'}</div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" icon="upload" disabled={r.busy || (cmp === 0 && notes.trim() === r.botNotes.trim())}
              onClick={async () => { const res = await pushRelease(notes); if (res !== 'failed') setTouched(false); }}>
              {r.busy ? 'Wird verteilt…' : cmp! > 0 ? `v${r.appVersion} an alle verteilen` : '„Was ist neu?“ speichern'}
            </Button>
            <Button size="sm" variant="ghost" icon="refresh" disabled={r.busy} onClick={() => void refreshRelease()}>Aktualisieren</Button>
          </div>
        </>}
      </div>
    </div>
  );
}

// ── users ────────────────────────────────────────────────────────────────────
function UsersTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const users = useLoad(() => api<{ users: UserRow[] }>('GET', `/admin/users?q=${encodeURIComponent(term)}`), [term]);
  const exact = isSnowflake(term) && !users.data?.users.some((u) => u.id === term);
  return (
    <div className="panel rise">
      <div className="panel-body col" style={{ gap: 12 }}>
        <div className="row">
          <div className="search grow"><Icon name="search" size={16} /><input className="input" placeholder="Name oder Discord-ID suchen…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Nutzer suchen" /></div>
          <Button icon="refresh" onClick={() => void users.reload()}>Neu laden</Button>
        </div>
        {exact && (
          <button className="admin-grant" onClick={() => onOpen(term)}>
            <Icon name="key" size={18} />
            <div className="grow"><b>Discord-ID {term} verwalten</b><div className="faint small">Noch nicht angemeldet – vergib jetzt eine Lizenz, sie gilt ab der ersten Anmeldung.</div></div>
            <Icon name="chevron" size={16} />
          </button>
        )}
        {users.error && <div className="err-text small">{users.error}</div>}
        <div className="user-list">
          {users.data?.users.map((u, i) => (
            <button key={u.id} className="user-row" style={{ ['--i' as string]: i }} onClick={() => onOpen(u.id)}>
              <UserAvatar u={u} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <b className="ellipsis">{u.globalName || u.username || 'Unbekannt'}</b>
                  {u.id === OWNER_DISCORD_ID ? <span className="chip accent">Inhaber</span> : u.role === 'admin' && <span className="chip accent">Admin</span>}
                  {u.banned && <span className="chip err">Gesperrt</span>}
                </div>
                <div className="faint small num">{u.id} · @{u.username || '—'}</div>
              </div>
              <div className="user-meta">
                {licChip(u.license)}
                <span className="chip"><Icon name="monitor" size={12} />{u.deviceCount}</span>
                <span className="faint small hide-sm">{fmtAgo(u.lastLogin)}</span>
              </div>
            </button>
          ))}
          {users.data && !users.data.users.length && !exact && <div className="faint small" style={{ padding: 12 }}>Keine Nutzer gefunden. Gib eine vollständige Discord-ID ein, um jemandem eine Lizenz zu geben, der sich noch nicht angemeldet hat.</div>}
        </div>
      </div>
    </div>
  );
}

interface UserDetail { user: PublicUser; license: License | null; devices: PublicDevice[]; sessions: Array<{ created_at: number; last_used: number; expires_at: number; revoked: number; device_id: string }>; log: AuditRow[] }

function UserModal({ id, onClose }: { id: string; onClose: () => void }) {
  const meId = useAccount((a) => a.me?.user.id);
  const detail = useLoad(async () => {
    try { return await api<UserDetail>('GET', `/admin/users/${id}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }, [id]);
  const d = detail.data;
  const isOwner = id === OWNER_DISCORD_ID;
  const iAmOwner = meId === OWNER_DISCORD_ID;
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<unknown>, confirmKey?: string) => {
    if (confirmKey && armed !== confirmKey) { setArmed(confirmKey); setTimeout(() => setArmed((a) => (a === confirmKey ? null : a)), 3000); return; }
    setArmed(null); setBusy(true);
    try { await fn(); toast('success', label); await detail.reload(); if (id === meId) void refresh(); } catch (e) { toast('error', 'Aktion fehlgeschlagen', errText(e)); }
    setBusy(false);
  };
  const confirmText = (k: string, text: string) => (armed === k ? 'Zum Bestätigen erneut klicken' : text);

  // license form
  const lic = d?.license ?? null;
  const plans = usePlans();
  const myTier = useTier();
  const [plan, setPlan] = useState<string>('premium');
  const [days, setDays] = useState('30');
  const [maxDevices, setMaxDevices] = useState(1);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (lic && lic.source !== 'owner') {
      setPlan(tierOfPlan(lic.tier ?? lic.plan)); setMaxDevices(lic.maxDevices); setNote(lic.note ?? '');
      setDays(lic.expiresAt ? String(Math.max(1, Math.ceil((lic.expiresAt - Date.now()) / 86_400_000))) : '');
    }
  }, [lic?.plan, lic?.maxDevices, lic?.expiresAt]);

  const u = d?.user;
  return (
    <Modal onClose={onClose}>
      <div className="admin-user">
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          {u ? <UserAvatar u={u} size={48} /> : <div className="avatar" style={{ width: 48, height: 48 }}><Icon name="user" size={22} /></div>}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }} className="ellipsis">{u ? u.globalName || u.username : 'Noch nicht angemeldet'}</h3>
              {isOwner ? <span className="chip accent">Inhaber · Developer</span> : u && tierAtLeast(tierOfPlan(u.tier), 'admin') && <span className="chip accent">{TIER_LABEL[tierOfPlan(u.tier)]}</span>}
              {u?.banned && <span className="chip err">Gesperrt</span>}
            </div>
            {u && <div className="faint small">@{u.username} · dabei seit {fmtDate(u.createdAt)} · letzte Anmeldung {fmtAgo(u.lastLogin)}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen"><Icon name="x" size={17} /></button>
        </div>
        <CopyId id={id} />
        {detail.busy && !d && <div className="faint small" style={{ marginTop: 12 }}>Wird geladen…</div>}
        {detail.error && <div className="err-text small" style={{ marginTop: 12 }}>{detail.error}</div>}

        <section className="admin-sec">
          <div className="row"><h4 className="grow">Lizenz</h4>{isOwner ? <span className="chip ok">Developer · dauerhaft</span> : licChip(lic)}</div>
          {isOwner ? <div className="faint small">Der Inhaber hat immer vollen Zugriff.</div> : u && tierAtLeast(tierOfPlan(u.tier), 'admin') && myTier !== 'developer' ? <div className="faint small">Admin- und Developer-Konten kann nur ein Developer ändern.</div> : (
            <form className="lic-form" onSubmit={(e) => { e.preventDefault(); void run('Lizenz gespeichert', () => api('POST', `/admin/users/${id}/license`, { plan, days: days.trim() === '' ? null : Number(days), maxDevices, note })); }}>
              <label className="field">Plan
                <select className="select" value={plans.includes(plan as Tier) ? plan : 'premium'} onChange={(e) => setPlan(e.target.value)}>{plans.map((p) => <option key={p} value={p}>{TIER_LABEL[p]}</option>)}</select>
              </label>
              <label className="field">Tage <span className="faint">(leer = unbegrenzt)</span>
                <input className="input num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="Unbegrenzt" />
              </label>
              <label className="field">PCs (HWID)
                <input className="input num" type="number" min={1} max={20} value={maxDevices} onChange={(e) => setMaxDevices(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
              </label>
              <label className="field span2">Notiz
                <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional, z. B. per PayPal bezahlt" />
              </label>
              <div className="row span2">
                <Button variant="primary" type="submit" icon="check" disabled={busy}>{lic?.active ? 'Lizenz aktualisieren' : 'Lizenz vergeben'}</Button>
                <div className="quick-days">{[7, 30, 90].map((n) => <button type="button" key={n} onClick={() => setDays(String(n))}>{n} T.</button>)}<button type="button" onClick={() => setDays('')}>∞</button></div>
                <span className="spacer" />
                {lic?.active && <Button variant="danger" disabled={busy} onClick={() => void run('Lizenz widerrufen', () => api('POST', `/admin/users/${id}/license`, { plan: 'none' }), 'revoke')}>{confirmText('revoke', 'Widerrufen')}</Button>}
              </div>
            </form>
          )}
        </section>

        {d && (
          <section className="admin-sec">
            <div className="row"><h4 className="grow">PCs (HWID)</h4>
              <Button size="sm" variant="danger" icon="refresh" disabled={busy || !d.devices.length} onClick={() => void run('PCs zurückgesetzt', () => api('POST', `/admin/users/${id}/devices/reset`), 'reset')}>{confirmText('reset', 'Alle zurücksetzen')}</Button>
            </div>
            <div className="faint small" style={{ marginBottom: 8 }}>Ein Zurücksetzen entfernt alle gebundenen PCs und beendet ihre Sitzungen. Die nächste Anmeldung bindet den neuen PC.</div>
            <DeviceList devices={d.devices} onRemove={(dev) => void run('PC entfernt', () => api('DELETE', `/admin/devices/${dev.id}`), `dev:${dev.id}`)} />
          </section>
        )}

        {d && (
          <section className="admin-sec">
            <h4>Zugang</h4>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" icon="logout" disabled={busy} onClick={() => void run('Überall abgemeldet', () => api('POST', `/admin/users/${id}/logout-all`))}>Überall abmelden</Button>
              {iAmOwner && !isOwner && (u?.role === 'admin'
                ? <Button size="sm" disabled={busy} onClick={() => void run('Admin-Rechte entzogen', () => api('POST', `/admin/users/${id}/role`, { role: 'user' }), 'role')}>{confirmText('role', 'Admin-Rechte entziehen')}</Button>
                : <Button size="sm" icon="shield" disabled={busy} onClick={() => void run('Jetzt Admin', () => api('POST', `/admin/users/${id}/role`, { role: 'admin' }), 'role')}>{confirmText('role', 'Zum Admin machen')}</Button>)}
            </div>
            {!isOwner && (u?.banned ? (
              <div className="ban-box">
                <div className="small">Gesperrt{u.banReason ? `: ${u.banReason}` : ''}</div>
                <Button size="sm" disabled={busy} onClick={() => void run('Sperre aufgehoben', () => api('POST', `/admin/users/${id}/unban`))}>Entsperren</Button>
              </div>
            ) : (
              <form className="ban-box" onSubmit={(e) => { e.preventDefault(); void run('Nutzer gesperrt', () => api('POST', `/admin/users/${id}/ban`, { reason }), 'ban'); }}>
                <input className="input grow" placeholder="Grund für die Sperre (wird dem Nutzer angezeigt)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                <Button size="sm" variant="danger" icon="ban" type="submit" disabled={busy}>{confirmText('ban', 'Sperren')}</Button>
              </form>
            ))}
          </section>
        )}

        {d && d.log.length > 0 && (
          <section className="admin-sec">
            <h4>Aktivität</h4>
            <div className="audit-mini">{d.log.slice(0, 12).map((r, i) => <div key={i}><span className="faint num">{fmtDateTime(r.at)}</span><span>{actionLabel(r.action)}</span></div>)}</div>
          </section>
        )}
      </div>
    </Modal>
  );
}

// ── keys ─────────────────────────────────────────────────────────────────────
function KeysTab() {
  const keys = useLoad(() => api<{ keys: KeyRow[] }>('GET', '/admin/keys'), []);
  const plans = usePlans();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [plan, setPlan] = useState('premium');
  const [days, setDays] = useState('30');
  const [count, setCount] = useState(1);
  const [maxDevices, setMaxDevices] = useState(1);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api<{ keys: string[] }>('POST', '/admin/keys', { plan: plans.includes(plan as Tier) ? plan : 'premium', days: days === '' ? null : Number(days), count, maxDevices, note });
      setFresh(r.keys);
      toast('success', `${r.keys.length} Key${r.keys.length > 1 ? 's' : ''} erstellt`);
      await keys.reload();
    } catch (e) { toast('error', 'Keys konnten nicht erstellt werden', errText(e)); }
    setBusy(false);
  };
  const revoke = async (k: string) => {
    try { await api('POST', `/admin/keys/${k}/revoke`); toast('success', 'Key widerrufen'); await keys.reload(); } catch (e) { toast('error', 'Widerrufen fehlgeschlagen', errText(e)); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('success', 'Kopiert'), () => toast('warning', 'Kopieren fehlgeschlagen'));
  const rows = useMemo(() => (keys.data?.keys ?? []).filter((k) => filter === 'all' || (!k.redeemedBy && !k.revoked)), [keys.data, filter]);
  return (
    <div className="col rise" style={{ gap: 14 }}>
      <div className="panel"><div className="panel-body">
        <form className="lic-form keys" onSubmit={(e) => { e.preventDefault(); void generate(); }}>
          <label className="field">Plan<select className="select" value={plans.includes(plan as Tier) ? plan : 'premium'} onChange={(e) => setPlan(e.target.value)}>{plans.map((p) => <option key={p} value={p}>{TIER_LABEL[p]}</option>)}</select></label>
          <label className="field">Tage<input className="input num" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="Unbegrenzt" /></label>
          <label className="field">PCs<input className="input num" type="number" min={1} max={20} value={maxDevices} onChange={(e) => setMaxDevices(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
          <label className="field">Anzahl<input className="input num" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
          <label className="field span2">Notiz<input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional, z. B. Gewinnspiel" /></label>
          <div className="row span2"><Button variant="primary" icon="key" type="submit" disabled={busy}>{busy ? 'Wird erstellt…' : 'Keys erzeugen'}</Button></div>
        </form>
        {fresh.length > 0 && (
          <div className="fresh-keys">
            <div className="row"><b className="grow">Neue Keys – jeder funktioniert einmal</b><Button size="sm" icon="copy" onClick={() => copy(fresh.join('\n'))}>Alle kopieren</Button></div>
            {fresh.map((k) => <button key={k} className="key-pill mono" onClick={() => copy(k)}>{k}<Icon name="copy" size={13} /></button>)}
          </div>
        )}
      </div></div>
      <div className="panel"><div className="panel-body col" style={{ gap: 10 }}>
        <div className="row"><Segmented value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Unbenutzt' }, { value: 'all', label: 'Alle' }]} /><span className="spacer" /><span className="faint small">{rows.length} Keys</span></div>
        {keys.error && <div className="err-text small">{keys.error}</div>}
        <div className="key-table">
          {rows.map((k) => (
            <div key={k.key} className={`key-row${k.revoked ? ' revoked' : ''}`}>
              <button className="mono key-code" onClick={() => copy(k.key)} title="Kopieren">{k.key}</button>
              <span className="chip">{planLabel(k.plan)}</span>
              <span className="faint small">{k.days ? `${k.days} Tage` : 'Unbegrenzt'} · {k.maxDevices} PC{k.maxDevices > 1 ? 's' : ''}</span>
              <span className="grow faint small ellipsis">{k.note}</span>
              {k.revoked ? <span className="chip err">Widerrufen</span> : k.redeemedBy ? <span className="chip ok" title={fmtDateTime(k.redeemedAt)}>Eingelöst von {k.redeemedBy}</span> : <Button size="sm" variant="ghost" onClick={() => void revoke(k.key)}>Widerrufen</Button>}
            </div>
          ))}
          {!rows.length && <div className="faint small">Keine Keys.</div>}
        </div>
      </div></div>
    </div>
  );
}

// ── audit ────────────────────────────────────────────────────────────────────
const ACTIONS: Record<string, string> = {
  login: 'Angemeldet', 'login.denied': 'Anmeldung abgelehnt', 'device.bound': 'Neuer PC gebunden', 'device.removed': 'PC entfernt',
  'devices.reset': 'PCs zurückgesetzt', 'license.set': 'Lizenz gesetzt', 'license.revoked': 'Lizenz widerrufen', 'key.redeemed': 'Key eingelöst',
  'keys.created': 'Keys erstellt', 'key.revoked': 'Key widerrufen', 'user.banned': 'Gesperrt', 'user.unbanned': 'Entsperrt',
  'user.role': 'Rolle geändert', 'sessions.revoked': 'Überall abgemeldet (Admin)', 'logout.all': 'Überall abgemeldet',
};
const actionLabel = (a: string) => ACTIONS[a] ?? a;
const fmtDetail = (d: Record<string, unknown> | null) =>
  d ? Object.entries(d).map(([k, v]) => `${k}: ${/At$|^expires/.test(k) ? (v == null ? 'unbegrenzt' : fmtDate(Number(v))) : v}`).join(' · ') : '';

function AuditTab({ onOpen }: { onOpen: (id: string) => void }) {
  const log = useLoad(() => api<{ entries: AuditRow[] }>('GET', '/admin/audit'), []);
  return (
    <div className="panel rise"><div className="panel-body">
      <div className="row" style={{ marginBottom: 10 }}><span className="grow faint small">Letzte 300 Ereignisse</span><Button size="sm" icon="refresh" onClick={() => void log.reload()}>Neu laden</Button></div>
      {log.error && <div className="err-text small">{log.error}</div>}
      <div className="audit">
        {log.data?.entries.map((r) => (
          <div key={r.id} className={`audit-row${r.action.includes('denied') || r.action.includes('banned') ? ' bad' : ''}`}>
            <span className="faint num">{fmtDateTime(r.at)}</span>
            <b>{actionLabel(r.action)}</b>
            <button className="link num" onClick={() => onOpen(r.actor)}>{r.actor}</button>
            {r.target && isSnowflake(r.target) && r.target !== r.actor ? <span className="faint">→ <button className="link num" onClick={() => onOpen(r.target!)}>{r.target}</button></span> : <span />}
            <span className="faint small ellipsis">{fmtDetail(r.detail)}</span>
          </div>
        ))}
      </div>
    </div></div>
  );
}
