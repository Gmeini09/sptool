// FiveMService / GTAService front: real detection through the native core.
import { logger } from './logger';
import { invoke, isTauri } from './tauri';
import { nativeFetch, nativeInfo } from './native';

export interface FiveMStatus {
  detected: boolean;
  root: string | null;
  appDir: string | null;
  configuredGtaPath: string | null;
  running: boolean;
  checked: string[];
}

export interface GtaInstall { source: string; path: string; valid: boolean; edition: string }

export interface AppInfo { version: string; dataDir: string; logDir: string; platform: string }

export type DetectState<T> = { state: 'unavailable' } | { state: 'checking' } | { state: 'done'; value: T } | { state: 'error'; message: string };

export async function detectFiveM(customRoot?: string): Promise<DetectState<FiveMStatus>> {
  const native = !isTauri() && !!(await nativeInfo());
  if (!isTauri() && !native) return { state: 'unavailable' };
  try {
    const value = native
      ? await nativeFetch<FiveMStatus>(`/native/detect/fivem?customRoot=${encodeURIComponent(customRoot || '')}`)
      : await invoke<FiveMStatus>('detect_fivem', { customRoot: customRoot || null });
    logger.info(value.detected ? `FiveM detected at ${value.root}` : `FiveM not found (checked ${value.checked.length} locations)`);
    return { state: 'done', value };
  } catch (e) {
    logger.error('FiveM detection failed', e);
    return { state: 'error', message: String(e) };
  }
}

export async function detectGta(customPath?: string): Promise<DetectState<GtaInstall[]>> {
  const native = !isTauri() && !!(await nativeInfo());
  if (!isTauri() && !native) return { state: 'unavailable' };
  try {
    const value = native
      ? await nativeFetch<GtaInstall[]>(`/native/detect/gta?customPath=${encodeURIComponent(customPath || '')}`)
      : await invoke<GtaInstall[]>('detect_gta', { customPath: customPath || null });
    logger.info(`GTA V detection: ${value.filter((v) => v.valid).length} valid install(s)`, value);
    return { state: 'done', value };
  } catch (e) {
    logger.error('GTA V detection failed', e);
    return { state: 'error', message: String(e) };
  }
}

export async function appInfo(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  try { return await invoke<AppInfo>('app_info'); } catch { return null; }
}
