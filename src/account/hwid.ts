// Device identity (HWID) used to bind a license to a computer.
//
// Desktop app: the OS machine id (Windows MachineGuid, Linux machine-id, macOS platform UUID),
// read by the native core. It is hashed here with an app-specific salt and hashed again on the
// server with a server secret – the raw id never leaves the computer.
// Browser preview: a random id stored in this browser. Clearing site data creates a "new device",
// so browser bindings are weaker by design; this is shown in the UI.
import { invoke, isTauri } from '../services/tauri';
import { nativeInfo } from '../services/native';

export interface DeviceIdentity {
  hwid: string; // 64 hex chars
  name: string;
  kind: 'desktop' | 'browser' | 'mobile';
  /** true when backed by an OS machine id */
  strong: boolean;
  source: string;
}

const SALT = 'sptool-hwid-v1';
const BROWSER_KEY = 'sptool:browser-device-id';

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashMachineId = (raw: string) => sha256Hex(`${SALT}:${raw.trim().toLowerCase()}`);

function browserName(): string {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} auf ${os}` : b;
}
const isMobileUa = () => /Android|iPhone|iPad/.test(navigator.userAgent);

let cached: Promise<DeviceIdentity> | null = null;

export function getDevice(): Promise<DeviceIdentity> {
  cached ??= (async () => {
    if (isTauri()) {
      const m = await invoke<{ id: string; source: string; hostName: string }>('machine_id');
      return { hwid: await hashMachineId(m.id), name: m.hostName.slice(0, 40) || 'PC', kind: isMobileUa() ? 'mobile' : 'desktop', strong: m.source !== 'app-generated', source: m.source };
    }
    const nat = await nativeInfo();
    if (nat?.machineId) {
      // Windows app (SPTool.exe): real MachineGuid, same hash as the Tauri build.
      return { hwid: await hashMachineId(nat.machineId), name: nat.hostName.slice(0, 40) || 'PC', kind: 'desktop', strong: nat.machineIdSource !== 'app-generated', source: nat.machineIdSource };
    }
    let id = '';
    try { id = localStorage.getItem(BROWSER_KEY) ?? ''; } catch { /* storage blocked */ }
    if (!/^[a-f0-9]{32}$/.test(id)) {
      id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem(BROWSER_KEY, id); } catch { /* not persisted: new device next time */ }
    }
    return { hwid: await hashMachineId(`browser:${id}`), name: browserName(), kind: isMobileUa() ? 'mobile' : 'browser', strong: false, source: 'browser-storage' };
  })();
  return cached;
}
