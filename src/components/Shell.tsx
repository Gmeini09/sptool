import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePlayingKey, previewEntry } from '../audio/preview';
import { engine } from '../audio/engine';
import { allEntries } from '../library/assets';
import { NAV, navHint, navLabel, visibleNav } from '../app/nav';
import { isAdmin, useAccount } from '../account/account';
import { FEATURES, ROUTE_FEATURE, TIER_LABEL, can, levelLabel, tierAtLeast, tierOf } from '../account/perms';
import { accountsEnabled } from '../account/config';
import { navigate, openInEditor, setState, updateSettings, useApp, type Route } from '../app/store';
import { Icon, type IconName } from './Icon';
import { IconButton } from './ui';
import { Sheet, useIsMobile } from './mobile';
import { TutorialPanel, toggleTutorial } from './TutorialPanel';

declare const __APP_VERSION__: string;
import { loadMapping } from '../formats/mapping';
import { useSyncExternalStore } from 'react';
import { cloudAvailable, getCloud, onCloud } from '../projects/cloud';

function CloudStatusItem() {
  const c = useSyncExternalStore(onCloud, getCloud);
  useAccount((a) => a.phase); // re-render when sign-in changes
  if (!cloudAvailable()) return <span className="sb-item"><span className="dot" />Cloud aus</span>;
  const pending = c.rows.filter((r) => r.status !== 'synced').length;
  const conflicts = c.rows.filter((r) => r.status === 'conflict' || r.status === 'deleted-in-cloud').length;
  const label = c.busy ? 'Cloud wird synchronisiert…' : c.error ? 'Cloud nicht erreichbar' : conflicts ? `Cloud: ${conflicts} zu entscheiden` : pending ? `Cloud: ${pending} ausstehend` : 'Cloud synchronisiert';
  return <button className="sb-item link-like" onClick={() => navigate('cloud')}><span className={`dot${c.error || conflicts ? ' warn' : pending || c.busy ? '' : ' ok'}`} />{label}</button>;
}
const mappedCount = () => { try { return loadMapping().entries.length; } catch { return 0; } };
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

function fivemDot(s: ReturnType<typeof useFivem>) {
  if (s.state === 'done') return s.value.detected ? (s.value.running ? 'warn' : 'ok') : 'err';
  return '';
}
const useFivem = () => useApp((s) => s.fivem);

/** Menu groups that can be folded away (folded state is remembered per PC). */
const FOLDABLE = ['Soundpack von Hand', 'Experte'];
function useFolded(): [string[], (g: string) => void] {
  const read = () => { try { return JSON.parse(localStorage.getItem('sptool:nav-folded') ?? '["Experte"]') as string[]; } catch { return ['Experte']; } };
  const [folded, setFolded] = useState<string[]>(read);
  const toggle = (g: string) => setFolded((f) => { const n = f.includes(g) ? f.filter((x) => x !== g) : [...f, g]; try { localStorage.setItem('sptool:nav-folded', JSON.stringify(n)); } catch { /* blocked */ } return n; });
  return [folded, toggle];
}

export function Sidebar() {
  const route = useApp((s) => s.route);
  const session = useApp((s) => s.session);
  const fivem = useFivem();
  const admin = useAccount(isAdmin);
  const simple = useApp((s) => s.settings.simpleMode);
  const nav = useMemo(() => visibleNav(admin, simple), [admin, simple]);
  const groups = useMemo(() => [...new Set(nav.map((n) => n.group))], [nav]);
  const navRef = useRef<HTMLElement>(null);
  const [folded, toggleFold] = useFolded();
  const [ind, setInd] = useState<{ top: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.nav-item.active');
    setInd(el ? { top: el.offsetTop, h: el.offsetHeight } : null);
  }, [route, nav]);
  const fivemText = fivem.state === 'done' ? (fivem.value.detected ? (fivem.value.running ? 'Läuft' : 'Gefunden') : 'Nicht gefunden') : fivem.state === 'unavailable' ? 'Nur Windows-App' : fivem.state === 'checking' ? 'Wird geprüft…' : 'Fehler';
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-emblem" src="assets/brand/emblem.jpg" alt="" />
        <div>
          <div className="brand-name">SP Tool</div>
          <div className="brand-sub">von Turbo Design</div>
        </div>
      </div>
      <nav className="nav" aria-label="Hauptmenü" ref={navRef}>
        {ind && <span className="nav-indicator" style={{ transform: `translateY(${ind.top}px)`, height: ind.h }} aria-hidden="true" />}
        {groups.map((g) => {
          const foldable = FOLDABLE.includes(g);
          const shut = foldable && folded.includes(g) && !nav.some((n) => n.group === g && n.route === route);
          return (
          <div className="nav-group" key={g}>
            {foldable
              ? <button className="nav-group-title nav-fold" aria-expanded={!shut} onClick={() => toggleFold(g)}>{g}<Icon name="chevron" size={12} className={shut ? '' : 'open'} /></button>
              : <div className="nav-group-title">{g}</div>}
            {!shut && nav.filter((n) => n.group === g).map((n) => (
              <button key={n.route} className={`nav-item${route === n.route ? ' active' : ''}`} onClick={() => navigate(n.route)} title={n.hint} aria-current={route === n.route ? 'page' : undefined}>
                <Icon name={n.icon} size={17} />
                <span className="n-label">{n.label}</span>
                {n.phase ? <span className="soon" title={`Geplant für Entwicklungsphase ${n.phase}`}>P{n.phase}</span> : <NavLock route={n.route} />}
              </button>
            ))}
          </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <button className="user-chip" onClick={() => navigate('settings')} title="Konto">
          <Avatar />
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session?.displayName}</div>
            <div className="faint small"><AccountLine /></div>
          </div>
        </button>
        {!simple && <>
          <DiscordRow />
          <div className="foot-row"><span><span className={`dot ${fivemDot(fivem)}`} />FiveM</span><span>{fivemText}</span></div>
          <div className="foot-row"><span>Version</span><span className="num">{APP_VERSION}</span></div>
        </>}
      </div>
    </aside>
  );
}

/** „Anleitung“: on the desktop it opens/closes the panel on the left, on phones a sheet. */
function HelpButton() {
  const open = useApp((s) => s.settings.tutorialOpen);
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <button className={`help-btn${open && !mobile ? ' on' : ''}`} title={mobile ? 'Anleitung öffnen' : open ? 'Anleitung einklappen' : 'Anleitung öffnen'} aria-pressed={!mobile && open}
        onClick={() => (mobile ? setSheet(true) : toggleTutorial())}>
        <Icon name="book" size={16} /><span className="help-btn-label">Anleitung</span>
      </button>
      {sheet && <Sheet title="Anleitung" onClose={() => setSheet(false)}><TutorialPanel inSheet /></Sheet>}
    </>
  );
}

export function PageHint() {
  const route = useApp((s) => s.route);
  const seen = useApp((s) => s.settings.hintsSeen);
  const tutOpen = useApp((s) => s.settings.tutorialOpen);
  const mobile = useIsMobile();
  const simple = useApp((s) => s.settings.simpleMode);
  const text = navHint(route);
  if (simple) return null; // the simple view explains itself on the page
  // the open tutorial panel already explains the page in detail
  if (!text || route === 'home' || seen.includes(route) || (tutOpen && !mobile)) return null;
  const n = NAV.find((x) => x.route === route);
  const step = n && /^\d/.test(n.group) ? n.group : null;
  return (
    <div className="page-hint" role="note">
      <Icon name="info" size={16} />
      <div className="grow">
        <div>{step && <strong>{step}: </strong>}{text}</div>
        {n?.steps && <ol className="hint-steps">{n.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
      </div>
      <button className="btn ghost sm" onClick={() => updateSettings({ hintsSeen: [...seen, route] })}>Verstanden</button>
    </div>
  );
}

/** Lock + required plan on modules the current license does not include. */
function NavLock({ route }: { route: Route }) {
  const f = ROUTE_FEATURE[route];
  const ok = useAccount((a) => !f || can(f, a));
  if (ok || !f || f === 'admin') return null;
  return <span className="soon nav-lock" title={`Benötigt ${TIER_LABEL[FEATURES[f]]}`}><Icon name="lock" size={11} />{TIER_LABEL[FEATURES[f]]}</span>;
}

export const discordAvatarUrl = (id: string, avatar: string | null | undefined, size = 64) =>
  avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=${size}` : null;

export function Avatar({ size }: { size?: number }) {
  const session = useApp((s) => s.session);
  const [broken, setBroken] = useState(false);
  const url = session?.discordId ? discordAvatarUrl(session.discordId, session.avatar) : null;
  const st = size ? { width: size, height: size, fontSize: size * 0.42 } : undefined;
  if (url && !broken) return <img className="avatar" style={st} src={url} alt="" onError={() => setBroken(true)} />;
  return <div className="avatar" style={st}>{(session?.displayName ?? '?').slice(0, 1).toUpperCase()}</div>;
}

export const planLabel = (p?: string | null) => levelLabel(p);

function AccountLine() {
  const acc = useAccount((a) => a);
  if (!accountsEnabled()) return <>Lokales Profil · Offline</>;
  const t = tierOf(acc);
  const plan = acc.access?.ok || tierAtLeast(t, 'admin') ? TIER_LABEL[t] : 'Keine Lizenz';
  return <>{plan}{acc.online ? '' : ' · Offline'}</>;
}

function DiscordRow() {
  const acc = useAccount((a) => a);
  const text = !accountsEnabled() ? 'Nicht verbunden' : acc.phase !== 'ready' ? 'Abgemeldet' : acc.online ? 'Verbunden' : 'Offline (Kulanzzeit)';
  const dot = !accountsEnabled() ? '' : acc.phase === 'ready' ? (acc.online ? 'ok' : 'warn') : 'err';
  return <div className="foot-row"><span><span className={`dot ${dot}`} />Discord</span><span>{text}</span></div>;
}

export function TopBar() {
  const simpleTop = useApp((s) => s.settings.simpleMode);
  const route = useApp((s) => s.route);
  const notices = useApp((s) => s.notices);
  const [open, setOpen] = useState(false);
  const unread = notices.some((n) => !n.read);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <header className="topbar">
      <img className="topbar-logo brand-emblem" src="assets/brand/emblem.jpg" alt="" height={26} />
      <h1 key={route} className="title-anim">{navLabel(route)}</h1>
      {simpleTop ? <span className="grow" /> : <><button className="search-btn" onClick={() => setState({ paletteOpen: true, paletteQuery: '' })} aria-label="Überall suchen">
        <Icon name="search" size={16} />
        <span className="search-text">Sounds, Einstellungen suchen…</span>
        <kbd className="search-kbd">Strg K</kbd>
      </button>
      <HelpButton /></>}
      <div style={{ position: 'relative' }} ref={ref}>
        <IconButton icon="bell" title="Benachrichtigungen" dot={unread} onClick={() => { setOpen(!open); setState((s) => ({ notices: s.notices.map((n) => ({ ...n, read: true })) })); }} />
        {open && (
          <div className="dropdown">
            <div className="dd-head">Benachrichtigungen<span className="spacer" />{notices.length > 0 && <button className="btn ghost sm" onClick={() => setState({ notices: [] })}>Leeren</button>}</div>
            {notices.length === 0 ? (
              <div className="empty" style={{ padding: 28 }}><p className="small">Nichts Neues. Gespeicherte Sounds, Exporte und Systemereignisse erscheinen hier.</p></div>
            ) : (
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {notices.map((n) => (
                  <div className="notice" key={n.id}>
                    <div>{n.title}</div>
                    {n.body && <div className="muted small">{n.body}</div>}
                    <div className="faint">{new Date(n.time).toLocaleTimeString('de-DE')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

// ── Phone navigation ────────────────────────────────────────────────────────
const TABS: Array<{ route: Route; label: string; icon: IconName }> = [
  { route: 'home', label: 'Start', icon: 'home' },
  { route: 'create', label: 'Erstellen', icon: 'hammer' },
  { route: 'library', label: 'Bibliothek', icon: 'library' },
  { route: 'projects', label: 'Meine Packs', icon: 'folder' },
];

export function BottomNav() {
  const route = useApp((s) => s.route);
  const [more, setMore] = useState(false);
  const inTabs = TABS.some((t) => t.route === route);
  return (
    <>
      <nav className="bottom-nav" aria-label="Hauptmenü">
        {TABS.map((t) => (
          <button key={t.route} className={route === t.route ? 'on' : ''} aria-current={route === t.route ? 'page' : undefined} onClick={() => navigate(t.route)}>
            <Icon name={t.icon} size={22} /><span>{t.label}</span>
          </button>
        ))}
        <button className={!inTabs ? 'on' : ''} onClick={() => setMore(true)} aria-haspopup="dialog">
          <Icon name="more" size={22} /><span>Mehr</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const route = useApp((s) => s.route);
  const session = useApp((s) => s.session);
  const fivem = useFivem();
  const admin = useAccount(isAdmin);
  const nav = visibleNav(admin, useApp((s) => s.settings.simpleMode));
  const groups = [...new Set(nav.map((n) => n.group))];
  const rest = nav.filter((n) => !TABS.some((t) => t.route === n.route));
  return (
    <Sheet onClose={onClose} title={
      <div className="row">
        <Avatar />
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{session?.displayName}</div><div className="faint small"><AccountLine /> · v{APP_VERSION}</div></div>
        <span className="chip"><span className={`dot ${fivemDot(fivem)}`} />FiveM {fivem.state === 'done' ? (fivem.value.detected ? 'gefunden' : 'nicht gefunden') : 'nur am PC'}</span>
      </div>
    }>
      {groups.map((g) => {
        const items = rest.filter((n) => n.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="more-group">
            <div className="nav-group-title">{g}</div>
            <div className="more-grid">
              {items.map((n) => (
                <button key={n.route} className={`more-item${route === n.route ? ' on' : ''}`} onClick={() => { onClose(); navigate(n.route); }}>
                  <Icon name={n.icon} size={20} /><span>{n.label}</span>{n.phase ? <em>P{n.phase}</em> : <NavLock route={n.route} />}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

export function StatusBar() {
  const fivem = useApp((s) => s.fivem);
  const playing = usePlayingKey();
  const [eng, setEng] = useState(engine.state);
  useEffect(() => engine.subscribe(() => setEng(engine.state)), []);
  const project = useApp((s) => s.projects.find((p) => p.id === s.currentProjectId)?.name);
  const simple = useApp((s) => s.settings.simpleMode);
  return (
    <footer className="statusbar">
      {!simple && <>
        <span className="sb-item">Soundpack: {project ?? 'keins geöffnet'}</span>
        <span className="sb-item"><span className={`dot ${fivemDot(fivem)}`} />FiveM {fivem.state === 'done' ? (fivem.value.detected ? 'gefunden' : 'nicht gefunden') : fivem.state === 'unavailable' ? 'in der Vorschau nicht verfügbar' : '…'}</span>
        <CloudStatusItem />
        <span className="sb-item" title="Spiel-Sounds, die Waffen-Slots zugeordnet sind – nur zugeordnete Slots werden gebaut"><Icon name="hammer" size={12} />&nbsp;{mappedCount()} Sounds zugeordnet</span>
      </>}
      <span className="grow" />
      <span className="sb-item"><span className={`dot ${eng === 'running' ? 'ok' : ''}`} />Audio {playing ? 'spielt' : eng === 'running' ? 'bereit' : 'inaktiv'}</span>
      <span className="sb-item num">v{APP_VERSION}</span>
    </footer>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const icon: Record<string, IconName> = { success: 'checkCircle', error: 'alert', warning: 'alert', info: 'info' };
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.leaving ? ' leaving' : ''}`} style={{ ['--toast-ms' as string]: `${t.ms ?? 3500}ms` }}>
          <Icon name={icon[t.kind]} size={18} />
          <div style={{ minWidth: 0 }}>
            <div className="t-t">{t.title}</div>
            {t.body && <div className="t-b">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Command palette + search everywhere (spec §98/§99) ────────────────────────
interface Cmd { id: string; group: string; label: string; icon: IconName; hint?: string; run: () => void }

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const initial = useApp((s) => s.paletteQuery);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(initial); setSel(0); } }, [open, initial]);

  const results = useMemo<Cmd[]>(() => {
    if (!open) return [];
    const go = (r: Route) => () => navigate(r);
    const commands: Cmd[] = [
      { id: 'c-lib', group: 'Befehle', label: 'Sound-Bibliothek öffnen', icon: 'library', run: go('library') },
      { id: 'c-gen', group: 'Befehle', label: 'Sound erstellen', icon: 'sparkles', hint: 'Strg G', run: go('generator') },
      { id: 'c-ed', group: 'Befehle', label: 'Sound bearbeiten', icon: 'wave', run: go('editor') },
      { id: 'c-wp', group: 'Befehle', label: 'Waffenprofile', icon: 'target', run: go('weapons') },
      { id: 'c-new', group: 'Befehle', label: 'Neues Soundpack', icon: 'plus', hint: 'Strg N', run: go('projects') },
      { id: 'c-sp', group: 'Befehle', label: 'Soundpack befüllen', icon: 'layers', run: go('soundpack') },
      { id: 'c-an', group: 'Befehle', label: 'Soundpack analysieren (.rpf)', icon: 'box', run: go('analyzer') },
      { id: 'c-build', group: 'Befehle', label: 'Soundpack bauen', icon: 'hammer', run: go('build') },
      { id: 'c-bak', group: 'Befehle', label: 'Backup wiederherstellen', icon: 'archive', hint: 'Phase 4', run: go('backups') },
      { id: 'c-mk', group: 'Befehle', label: 'Marktplatz', icon: 'store', hint: 'Phase 10', run: go('marketplace') },
      { id: 'c-set', group: 'Einstellungen', label: 'Einstellungen', icon: 'settings', run: go('settings') },
      { id: 'c-theme', group: 'Einstellungen', label: 'Aussehen: Design und Akzentfarbe', icon: 'palette', run: go('settings') },
      { id: 'c-fivem', group: 'Einstellungen', label: 'Pfade zu FiveM und GTA V', icon: 'gamepad', run: go('settings') },
      { id: 'c-logs', group: 'Einstellungen', label: 'Protokoll', icon: 'logs', run: go('logs') },
    ];
    const needle = q.trim().toLowerCase();
    const cmds = needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands.slice(0, 9);
    if (!needle) return cmds;
    const words = needle.split(/\s+/);
    const sounds: Cmd[] = allEntries()
      .filter((e) => { const h = `${e.name} ${e.tags.join(' ')} ${e.type} ${e.weapon}`.toLowerCase(); return words.every((w) => h.includes(w)); })
      .slice(0, 12)
      .map((e) => ({ id: e.id, group: 'Sounds', label: e.name, icon: 'wave', hint: 'Enter bearbeiten · Umschalt+Enter abspielen', run: () => openInEditor(e.id) }));
    return [...cmds, ...sounds];
  }, [open, q]);

  if (!open) return null;
  const close = () => setState({ paletteOpen: false });
  const runAt = (i: number, alt = false) => {
    const c = results[i];
    if (!c) return;
    if (alt && c.group === 'Sounds') { const e = allEntries().find((x) => x.id === c.id); if (e) void previewEntry(e); return; }
    close();
    c.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(sel, e.shiftKey); }
  };
  let lastGroup = '';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Befehlspalette">
        <input autoFocus value={q} placeholder="Befehl eingeben oder Sounds suchen…" onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="empty" style={{ padding: 30 }}><p>Keine Treffer für „{q}“.</p></div>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="pal-group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head}
                <div className={`pal-item${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => runAt(i)}>
                  <Icon name={c.icon} size={16} />
                  <span className="grow">{c.label}</span>
                  {c.hint && (i === sel || c.group !== 'Sounds') && <span className="faint small">{c.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if (ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); setState((s) => ({ paletteOpen: !s.paletteOpen, paletteQuery: '' })); }
      else if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); navigate('generator'); }
      else if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); navigate('build'); }
      else if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); navigate('projects'); }
      else if (e.key === 'Escape' && !typing && engine.playingKey) engine.stop();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
}
