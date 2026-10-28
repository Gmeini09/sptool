import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { logger } from './services/logger';
import { isTauri } from './services/tauri';
import { initFx, motionAllowed } from './fx/effects';
import { installRipple } from './fx/ripple';
import { introWillRun } from './components/BootIntro';
import { initAccount } from './account/account';
import { engine } from './audio/engine';
import { startNativeHeartbeat } from './services/native';

logger.info('SP Tool starting');
initFx();
installRipple();
// Opening animation when the big intro does not run (it plays once per window session):
// sidebar, menu, top bar and page still assemble piece by piece.
if (!introWillRun() && motionAllowed()) {
  document.documentElement.dataset.enter = '1';
  window.setTimeout(() => { delete document.documentElement.dataset.enter; }, 1600);
}
void initAccount();
void startNativeHeartbeat();
// Unlock audio on the first interaction anywhere (autoplay policy), so every later play is audible.
{
  const unlockAudio = () => engine.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable, offline-capable web app (phones, tablets). Not used inside the desktop/mobile shell.
declare const __DEV_MODE__: boolean;
// The Windows app serves its files from the exe (http://localhost:47615-47618) and must never run the PWA
// service worker – an old worker would keep serving outdated code after an update. Remove any leftover one.
const isDesktopShell = location.hostname === 'localhost' && ['47615', '47616', '47617', '47618'].includes(location.port);
if ('serviceWorker' in navigator && isDesktopShell) {
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return;
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) { for (const k of await caches.keys()) if (k.startsWith('sptool-')) await caches.delete(k); }
    logger.info('Removed old offline cache');
  }).catch(() => { /* ignore */ });
}
if ('serviceWorker' in navigator && !isDesktopShell && !isTauri() && !__DEV_MODE__ && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(
      () => logger.info('Offline support ready'),
      (e) => logger.warn('Offline support unavailable', e),
    );
  });
}
