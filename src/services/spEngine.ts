// Soundpack-Engine der Windows-App (C#, engine/ im Repo – über SPTool.exe unter /native/sp/*).
// Sie ermittelt aus den GTA-Spieldaten selbst, welche Einträge zu Schuss, Schalldämpfer und Nachladen gehören,
// schreibt WEAPONS_PLAYER.rpf / RESIDENT.rpf (NG-verschlüsselt wie Community-Packs), liest das Ergebnis zurück und
// prüft es. Im Browser oder auf dem Handy gibt es sie nicht – dort baut SP Tool wie bisher (projects/build.ts).
import { encodeWav } from '../dsp/wav';
import type { AudioData } from '../dsp/types';
import { getState } from '../app/store';
import { loadMapping, streamsFor } from '../formats/mapping';
import { SAME_SOUND } from '../projects/build';
import type { WeaponId } from '../models/types';
import { nativeFetch, nativeInfo } from './native';

/** Waffen-IDs von SP Tool → Namen im Spiel. */
export const ENGINE_WEAPON: Record<string, string> = {
  pistol: 'WEAPON_PISTOL',
  pistol_mk2: 'WEAPON_PISTOL_MK2',
  pistol50: 'WEAPON_PISTOL50',
};

export type EngineSlot = 'fire' | 'suppressed_fire' | 'reload';

export interface EngineSound { weapon: string; slot: EngineSlot; audio: AudioData }

export interface EnginePlanEntry { awcPath: string; stream: string; name: string; primary: boolean; seconds: number; sampleRate: number; codec: string }

export interface EngineResult {
  ok: boolean;
  error?: string;
  gameVersion: string;
  notes: string[];
  warnings: string[];
  plan: Record<string, EnginePlanEntry[]>;
  outputs: Array<{ name: string; relativePath: string; size: number; changed: boolean }>;
  replacedStreams: number;
  mutedStreams: number;
  report: string;
}

export interface EngineBuildOutput { result: EngineResult; outputs: Array<{ name: string; bytes: Uint8Array }> }

let availableP: Promise<boolean> | null = null;

/** true, wenn diese SPTool.exe die Engine enthält. */
export function engineAvailable(): Promise<boolean> {
  availableP ??= (async () => {
    if (!(await nativeInfo().catch(() => null))) return false;
    try { return (await nativeFetch<{ available: boolean }>('/native/sp/status')).available; } catch { return false; }
  })();
  return availableP;
}

/** Engine-Zustand: GTA gefunden? Oder ohne GTA bereit (Original-Dateien + Schlüssel einmal importiert)? */
export interface EngineStatus { available: boolean; gta: string; offline: boolean; haveKeys: boolean; haveOriginals: boolean }

export async function engineStatus(): Promise<EngineStatus | null> {
  if (!(await engineAvailable())) return null;
  const gta = encodeURIComponent(getState().settings.gtaPath || '');
  try { return await nativeFetch<EngineStatus>(`/native/sp/status?gta=${gta}`); } catch { return null; }
}

/** true, wenn die Engine jetzt bauen kann – mit GTA-Ordner oder ohne GTA mit importierten Originalen. */
export async function engineReady(): Promise<boolean> {
  const s = await engineStatus();
  return !!s && (!!s.gta || s.offline);
}

export interface ImportResult { ok: boolean; error?: string; imported: string[]; haveKeys: boolean; haveOriginals: boolean; notes: string[] }

/**
 * Einmal-Import für „ohne GTA“: eine GTA5.exe (Legacy) → der Schlüssel wird gemerkt; WEAPONS_PLAYER.rpf / RESIDENT.rpf
 * oder eine ZIP damit → nur Rockstars unveränderte Dateien werden (per Prüfsumme) gesichert. Alles bleibt auf diesem PC.
 */
export async function engineImport(file: File): Promise<ImportResult> {
  const r = await fetch(`/native/sp/import?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'X-SPTool-Native': '1', 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!r.ok) throw new Error(`${file.name}: ${(await r.text().catch(() => '')) || r.status}`);
  const res = (await r.json()) as ImportResult;
  if (!res.ok) throw new Error(res.error || `${file.name} konnte nicht importiert werden.`);
  return { ...res, imported: res.imported ?? [], notes: res.notes ?? [] };
}

/**
 * Zuordnung für den Betrieb ohne GTA (ohne Spieldaten): SP Tools mitgelieferte Liste (weapon_profiles/mapping.json)
 * als Stream-IDs je "WAFFE/slot". Der ganze Reload kommt in den Hauptteil (mag_out). Mit GTA ignoriert die Engine das.
 */
export function mappedStreams(): Record<string, number[]> {
  const m = loadMapping();
  const out: Record<string, number[]> = {};
  for (const [id, name] of Object.entries(ENGINE_WEAPON)) {
    const w = id as WeaponId;
    let fire = streamsFor(m, w, 'fire');
    const alias = SAME_SOUND[`${w}:fire`];
    if (!fire.length && alias) fire = streamsFor(m, alias.weapon, alias.slot);
    out[`${name}/fire`] = [...new Set(fire.map((e) => e.stream))];
    out[`${name}/reload`] = [...new Set(streamsFor(m, w, 'mag_out').map((e) => e.stream))];
  }
  return out;
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJob(command: 'plan' | 'build', packName: string, sounds: EngineSound[], onProgress?: (text: string) => void): Promise<{ id: string; result: EngineResult }> {
  const body = {
    packName,
    encryption: 'ng',
    gta: getState().settings.gtaPath || '',
    streams: mappedStreams(),
    sounds: sounds.map((s) => ({ weapon: s.weapon, slot: s.slot, wav: toBase64(encodeWav(s.audio, 16)) })),
  };
  const r = await fetch(`/native/sp/${command}`, {
    method: 'POST',
    headers: { 'X-SPTool-Native': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let msg = t;
    try { msg = (JSON.parse(t) as { error?: string }).error ?? t; } catch { /* Text */ }
    throw new Error(msg.startsWith('gta_not_found') ? msg.replace(/^gta_not_found:\s*/, '') : `Soundpack-Engine: ${msg || r.status}`);
  }
  const { job } = (await r.json()) as { job: string };
  let last = '';
  for (;;) {
    await sleep(400);
    const st = await nativeFetch<{ done: boolean; progress: string; result?: EngineResult }>(`/native/sp/job?id=${encodeURIComponent(job)}`);
    if (st.progress && st.progress !== last) { last = st.progress; onProgress?.(st.progress); }
    if (st.done) {
      const result = st.result!;
      if (!result.ok) throw new Error(result.error || 'Die Soundpack-Engine ist fehlgeschlagen.');
      return { id: job, result };
    }
  }
}

/** Nur planen: welche Spieldatei-Einträge die Engine für die Auswahl ersetzt (primary) bzw. stumm schaltet. */
export async function enginePlan(sounds: EngineSound[], onProgress?: (text: string) => void): Promise<EngineResult> {
  return (await runJob('plan', 'plan', sounds, onProgress)).result;
}

const SLOT_KIND: Record<EngineSlot, string> = { fire: 'Fire', suppressed_fire: 'SuppressedFire', reload: 'Reload' };

/** Welche Waffe teilt sich laut Spieldaten den Sound mit welcher: `geteilt['pistol_mk2:fire'] = 'pistol'` oder null. */
export type SharedSounds = Record<string, string | null>;

/**
 * Wer im Spiel denselben Sound benutzt, aus den Spieldaten des GTA-Ordners (nicht geraten). Zwei Waffen teilen sich einen
 * Slot, wenn ein Eintrag, der bei beiden den Sound bekommt, derselbe ist. Ergebnis wird je GTA-Ordner gemerkt.
 */
export function sharedSounds(slot: EngineSlot = 'fire'): Promise<SharedSounds | null> {
  const key = `${getState().settings.gtaPath || ''}|${slot}`;
  let p = sharedCache.get(key);
  if (!p) {
    p = (async () => {
      if (!(await engineReady())) return null;
      const plan = (await enginePlan([])).plan;
      const ids = Object.keys(ENGINE_WEAPON);
      const streams = (id: string) => new Set((plan[`${ENGINE_WEAPON[id]}/${SLOT_KIND[slot]}`] ?? []).filter((e) => e.primary).map((e) => `${e.awcPath}|${e.stream}`));
      const sets = Object.fromEntries(ids.map((id) => [id, streams(id)]));
      const out: SharedSounds = {};
      for (const id of ids) out[`${id}:${slot}`] = ids.find((o) => o !== id && [...sets[id]].some((s) => sets[o].has(s))) ?? null;
      return out;
    })().catch(() => { sharedCache.delete(key); return null; });
    sharedCache.set(key, p);
  }
  return p;
}
const sharedCache = new Map<string, Promise<SharedSounds | null>>();

/** Nach einem Import: gemerkte Planungen verwerfen (vorher war die Engine evtl. noch nicht bereit). */
export function resetEngineCache() { sharedCache.clear(); }

/** Baut den Soundpack mit der Engine und lädt die Ausgabe-Archive (immer WEAPONS_PLAYER.rpf + RESIDENT.rpf). */
export async function engineBuild(packName: string, sounds: EngineSound[], onProgress?: (text: string) => void): Promise<EngineBuildOutput> {
  const { id, result } = await runJob('build', packName, sounds, onProgress);
  const outputs: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const o of result.outputs) {
    onProgress?.(`${o.name} wird übernommen…`);
    const r = await fetch(`/native/sp/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(o.relativePath)}`, { headers: { 'X-SPTool-Native': '1' } });
    if (!r.ok) throw new Error(`${o.name} konnte nicht geladen werden (${r.status}).`);
    outputs.push({ name: o.name, bytes: new Uint8Array(await r.arrayBuffer()) });
  }
  return { result, outputs };
}
