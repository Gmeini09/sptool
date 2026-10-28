// SP Tool frontend build (esbuild). Output: dist/  → consumed by Tauri (frontendDist).
// Usage:  node scripts/build.mjs          production build
//         node scripts/build.mjs --serve  dev server on http://localhost:1420 (Tauri devUrl)
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const serve = process.argv.includes('--serve');
const dev = serve || process.argv.includes('--dev');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  format: 'esm',
  target: ['chrome110', 'edge110'],
  sourcemap: dev ? 'inline' : false,
  minify: !dev && !process.env.SPTOOL_NOMINIFY,
  jsx: 'automatic',
  logLevel: 'info',
  nodePaths: process.env.SPTOOL_NODE_PATH ? [process.env.SPTOOL_NODE_PATH] : [],
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    __APP_VERSION__: JSON.stringify(pkg.version),
    // CHANGELOG.md is built in: the app shows it after updates and pre-fills „Was ist neu?“ when an admin pushes
    __CHANGELOG__: JSON.stringify(existsSync(resolve(root, 'CHANGELOG.md')) ? readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8') : ''),
    __DEV_MODE__: JSON.stringify(dev),
    // License server + its Ed25519 public key (from `node server/index.mjs --gen-keys`).
    // Leave both empty to build without accounts (local profile only).
    __API_URL__: JSON.stringify((process.env.SPTOOL_API_URL ?? '').replace(/\/$/, '')),
    __LICENSE_PUBKEY__: JSON.stringify(process.env.SPTOOL_LICENSE_PUBKEY ?? ''),
  },
};

const html = readFileSync(resolve(root, 'src/index.html'), 'utf8');
// Version stamp on every file reference: an older cache (service worker / WebView) can never serve stale code.
const stamp = `${pkg.version}-${Date.now().toString(36)}`;
writeFileSync(resolve(dist, 'index.html'), html.replace('href="app.css"', `href="app.css?v=${stamp}"`).replace('src="main.js"', `src="main.js?v=${stamp}"`));
writeFileSync(resolve(dist, 'app.css'), ['app.css', 'turbo.css', 'intro.css', 'motion.css', 'layout.css', 'motion3.css', 'quick.css'].map((f) => readFileSync(resolve(root, 'src/themes', f), 'utf8')).join('\n'));
cpSync(resolve(root, 'src/assets'), resolve(dist, 'assets'), { recursive: true });
cpSync(resolve(root, 'src/manifest.webmanifest'), resolve(dist, 'manifest.webmanifest'));
writeFileSync(resolve(dist, 'sw.js'), readFileSync(resolve(root, 'src/sw.js'), 'utf8').replaceAll('__VERSION__', `${pkg.version}-${Date.now().toString(36)}`));

const entries = [
  { ...common, entryPoints: [resolve(root, 'src/main.tsx')], outfile: resolve(dist, 'main.js') },
  { ...common, entryPoints: [resolve(root, 'src/audio/audio.worker.ts')], outfile: resolve(dist, 'audio.worker.js') },
];

if (serve) {
  const ctxs = await Promise.all(entries.map((e) => esbuild.context(e)));
  await Promise.all(ctxs.map((c) => c.watch()));
  const { port } = await ctxs[0].serve({ servedir: dist, port: 1420 });
  console.log(`SP Tool dev server: http://localhost:${port}`);
} else {
  await Promise.all(entries.map((e) => esbuild.build(e)));
}
