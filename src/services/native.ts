// Bridge to the native Windows app (SPTool.exe). The exe serves this app on localhost and answers
// /native/* (same-origin only). In a plain browser or Tauri these calls simply report "not native".
export interface NativeInfo { version: string; platform: string; machineId: string; machineIdSource: string; hostName: string; dataDir: string }

let infoP: Promise<NativeInfo | null> | null = null;

export async function nativeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'X-SPTool-Native': '1', ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`Native ${path}: ${r.status}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** Info from the Windows app, or null when not running inside it. */
export function nativeInfo(): Promise<NativeInfo | null> {
  infoP ??= (async () => {
    if (typeof location === 'undefined' || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const info = await nativeFetch<NativeInfo>('/native/info', { signal: ctl.signal });
      clearTimeout(t);
      return info?.platform ? info : null;
    } catch { return null; }
  })();
  return infoP;
}

/** Tells the exe the window is open; it exits shortly after the window closes. */
export async function startNativeHeartbeat() {
  if (!(await nativeInfo())) return;
  const beat = () => { void nativeFetch('/native/heartbeat', { method: 'POST' }).catch(() => {}); };
  beat();
  setInterval(beat, 5000);
}
