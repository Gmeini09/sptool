// Serves dist/ on http://localhost:4173 and opens the browser (used by START-SPTOOL.cmd).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = normalize(join(dist, p));
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`SP Tool laeuft: ${url}  (Fenster offen lassen, schliessen beendet SP Tool)`);
  openAppWindow(url);
});

// Opens SP Tool in its own app window (Edge/Chrome app mode: no tabs, no address bar).
// Closing the window ends SP Tool. Falls back to the default browser.
function openAppWindow(url) {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32' ? [
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${local}\\Google\\Chrome\\Application\\chrome.exe`,
  ] : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const browser = candidates.find((c) => c && existsSync(c));
  if (!browser) { exec(process.platform === 'win32' ? `start "" "${url}"` : `xdg-open ${url}`); return; }
  // Own profile folder: keeps your data/login stable and makes the window a separate app.
  const profile = join(local || dist, 'SPTool', 'app-profile');
  mkdirSync(profile, { recursive: true });
  const child = spawn(browser, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1400,900', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' });
  child.on('exit', () => process.exit(0));
}
