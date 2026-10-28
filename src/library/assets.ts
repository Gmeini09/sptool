// LibraryService: resolves any LibraryEntry to audio (lazily), caches audio in an
// LRU and caches lightweight metadata (stats + mini waveform) persistently.
// Metadata first, audio only when needed (spec §123).
import { useEffect, useState } from 'react';
import { getState } from '../app/store';
import type { AudioData } from '../dsp/types';
import { builtinCatalog } from './catalog';
import { turboCatalog } from './turbo';
import { freeReloads } from './freeReloads';
import type { LibraryEntry, SoundStats } from '../models/types';
import { audioWorker, type Rendered } from '../audio/workerClient';
import { logger } from '../services/logger';
import { clearByPrefix, getBlob, loadJSON, saveJSON } from '../services/storage';
import { SYNTH_VERSION } from '../synth/synth';

export interface EntryMeta extends SoundStats { peaks: number[]; clipping: boolean }

const META_KEY = `meta:v${SYNTH_VERSION}`;
const AUDIO_CACHE_MAX = 64;

const audioCache = new Map<string, AudioData>();
const inflight = new Map<string, Promise<Rendered>>();
const meta: Record<string, EntryMeta> = loadJSON(META_KEY, {});
const metaListeners = new Map<string, Set<() => void>>();
let metaSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** The user's own sounds (imported, generated, edited), the Turbo sounds and the free reloads that come with SP Tool. */
export function allEntries(): LibraryEntry[] {
  return [...getState().userEntries, ...turboCatalog(), ...freeReloads()];
}

let decodeCtx: OfflineAudioContext | null = null;
const byIdCache = new Map<string, LibraryEntry>();
// Former built-in sounds are no longer listed anywhere, but soundpacks and edits made with them keep working.
export function entryById(id: string): LibraryEntry | undefined {
  const user = getState().userEntries.find((e) => e.id === id);
  if (user) return user;
  if (!byIdCache.size) for (const e of [...builtinCatalog(), ...turboCatalog(), ...freeReloads()]) byIdCache.set(e.id, e);
  return byIdCache.get(id);
}

function remember(id: string, audio: AudioData) {
  audioCache.delete(id);
  audioCache.set(id, audio);
  while (audioCache.size > AUDIO_CACHE_MAX) audioCache.delete(audioCache.keys().next().value!);
}

function storeMeta(id: string, r: Rendered) {
  const peaks: number[] = [];
  for (let i = 0; i < r.peaks.length; i += 2) peaks.push(Math.round(Math.max(-r.peaks[i], r.peaks[i + 1]) * 100) / 100);
  meta[id] = { duration: r.analysis.duration, peakDb: r.analysis.peakDb, lufs: r.analysis.lufs, peaks, clipping: r.analysis.clipping };
  metaListeners.get(id)?.forEach((l) => l());
  if (!metaSaveTimer) metaSaveTimer = setTimeout(() => { metaSaveTimer = null; saveJSON(META_KEY, meta); }, 1500);
}

async function produce(e: LibraryEntry): Promise<Rendered> {
  if (e.synth) return audioWorker.synth(e.synth);
  if (e.asset) {
    const res = await fetch(e.asset);
    if (!res.ok) throw new Error(`Der Sound „${e.name}“ konnte nicht geladen werden (${res.status}).`);
    decodeCtx ??= new OfflineAudioContext(1, 1, 48000);
    const buf = await decodeCtx.decodeAudioData(await res.arrayBuffer());
    const channels = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => new Float32Array(buf.getChannelData(i)));
    return audioWorker.package({ sampleRate: buf.sampleRate, channels });
  }
  if (e.blobKey) {
    const bytes = await getBlob(e.blobKey);
    if (!bytes) throw new Error(`Die importierte Audiodatei für „${e.name}“ fehlt im lokalen Speicher.`);
    return audioWorker.decode(bytes);
  }
  if (e.edit) {
    const base = entryById(e.edit.baseId);
    if (!base) throw new Error(`Der Original-Sound für „${e.name}“ existiert nicht mehr.`);
    const src = await getAudio(base);
    return audioWorker.render(src, e.edit.state);
  }
  throw new Error(`Der Sound „${e.name}“ hat keine Audioquelle.`);
}

/** Full audio for playback/editing. */
export async function getAudio(e: LibraryEntry): Promise<AudioData> {
  const hit = audioCache.get(e.id);
  if (hit) { remember(e.id, hit); return hit; }
  let p = inflight.get(e.id);
  if (!p) {
    p = produce(e);
    inflight.set(e.id, p);
  }
  try {
    const r = await p;
    remember(e.id, r.audio);
    if (!meta[e.id]) storeMeta(e.id, r);
    return r.audio;
  } catch (err) {
    logger.error(`Could not load audio for "${e.name}"`, err);
    throw err;
  } finally {
    inflight.delete(e.id);
  }
}

export function getMeta(id: string): EntryMeta | undefined { return meta[id]; }

export function invalidate(id: string) {
  audioCache.delete(id);
  delete meta[id];
  metaListeners.get(id)?.forEach((l) => l());
}

// Background metadata queue (concurrency-limited) for visible cards.
const queue: LibraryEntry[] = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const e = queue.shift()!;
    if (meta[e.id]) continue;
    running++;
    getAudio(e).catch(() => {}).finally(() => { running--; pump(); });
  }
}

export function requestMeta(e: LibraryEntry) {
  if (meta[e.id] || queue.includes(e)) return;
  queue.unshift(e);
  if (queue.length > 48) queue.length = 48; // drop stale requests (scrolled away)
  pump();
}

/** React hook: metadata for an entry, computed lazily in the worker. */
export function useEntryMeta(e: LibraryEntry | undefined): EntryMeta | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    if (!e) return;
    let set = metaListeners.get(e.id);
    if (!set) metaListeners.set(e.id, (set = new Set()));
    const l = () => force((x) => x + 1);
    set.add(l);
    requestMeta(e);
    return () => { set!.delete(l); };
  }, [e?.id]);
  return e ? meta[e.id] : undefined;
}

export function clearMetaCache(): number {
  for (const k of Object.keys(meta)) delete meta[k];
  audioCache.clear();
  return clearByPrefix('meta:');
}

export function cacheStats() {
  return { audio: audioCache.size, meta: Object.keys(meta).length };
}
