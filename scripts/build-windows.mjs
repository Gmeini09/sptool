// Builds the native Windows app: dist/ (web app) → windows/web → SPTool.exe (Go, icon + version info).
// Needs Go 1.22+ and go-winres (https://github.com/tc-hib/go-winres). Cross-compiles from Linux/macOS too.
//   SPTOOL_API_URL=… SPTOOL_LICENSE_PUBKEY=… node scripts/build-windows.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const win = resolve(root, 'windows');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const v4 = `${pkg.version}.0`;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

run(process.execPath, [resolve(root, 'scripts/build.mjs')], { cwd: root });
rmSync(resolve(win, 'web'), { recursive: true, force: true });
cpSync(resolve(root, 'dist'), resolve(win, 'web'), { recursive: true });

writeFileSync(resolve(win, 'winres/winres.json'), JSON.stringify({
  RT_GROUP_ICON: { '#1': { '0000': ['icon-256.png', 'icon-48.png', 'icon-32.png', 'icon-16.png'] } },
  RT_MANIFEST: { '#1': { '0409': {
    identity: { name: 'TurboDesign.SPTool', version: v4 }, description: 'SP Tool', 'minimum-os': 'win10',
    'execution-level': 'as invoker', 'dpi-awareness': 'per monitor v2', 'use-common-controls-v6': true,
  } } },
  RT_VERSION: { '#1': { '0000': {
    fixed: { file_version: v4, product_version: v4 },
    info: { '0409': {
      CompanyName: 'Turbo Design', FileDescription: 'SP Tool - FiveM Soundpack Creator', ProductName: 'SP Tool',
      LegalCopyright: `© ${new Date().getFullYear()} Turbo Design`, OriginalFilename: 'SPTool.exe', InternalName: 'SPTool',
      FileVersion: pkg.version, ProductVersion: pkg.version,
    } },
  } } },
}, null, 2));
run('go-winres', ['make', '--in', 'winres/winres.json', '--arch', 'amd64'], { cwd: win });
mkdirSync(resolve(root, 'release'), { recursive: true });
run('go', ['build', '-mod=vendor', '-trimpath', '-ldflags', `-H=windowsgui -s -w -X main.version=${pkg.version}`, '-o', resolve(root, 'release/SPTool.exe'), '.'],
  { cwd: win, env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } });
console.log(`✓ release/SPTool.exe (v${pkg.version})`);

// Distribution ZIP – always the same name, for every release and update.
const ZIP_NAME = 'Turbo_Designs_SP_Tool.zip';
const stage = resolve(root, 'release/zip-stage');
const folder = resolve(stage, 'Turbo Designs SP Tool');
rmSync(stage, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
cpSync(resolve(root, 'release/SPTool.exe'), resolve(folder, 'SPTool.exe'));
writeFileSync(resolve(folder, 'LIES MICH.txt'), [
  `SP Tool von Turbo Design - Version ${pkg.version}`,
  '',
  '1. ZIP entpacken.',
  '2. SPTool.exe doppelklicken (installiert/aktualisiert und startet SP Tool).',
  '3. Windows-Warnung: "Weitere Informationen" -> "Trotzdem ausfuehren".',
  '4. Mit Discord anmelden und deinen Lizenz-Key eingeben.',
  '   Die Lizenz wird an deine Discord-ID und deinen PC (Hardware-ID) gebunden.',
  '',
  'Update: einfach die neue SPTool.exe starten - Projekte und Einstellungen bleiben erhalten.',
  '',
].join('\r\n'));
rmSync(resolve(root, 'release', ZIP_NAME), { force: true });
run('zip', ['-r', '-X', '-9', resolve(root, 'release', ZIP_NAME), 'Turbo Designs SP Tool'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`✓ release/${ZIP_NAME}`);
