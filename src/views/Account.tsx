// Discord sign-in screen, license gate and the account panel (Settings → Account).
import { useEffect, useState, type ReactNode } from 'react';
import { DecorWave } from '../components/MiniWave';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { Avatar } from '../components/Shell';
import { TIER_LABEL, levelLabel, ticketTier } from '../account/perms';
import { Turbine } from '../components/Turbine';
import { API_URL } from '../account/config';
import { ApiError, cancelSignIn, openExternal, redeemKey, refresh, signIn, signOut, useAccount, type AccountState, type PublicDevice } from '../account/account';
import { fmtDate, fmtDateTime } from './adminFmt';
import { toast } from '../app/store';

export function CopyId({ id, label = 'Discord-ID' }: { id: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(id); setDone(true); setTimeout(() => setDone(false), 1400); } catch { toast('warning', 'Kopieren fehlgeschlagen', id); }
  };
  return (
    <button className={`copy-id${done ? ' done' : ''}`} onClick={copy} title={`${label} kopieren`}>
      <span className="faint">{label}</span><span className="num">{id}</span><Icon name={done ? 'check' : 'copy'} size={14} />
    </button>
  );
}

/** "diesen PC" / "dieses Handy" / "diesen Browser" – from the device the app runs on. */
function useThisDevice(): string {
  const k = useAccount((a) => a.device?.kind);
  return k === 'mobile' ? 'dieses Handy' : k === 'browser' ? 'diesen Browser' : 'diesen PC';
}

function AuthShell({ children }: { children: ReactNode }) {
  const thisDevice = useThisDevice();
  return (
    <div className="welcome auth-screen">
      <section className="welcome-brand brand-hero">
        <div className="row brand-row"><img className="brand-emblem" src="assets/brand/emblem.jpg" height={34} alt="" /><span className="brand-name" style={{ fontSize: 17 }}>SP Tool</span><span className="brand-by">von Turbo Design</span></div>
        <h1 className="shine-text">FiveM Soundpack Creator</h1>
        <p>Deine Lizenz ist an dein Discord-Konto und {thisDevice} gebunden.</p>
        <DecorWave className="welcome-wave" bars={120} />
        <div className="claim">Erstellen. Vorhören. Bauen. Installieren.</div>
      </section>
      <section className="welcome-side"><div className="welcome-card">{children}</div></section>
    </div>
  );
}

export function AccountSplash() {
  return (
    <div className="auth-splash">
      <Turbine size={120} spin="spool" />
      <img src="assets/brand/emblem.jpg" alt="" className="splash-emblem" />
      <div className="muted small">Deine Lizenz wird geprüft…</div>
    </div>
  );
}

export function LoginScreen() {
  const acc = useAccount((a) => a);
  const err = acc.error;
  return (
    <AuthShell>
      <div className="col" style={{ gap: 16 }}>
        <div>
          <h2>Anmelden</h2>
          <p className="muted" style={{ margin: 0 }}>SP Tool nutzt dein Discord-Konto als Lizenz. Die Anmeldung läuft über Discord – SP Tool sieht dein Passwort nie.</p>
        </div>
        {err && (
          <div className={`callout ${err.code === 'device_limit' || err.code === 'banned' ? 'danger' : ''} small`}>
            <Icon name="alert" size={16} />
            <div className="col" style={{ gap: 8 }}>
              <div>{err.message}</div>
              {err.discordId && <CopyId id={err.discordId} />}
            </div>
          </div>
        )}
        {acc.phase === 'signing-in' ? (
          acc.oneClick === undefined ? <div className="signin-wait"><span className="spinner" /><div><b>Einen Moment…</b></div></div>
          : acc.oneClick ? (
            <div className="col" style={{ gap: 12 }}>
              <div className="signin-wait"><span className="spinner" /><div><b>Klick im Browser auf „Autorisieren“</b><div className="faint small">Discord hat sich gerade im Browser geöffnet. Danach geht es hier automatisch weiter – beim nächsten Mal sogar ohne Klick.</div></div></div>
              <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <Button variant="ghost" onClick={() => cancelSignIn()}>Abbrechen</Button>
                {acc.loginUrl && <button className="pair-alt" onClick={() => void openExternal(acc.loginUrl!)}>Browser nicht geöffnet? Hier klicken</button>}
              </div>
            </div>
          ) : <PairBox acc={acc} />
        ) : (
          <Button variant="primary" size="lg" className="discord-btn" icon="discord" onClick={() => signIn()} disabled={!acc.device}>Mit Discord anmelden</Button>
        )}
        <DeviceNote acc={acc} />
        <ServerState />
      </div>
    </AuthShell>
  );
}

/** Shows whether the license server answers – the most common reason a sign-in cannot finish. */
function ServerState() {
  const [st, setSt] = useState<'checking' | 'ok' | 'err'>('checking');
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(`${API_URL}/api/v1/health`, { signal: ctl.signal });
        clearTimeout(t);
        if (alive) setSt(r.ok ? 'ok' : 'err');
      } catch { if (alive) setSt('err'); }
    };
    void check();
    const iv = setInterval(check, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return (
    <div className={`server-state ${st}`}>
      <span className={`dot ${st === 'ok' ? 'ok' : st === 'err' ? 'err' : ''}`} />
      {st === 'ok' ? 'Lizenzserver online' : st === 'err' ? 'Lizenzserver nicht erreichbar – Anmelden ist gerade nicht möglich' : 'Lizenzserver wird geprüft…'}
    </div>
  );
}

function DeviceNote({ acc }: { acc: AccountState }) {
  if (!acc.device) return null;
  return (
    <div className="callout info small">
      <Icon name="monitor" size={16} />
      {acc.device.kind === 'desktop'
        ? <div>
            Dieser PC (<b>{acc.device.name}</b>) wird beim Anmelden für deine Lizenz registriert. Eine Lizenz läuft nur auf einer begrenzten Zahl von PCs und kann daher nicht weitergegeben werden.
            {!acc.device.strong && ' Im Browser steckt die Geräte-ID in den Website-Daten – löschst du sie, zählt das als neuer PC.'}
          </div>
        : <div>
            {acc.device.kind === 'mobile' ? 'Dieses Handy' : 'Dieser Browser'} (<b>{acc.device.name}</b>) wird beim Anmelden für deine Lizenz registriert. Zusätzlich zu deinen PCs kann pro Lizenz <b>ein</b> Handy oder Browser angemeldet sein – meldest du ein neues an, wird das vorige abgemeldet.
          </div>}
    </div>
  );
}

/** Sign-in in two steps: copy one command, send it in Discord – the app continues by itself. */
function PairBox({ acc }: { acc: AccountState }) {
  const [copied, setCopied] = useState(false);
  const cmd = acc.pairCode ? `/sptool verbinden code:${acc.pairCode}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { toast('warning', 'Kopieren ging nicht', 'Markiere den Befehl und drück Strg + C.'); }
  };
  return (
    <div className="col pair-box" style={{ gap: 12 }}>
      <ol className="pair-steps">
        <li><b>Befehl kopieren</b>
          <div className="pair-cmd" title="Klicken zum Kopieren" onClick={() => void copy()}>{cmd || 'Code wird erstellt…'}</div>
          <Button variant="primary" icon={copied ? 'check' : 'copy'} disabled={!cmd} onClick={() => void copy()}>{copied ? 'Kopiert!' : 'Befehl kopieren'}</Button>
        </li>
        <li><b>In Discord einfügen und abschicken</b> – auf dem Server mit dem SP-Tool-Bot.
          <div><Button icon="discord" onClick={() => void openExternal('https://discord.com/app')}>Discord öffnen</Button></div>
        </li>
        <li><b>„Ja, das ist mein PC“ klicken</b> – SP Tool meldet dich dann automatisch an.</li>
      </ol>
      <div className="signin-wait"><span className="spinner" /><div><b>Warte auf Discord…</b><div className="faint small">Der Code gilt 10 Minuten und nur für diesen PC. Gib ihn niemandem weiter.</div></div></div>
      <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={() => cancelSignIn()}>Abbrechen</Button>
        {acc.loginUrl && <button className="pair-alt" onClick={() => void openExternal(acc.loginUrl!)}>Stattdessen im Browser anmelden</button>}
      </div>
    </div>
  );
}

const REASON: Record<string, string> = {
  missing: 'Dein Konto hat noch keine aktive Lizenz.',
  expired: 'Deine Lizenz ist abgelaufen.',
  device: 'Dieses Lizenz-Ticket gehört zu einem anderen PC.',
  signature: 'Das Lizenz-Ticket ist ungültig.',
  malformed: 'Das Lizenz-Ticket ist beschädigt.',
  unsupported: 'Dieses System kann Lizenz-Signaturen nicht prüfen (aktualisiere Windows / WebView2).',
  offline_grace: 'Du warst zu lange offline. Verbinde dich mit dem Internet, um deine Lizenz zu bestätigen.',
  account: 'Diese Lizenz gehört zu einem anderen Discord-Konto.',
  clock: 'Die Uhrzeit deines PCs wurde verstellt. Verbinde dich mit dem Internet, um deine Lizenz zu bestätigen.',
};

export function RedeemForm({ onDone }: { onDone?: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const lic = await redeemKey(key.trim());
      toast('success', 'Lizenz aktiviert', lic ? `${levelLabel(lic.tier ?? lic.plan)}${lic.expiresAt ? ` bis ${fmtDate(lic.expiresAt)}` : ''}` : undefined);
      setKey('');
      onDone?.();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  return (
    <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="row">
        <input className="input mono grow" placeholder="SPT-XXXX-XXXX-XXXX-XXXX" value={key} maxLength={24} onChange={(e) => setKey(e.target.value.toUpperCase())} aria-label="Lizenz-Key" />
        <Button variant="primary" type="submit" disabled={busy || key.trim().length < 20}>{busy ? 'Wird geprüft…' : 'Einlösen'}</Button>
      </div>
      {err && <div className="err-text small">{err}</div>}
    </form>
  );
}

const maskKey = (source?: string | null) => {
  const m = /^key:(SPT-[A-Z0-9-]+)$/.exec(source ?? '');
  return m ? `${m[1].slice(0, 8)}••••-••••-${m[1].slice(-4)}` : null;
};
const sourceText = (src?: string | null) => (src === 'owner' ? 'Zugang als Inhaber' : maskKey(src) ? `Key ${maskKey(src)}` : src === 'admin' ? 'Von einem Admin vergeben' : '');

/**
 * The three things a license is bound to: Discord account, license key, this PC's hardware ID.
 * Shown at the start (gate + first onboarding step) so it is clear the license cannot be passed on.
 */
export function ActivationChecklist() {
  const acc = useAccount((a) => a);
  const me = acc.me;
  const lic = me?.license ?? null;
  const ok = !!acc.access?.ok;
  const reason = acc.access && !acc.access.ok ? acc.access.reason : 'missing';
  const dev = acc.device;
  const bound = me?.devices.find((d) => d.id === me.currentDevice);
  const used = me ? me.devices.filter((d) => !d.revoked).length : 0;
  const fp = dev ? `${dev.hwid.slice(0, 4)}…${dev.hwid.slice(-4)}`.toUpperCase() : '';
  return (
    <div className="activation">
      <div className="act-step ok">
        <div className="act-num">1</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="act-title">Discord-Konto</div>
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <Avatar size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 650 }}>{me?.user.globalName || me?.user.username || '—'}</div>
              {me && <div className="faint small num">ID {me.user.id}</div>}
            </div>
          </div>
        </div>
        <Icon name="checkCircle" size={20} />
      </div>

      <div className={`act-step ${ok ? 'ok' : 'todo'}`}>
        <div className="act-num">2</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="act-title">Lizenz-Key</div>
          {ok && acc.access?.ok ? (
            <div className="small" style={{ marginTop: 4 }}>
              <b>{TIER_LABEL[ticketTier(acc.access.ticket)]}</b> · {acc.access.ticket.exp ? `gültig bis ${fmtDate(acc.access.ticket.exp)}` : 'unbegrenzt'}
              {sourceText(lic?.source) && <div className="faint">{sourceText(lic?.source)}</div>}
            </div>
          ) : (
            <div className="col" style={{ gap: 8, marginTop: 6 }}>
              <div className="small err-text">{REASON[reason] ?? REASON.missing}</div>
              {acc.online ? <RedeemForm /> : <div className="faint small">Verbinde dich mit dem Internet, um einen Key zu aktivieren.</div>}
              {me && <div className="faint small">Kein Key? Schick deine Discord-ID an das SP-Tool-Team.</div>}
            </div>
          )}
        </div>
        <Icon name={ok ? 'checkCircle' : 'key'} size={20} />
      </div>

      <div className={`act-step ${bound && dev?.strong ? 'ok' : bound ? 'warn' : 'todo'}`}>
        <div className="act-num">3</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="act-title">Hardware-ID (dieser PC)</div>
          <div className="small" style={{ marginTop: 4 }}>
            <b>{dev?.name ?? '—'}</b> · <span className="mono">{fp}</span>
            <div className="faint">
              {dev?.strong ? 'Windows-Hardware-ID' : 'Browser-ID (schwächer – nutze die Windows-App)'} · {used} von {me?.maxDevices ?? 1} PC{(me?.maxDevices ?? 1) > 1 ? 's' : ''} belegt
            </div>
          </div>
        </div>
        <Icon name={bound ? 'checkCircle' : 'monitor'} size={20} />
      </div>
      <div className="act-note"><Icon name="shield" size={14} />Gebunden an deine Discord-ID und die Hardware-ID dieses PCs – die Lizenz kann nicht weitergegeben oder auf einen anderen PC kopiert werden.</div>
    </div>
  );
}

export function LicenseGate() {
  const [checking, setChecking] = useState(false);
  const thisDevice = useThisDevice();
  return (
    <AuthShell>
      <div className="col" style={{ gap: 16 }}>
        <div><h2>SP Tool aktivieren</h2><p className="muted" style={{ margin: 0 }}>In drei Schritten wird deine Lizenz an dich und {thisDevice} gebunden.</p></div>
        <ActivationChecklist />
        <div className="row">
          <Button variant="ghost" icon="logout" onClick={() => void signOut()}>Abmelden</Button>
          <span className="spacer" />
          <Button icon="refresh" disabled={checking} onClick={async () => { setChecking(true); await refresh(); setChecking(false); }}>{checking ? 'Wird geprüft…' : 'Erneut prüfen'}</Button>
        </div>
      </div>
    </AuthShell>
  );
}

const KIND: Record<string, string> = { desktop: 'Desktop', browser: 'Browser', mobile: 'Mobil' };

export function DeviceList({ devices, current, onRemove }: { devices: PublicDevice[]; current?: string; onRemove?: (d: PublicDevice) => void }) {
  if (!devices.length) return <div className="faint small">Keine PCs.</div>;
  return (
    <div className="device-list">
      {devices.map((d) => (
        <div key={d.id} className={`device-row${d.revoked ? ' revoked' : ''}`}>
          <Icon name={d.kind === 'mobile' ? 'gamepad' : 'monitor'} size={18} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}><b className="ellipsis">{d.name}</b>{d.id === current && <span className="chip ok">Dieser PC</span>}{d.revoked && <span className="chip">Entfernt</span>}</div>
            <div className="faint small">{KIND[d.kind] ?? d.kind} · zuerst {fmtDate(d.firstSeen)} · zuletzt gesehen {fmtDateTime(d.lastSeen)}</div>
          </div>
          {onRemove && <Button size="sm" variant="ghost" icon="trash" onClick={() => onRemove(d)}>Entfernen</Button>}
        </div>
      ))}
    </div>
  );
}

/** Settings → Account for accounts builds. */
export function AccountPanel() {
  const acc = useAccount((a) => a);
  const me = acc.me;
  const t = acc.access?.ok ? acc.access.ticket : null;
  const [armed, setArmed] = useState(false);
  if (!me) return <div className="muted">Nicht angemeldet.</div>;
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="set-row">
        <Avatar size={44} />
        <div className="grow"><div className="t">{me.user.globalName || me.user.username}</div><div className="d">@{me.user.username} · {me.user.role === 'admin' ? 'Admin' : 'Nutzer'}</div></div>
        <CopyId id={me.user.id} />
      </div>
      <div className="set-row">
        <div className="grow"><div className="t">Lizenz</div>
          <div className="d">{t ? `${TIER_LABEL[ticketTier(t)]} · ${t.exp ? `gültig bis ${fmtDate(t.exp)}` : 'ohne Ablaufdatum'}` : 'Keine aktive Lizenz'}{!acc.online && t ? ` · offline nutzbar bis ${fmtDateTime(t.offlineUntil)}` : ''}</div>
        </div>
        <span className={`chip ${t ? 'ok' : ''}`}>{t ? TIER_LABEL[ticketTier(t)] : 'Keine Lizenz'}</span>
      </div>
      {acc.online && <div className="set-row" style={{ display: 'block' }}><div className="t" style={{ marginBottom: 8 }}>Lizenz-Key einlösen</div><RedeemForm /></div>}
      <div className="set-row" style={{ display: 'block' }}>
        <div className="row"><div className="t grow">PCs</div><span className="faint small">{me.devices.filter((d) => !d.revoked).length} von {me.maxDevices} belegt</span></div>
        <div className="d" style={{ margin: '4px 0 10px' }}>Deine Lizenz läuft nur auf diesen PCs. Für einen Umzug auf einen neuen PC bitte einen Admin, deine PCs zurückzusetzen.</div>
        <DeviceList devices={me.devices} current={me.currentDevice} />
      </div>
      <div className="set-row">
        <div className="grow"><div className="t">Abmelden</div><div className="d">Meldet dich hier ab. „Überall“ beendet die Sitzungen auf all deinen PCs.</div></div>
        <div className="row">
          <Button size="sm" onClick={() => void signOut()}>Abmelden</Button>
          <Button size="sm" variant="danger" onClick={() => { if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; } void signOut(true); }}>{armed ? 'Zum Bestätigen erneut klicken' : 'Überall'}</Button>
        </div>
      </div>
    </div>
  );
}

export const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));
