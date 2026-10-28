import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Tour } from '../components/Tour';
import { GameTest } from '../views/GameTest';
import { CreateView } from '../views/Create';
import { adoptBase, baseArchiveName, baseFromUserFiles, restoreBase } from '../projects/basePack';
import { checkForUpdate } from '../services/appUpdate';
import { refreshServerMapping } from '../services/mappingSync';
import { flushDetectionFeedback } from '../services/detectionFeedback';
import { AUDIO_EXT } from '../library/importAudio';
import { FILES_DROPPED } from './store';
import { TutorialPanel } from '../components/TutorialPanel';
import { UpdateBanner, UpdatePrompt } from '../components/UpdateBanner';
import { WhatsNew } from '../components/Changelog';
import { BottomNav, CommandPalette, Sidebar, StatusBar, Toasts, TopBar, useGlobalShortcuts, PageHint } from '../components/Shell';
import { useIsMobile } from '../components/mobile';
import { detectFiveM, detectGta } from '../services/system';
import { getState, setState, startSessionGuard, toast, useApp } from './store';
import { HomeView } from '../views/Home';
import { LibraryView } from '../views/Library';
import { EditorView } from '../views/Editor';
import { GeneratorView } from '../views/Generator';
import { WeaponsView } from '../views/Weapons';
import { SettingsView } from '../views/Settings';
import { LogsView } from '../views/Logs';
import { PlannedView } from '../views/Planned';
import { WelcomeView } from '../views/Welcome';
import { AnalyzerView } from '../views/Analyzer';
import { ProjectsView } from '../views/Projects';
import { SoundpackView } from '../views/Soundpack';
import { snapshotTick } from '../projects/actions';
import { AdminView } from '../views/Admin';
import { AccountSplash, LicenseGate, LoginScreen } from '../views/Account';
import { hasAccess, useAccount } from '../account/account';
import { BootIntro } from '../components/BootIntro';
import { ROUTE_FEATURE, can } from '../account/perms';
import { LockedView } from '../views/Locked';
import { BackupsView, InstallView } from '../views/Install';
import { BuildView } from '../views/Build';
import { CloudView } from '../views/Cloud';
import { startCloudAutoSync } from '../projects/cloud';

export async function runDetection() {
  const { fivemPath, gtaPath } = getState().settings;
  setState({ fivem: { state: 'checking' }, gta: { state: 'checking' } });
  const [fivem, gta] = await Promise.all([detectFiveM(fivemPath), detectGta(gtaPath)]);
  setState({ fivem, gta });
}

function useThemeSync() {
  const s = useApp((x) => x.settings);
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = s.theme;
    r.dataset.accent = s.accent;
    r.dataset.reducedMotion = String(s.reducedMotion);
    r.style.zoom = String(s.uiScale);
  }, [s.theme, s.accent, s.reducedMotion, s.uiScale]);
}

export function App() {
  useThemeSync();
  useGlobalShortcuts();
  const session = useApp((s) => s.session);
  const onboarded = useApp((s) => s.onboarded);
  const route = useApp((s) => s.route);
  const mobile = useIsMobile();
  const tutOpen = useApp((s) => s.settings.tutorialOpen);
  useEffect(() => {
    void runDetection();
    startSessionGuard();
    startCloudAutoSync();
    const t = setInterval(snapshotTick, 60_000);
    return () => clearInterval(t);
  }, []);
  const recovered = useApp((s) => s.recovered);
  useEffect(() => {
    if (!recovered) return;
    toast('info', 'Soundpack wiederhergestellt', 'SP Tool wurde beim letzten Mal unerwartet beendet – dein Soundpack kommt aus der automatischen Speicherung. Ältere Stände findest du in seinem Versionsverlauf.');
    setState({ recovered: false });
  }, [recovered]);

  const acc = useAccount((a) => a);
  // Everyone with a license: right after login / start, a version the admin pushed is offered in a window (the user
  // decides); afterwards SP Tool looks again every 3 hours (setting „Nach Updates suchen“).
  const canUpdate = acc.phase === 'ready' && acc.online;
  useEffect(() => {
    if (!canUpdate) return;
    void refreshServerMapping(); void flushDetectionFeedback();
    const t = setTimeout(() => void checkForUpdate(false, true), 1500);
    const iv = setInterval(() => { void checkForUpdate(); void refreshServerMapping(); void flushDetectionFeedback(); }, 3 * 3600_000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [canUpdate]);
  // the stored base pack (WEAPONS_PLAYER/RESIDENT) is loaded once the app is unlocked
  const unlocked = acc.phase === 'ready' && hasAccess(acc);
  useEffect(() => { if (unlocked) void restoreBase(); }, [unlocked]);
  // drop a soundpack ZIP or WEAPONS_PLAYER/RESIDENT.rpf anywhere → it becomes the base pack
  useEffect(() => {
    if (!unlocked) return;
    const isPack = (f: File) => /\.zip$/i.test(f.name) || !!baseArchiveName(f.name);
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (e.defaultPrevented) return; // handled by the page (e.g. WAV import in the library)
      const all = Array.from(e.dataTransfer?.files ?? []);
      if (!all.length) return;
      e.preventDefault(); // never let the window navigate to a dropped file (that would replace SP Tool)
      const files = all.filter(isPack);
      if (!files.length) {
        // sounds dropped anywhere: the open page may take them (e.g. "Soundpack erstellen"), otherwise say where
        const ev = new CustomEvent<{ files: File[]; taken: boolean }>(FILES_DROPPED, { detail: { files: all, taken: false } });
        window.dispatchEvent(ev);
        if (!ev.detail.taken) toast('info', 'Wohin damit?', AUDIO_EXT.test(all[0].name) ? 'Zieh Sounds auf „Eigene Sounds importieren“ (Soundpack erstellen) oder in die Bibliothek.' : 'SP Tool nimmt Sounds (MP3, WAV …), Soundpack-ZIPs und WEAPONS_PLAYER/RESIDENT.rpf.');
        return;
      }
      void baseFromUserFiles(files).then(({ files: f, label }) => adoptBase(f, 'Deine Datei', label))
        .then(() => toast('success', 'Basis-Pack eingerichtet', 'Wird ab jetzt bei jedem Bauen automatisch verwendet.'), (err) => toast('error', 'Diese Dateien passen nicht', err instanceof Error ? err.message : String(err)));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [unlocked]);

  let screen: ReactElement | null = null;
  if (acc.phase === 'loading') screen = <AccountSplash />;
  else if (acc.phase === 'signed-out' || acc.phase === 'signing-in') screen = <><LoginScreen /><Toasts /></>;
  else if (!hasAccess(acc)) screen = <><LicenseGate /><Toasts /></>;
  else if (!session || !onboarded) screen = <><WelcomeView /><Toasts /></>;
  // BootIntro sits at a fixed place in the tree so it keeps running while the screen behind it changes.
  if (screen) return <>{screen}<BootIntro /></>;

  let view: ReactElement;
  const gate = ROUTE_FEATURE[route];
  if (gate && !can(gate, acc)) view = <LockedView feature={gate} />;
  else switch (route) {
    case 'home': view = <HomeView />; break;
    case 'create': view = <CreateView />; break;
    case 'library': view = <LibraryView />; break;
    case 'editor': view = <EditorView />; break;
    case 'generator': view = <GeneratorView />; break;
    case 'weapons': view = <WeaponsView />; break;
    case 'settings': view = <SettingsView />; break;
    case 'logs': view = <LogsView />; break;
    case 'analyzer': view = <AnalyzerView />; break;
    case 'projects': view = <ProjectsView />; break;
    case 'soundpack': view = <SoundpackView />; break;
    case 'admin': view = <AdminView />; break;
    case 'install': view = <InstallView />; break;
    case 'build': view = <BuildView />; break;
    case 'cloud': view = <CloudView />; break;
    case 'backups': view = <BackupsView />; break;
    default: view = <PlannedView route={route} />;
  }
  return (<>
    <div className={`shell${mobile ? ' is-mobile' : ''}${tutOpen && !mobile ? ' tut-open' : ''}`}>
      {!mobile && <Sidebar />}
      {!mobile && <div className="tut-wrap" {...(tutOpen ? {} : ({ inert: '' } as Record<string, string>))} aria-hidden={!tutOpen}><TutorialPanel /></div>}
      <div className="main">
        <TopBar />
        <UpdateBanner />
        <main className="content"><div className="view-anim" key={route}><PageHint />{view}</div></main>
      </div>
      {mobile ? <BottomNav /> : <StatusBar />}
      <CommandPalette />
      <Tour />
      <GameTest />
      <UpdatePrompt />
      <WhatsNew />
      <Toasts />
    </div>
    <BootIntro />
  </>);
}
