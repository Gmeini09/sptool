// Thin bridge to the Tauri v2 runtime. In a plain browser (dev preview) native
// features report themselves as unavailable instead of faking results.
declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  }
}

export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export class NativeUnavailableError extends Error {
  constructor(what: string) {
    super(`${what} braucht die SP-Tool-Desktop-App (in der Browser-Vorschau nicht verfügbar).`);
  }
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new NativeUnavailableError(cmd);
  return (await window.__TAURI_INTERNALS__!.invoke(cmd, args)) as T;
}

export interface DialogFilter { name: string; extensions: string[] }

export async function pickFile(title: string, filters: DialogFilter[]): Promise<string | null> {
  return invoke<string | null>('plugin:dialog|open', { options: { title, filters, multiple: false, directory: false } });
}

export async function pickFolder(title: string): Promise<string | null> {
  return invoke<string | null>('plugin:dialog|open', { options: { title, multiple: false, directory: true } });
}

export async function pickSavePath(title: string, defaultPath: string, filters: DialogFilter[]): Promise<string | null> {
  return invoke<string | null>('plugin:dialog|save', { options: { title, defaultPath, filters } });
}

export async function openPath(path: string): Promise<void> {
  await invoke('plugin:opener|open_path', { path });
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Saves bytes for the user: native save dialog in the desktop app, a browser
 * download in preview. Returns the path (or file name) or null if cancelled.
 */
export async function saveBytes(defaultName: string, bytes: Uint8Array, filter: DialogFilter): Promise<string | null> {
  if (isTauri()) {
    const path = await pickSavePath('Datei speichern', defaultName, [filter]);
    if (!path) return null;
    await invoke('write_file_b64', { path, data: bytesToB64(bytes) });
    return path;
  }
  const android = androidBridge();
  if (android) return saveViaAndroid(android, defaultName, bytes);
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return defaultName;
}

// ── Android app (WebView shell) ─────────────────────────────────────────────
// The shell exposes window.SPToolAndroid. Blob downloads do not work in a WebView, so files are handed over in
// base64 chunks and the shell writes them to Downloads/SP Tool.
interface AndroidBridge { begin(name: string): string; append(id: string, b64: string): boolean; finish(id: string): string; abort(id: string): void }
declare global { interface Window { SPToolAndroid?: AndroidBridge } }
export const androidBridge = (): AndroidBridge | null => (typeof window !== 'undefined' && window.SPToolAndroid) || null;
const CHUNK = 768 * 1024; // multiple of 3 → chunks concatenate to valid base64 per chunk

async function saveViaAndroid(a: AndroidBridge, name: string, bytes: Uint8Array): Promise<string> {
  const id = a.begin(name);
  try {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      if (!a.append(id, bytesToB64(bytes.subarray(i, i + CHUNK)))) throw new Error('Speichern fehlgeschlagen.');
      if (i % (CHUNK * 8) === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
    return a.finish(id) || name;
  } catch (e) { a.abort(id); throw e; }
}
