// Import any audio file (MP3, WAV, OGG, M4A/AAC, FLAC, OPUS, WEBM, even the sound track of an MP4) into the
// library – tagged for the slot it is meant for, so it shows up right there. Everything is stored as WAV.
// Also: split one whole reload recording into its parts (magazine out / in / slide / finish).
import { addUserEntry, toast } from '../app/store';
import { audioWorker } from '../audio/workerClient';
import type { AudioData } from '../dsp/types';
import type { LibraryEntry, SoundType, WeaponId } from '../models/types';
import { logger } from '../services/logger';
import { putBlob } from '../services/storage';
import { requireFeature } from '../account/perms';
import { newId } from './actions';
import { classifySound } from '../dsp/classify';
import { decodeWav } from '../dsp/wav';

export const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm,.mp4,.aif,.aiff,audio/*';
export const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|webm|mp4|aif|aiff)$/i;
const MAX_BYTES = 80 * 1024 * 1024;
/** longest sound we keep (a whole reload can be a few seconds; shots are cut later to the game's length) */
const MAX_SECONDS = 12;

/** What a slot means for a library entry (type / component), so slotMatches() finds it there. */
const SLOT_META: Record<string, { type: SoundType; component?: string }> = {
  fire: { type: 'fire' },
  suppressed_fire: { type: 'suppressor' },
  mag_out: { type: 'reload', component: 'Magazine Out' },
  mag_in: { type: 'reload', component: 'Magazine In' },
  slide: { type: 'mechanical', component: 'Slide Pull' },
  reload_finish: { type: 'reload', component: 'Reload Finish' },
  dry_fire: { type: 'mechanical', component: 'Dry Fire' },
  draw: { type: 'handling', component: 'Weapon Draw' },
  holster: { type: 'handling', component: 'Weapon Holster' },
  kill: { type: 'kill' },
};

let ctx: AudioContext | null = null;
/** Decodes any format the browser engine knows (Chromium/WebView2: mp3, wav, ogg, opus, aac/m4a, flac, webm, mp4). */
export async function decodeAny(bytes: Uint8Array): Promise<AudioData> {
  // WAV is read directly: own sample rate and every sample as it is (the browser engine would resample it)
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE') {
    const w = decodeWav(bytes);
    return { sampleRate: w.sampleRate, channels: w.channels.slice(0, 2) };
  }
  ctx ??= new AudioContext();
  const buf = await ctx.decodeAudioData(bytes.slice().buffer);
  const channels = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => new Float32Array(buf.getChannelData(i)));
  return { sampleRate: buf.sampleRate, channels };
}

/** Cuts silence at the start (shots must start right away) and at the end, and limits the length. */
export function trimSilence(a: AudioData, threshold = 0.004): AudioData {
  const n = a.channels[0].length;
  const loud = (i: number) => a.channels.some((c) => Math.abs(c[i]) > threshold);
  let s = 0; while (s < n && !loud(s)) s++;
  let e = n - 1; while (e > s && !loud(e)) e--;
  if (s >= n) return a; // all silent – keep as is, the caller reports it
  s = Math.max(0, s - Math.round(a.sampleRate * 0.002));
  e = Math.min(n, e + Math.round(a.sampleRate * 0.03), s + Math.round(a.sampleRate * MAX_SECONDS));
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => c.slice(s, e)) };
}

export function peakOf(a: AudioData): number {
  let p = 0;
  for (const c of a.channels) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}

export interface ImportTarget { weapon: WeaponId | 'universal'; slot: string }

/** Stores audio as a new library entry (WAV) and returns it. */
export async function addAudioEntry(audio: AudioData, name: string, target: ImportTarget, sourceInfo: string): Promise<LibraryEntry> {
  const bytes = await audioWorker.encode(audio, 16);
  const id = newId('imp');
  await putBlob(id, bytes);
  const m = SLOT_META[target.slot] ?? { type: 'fire' as SoundType };
  const e: LibraryEntry = {
    id, name, creator: 'Du', license: 'Deine eigene / wie an dich lizenziert', sourceInfo,
    source: 'imported', weapon: target.weapon, type: m.type, component: m.component, style: 'Clean',
    tags: ['imported', target.slot], version: '1.0.0', createdAt: Date.now(),
    blobKey: id, estDuration: audio.channels[0].length / audio.sampleRate,
  };
  addUserEntry(e);
  return e;
}

/** Imports audio files for one slot. Returns the new entries (in order). Shows its own error toasts. */
export async function importAudioFiles(files: File[], target: ImportTarget): Promise<LibraryEntry[]> {
  if (!requireFeature('wavImport')) return [];
  const out: LibraryEntry[] = [];
  for (const f of files) {
    if (!AUDIO_EXT.test(f.name) && !f.type.startsWith('audio/')) { toast('warning', `${f.name} übersprungen`, 'Das ist keine Audiodatei (MP3, WAV, OGG, M4A, FLAC …).'); continue; }
    if (f.size > MAX_BYTES) { toast('warning', `${f.name} übersprungen`, 'Dateien über 80 MB werden nicht unterstützt.'); continue; }
    try {
      const raw = await decodeAny(new Uint8Array(await f.arrayBuffer())).catch(() => { throw new Error('Das Format kann nicht gelesen werden. Wandle die Datei in MP3 oder WAV um.'); });
      const audio = raw; // 1 : 1 – nothing cut off
      if (peakOf(audio) < 0.001) throw new Error('Die Datei ist stumm.');
      out.push(await addAudioEntry(audio, f.name.replace(/\.[^.]+$/, ''), target, `Importierte Datei ${f.name}`));
      logger.audio(`Imported ${f.name} for ${target.weapon}/${target.slot} (${audio.sampleRate} Hz, ${(audio.channels[0].length / audio.sampleRate).toFixed(2)} s)`);
    } catch (e) {
      toast('error', `${f.name} konnte nicht importiert werden`, e instanceof Error ? e.message : String(e));
      logger.error(`Import of ${f.name} failed`, e);
    }
  }
  return out;
}

/**
 * Splits a whole reload recording into its parts: loud events separated by quieter gaps (≥ 60 ms), or – when two
 * hits follow closely – by a clear new attack inside a part. The threshold sits above the recording's noise floor, so
 * recordings with background noise or room sound split too.
 * Returns up to `max` segments, the loudest ones in time order (the usual reload: mag out, mag in, slide, finish).
 */
export function splitReload(a: AudioData, max = 4): AudioData[] {
  const sr = a.sampleRate, n = a.channels[0].length;
  const win = Math.max(1, Math.round(sr * 0.005));
  const env: number[] = [];
  for (let i = 0; i < n; i += win) {
    let p = 0;
    for (const c of a.channels) for (let j = i; j < Math.min(n, i + win); j++) { const v = Math.abs(c[j]); if (v > p) p = v; }
    env.push(p);
  }
  let peak = 1e-6; for (const v of env) if (v > peak) peak = v;
  // noise floor = the quietest fifth of the recording; parts must stand out from it (hiss, room tone, wind …)
  const floor = [...env].sort((x, y) => x - y)[Math.floor(env.length * 0.2)] ?? 0;
  const thr = Math.max(peak * 0.08, floor * 2.5), minGap = Math.round(0.06 * sr / win), reGap = Math.round(0.09 * sr / win);
  const segs: Array<{ s: number; e: number; p: number }> = [];
  let start = -1, quiet = 0, segPeak = 0;
  const close = (end: number) => { if (start >= 0 && end > start) segs.push({ s: start, e: end, p: segPeak }); start = -1; quiet = 0; };
  for (let i = 0; i < env.length; i++) {
    if (env[i] > thr) {
      // a new hit inside a part (no quiet gap, e.g. magazine in right before the slide): 8× the quietest of the
      // last 30 ms, ≥ 40 % of the peak and ≥ 90 ms after the part began
      if (start >= 0 && i - start >= reGap) {
        let m = Infinity; for (let j = Math.max(start, i - 6); j < i; j++) m = Math.min(m, env[j]);
        if (env[i] > m * 8 && env[i] > peak * 0.4) close(i);
      }
      if (start < 0) { start = i; segPeak = 0; }
      quiet = 0; segPeak = Math.max(segPeak, env[i]);
    } else if (start >= 0 && ++quiet >= minGap) close(i - quiet + 1);
  }
  close(env.length);
  const keep = [...segs].sort((x, y) => y.p - x.p).slice(0, max).sort((x, y) => x.s - y.s);
  return keep.map(({ s, e }) => {
    const a0 = Math.max(0, s * win - Math.round(sr * 0.004)), a1 = Math.min(n, e * win + Math.round(sr * 0.04));
    return { sampleRate: sr, channels: a.channels.map((c) => c.slice(a0, a1)) };
  });
}

/** Imports one whole reload file and splits it into its parts (stored as separate library sounds). */
/**
 * split = true: cut into magazine out / in / slide / finish. split = false: keep it as ONE sound that starts with
 * the reload (on "Magazin raus"); the other parts are set to silence so the game's own clicks don't play on top.
 */
export async function importWholeReload(file: File, weapon: WeaponId | 'universal', split = true, opts: { onWhole?: () => void } = {}): Promise<Record<string, LibraryEntry>> {
  if (!requireFeature('wavImport')) return {};
  try {
    const audio = await decodeAny(new Uint8Array(await file.arrayBuffer())).catch(() => { throw new Error('Das Format kann nicht gelesen werden. Wandle die Datei in MP3 oder WAV um.'); });
    if (peakOf(audio) < 0.001) throw new Error('Die Datei ist stumm.');
    const base0 = file.name.replace(/\.[^.]+$/, '');
    const parts = split ? splitReload(audio) : [];
    // one continuous sound (nothing to cut): as one short part it would only replace "Magazin rein" and be cut off –
    // it is kept whole instead and the caller is told (opts.onWhole)
    const longOne = split && parts.length === 1 && audio.channels[0].length / audio.sampleRate > 0.6;
    if (longOne) opts.onWhole?.();
    if (!split || longOne) {
      // only the whole sound – the other reload parts are muted by the build (SILENCE), see views/Create.tsx
      const out: Record<string, LibraryEntry> = { mag_out: await addAudioEntry(audio, `${base0} (ganzer Reload)`, { weapon, slot: 'mag_out' }, `Ganzer Reload aus ${file.name}`) };
      logger.audio(`Reload ${file.name} kept whole (${(audio.channels[0].length / audio.sampleRate).toFixed(2)} s)`);
      return out;
    }
    if (!parts.length) throw new Error('In der Datei wurden keine einzelnen Geräusche gefunden.');
    const slots = parts.length >= 4 ? ['mag_out', 'mag_in', 'slide', 'reload_finish'] : parts.length === 3 ? ['mag_out', 'mag_in', 'slide'] : parts.length === 2 ? ['mag_out', 'mag_in'] : ['mag_in'];
    const label: Record<string, string> = { mag_out: 'Magazin raus', mag_in: 'Magazin rein', slide: 'Schlitten', reload_finish: 'Nachladen fertig' };
    const base = file.name.replace(/\.[^.]+$/, '');
    const out: Record<string, LibraryEntry> = {};
    for (let i = 0; i < slots.length; i++) out[slots[i]] = await addAudioEntry(parts[i], `${base} · ${label[slots[i]]}`, { weapon, slot: slots[i] }, `Aus ${file.name} (Teil ${i + 1} von ${parts.length})`);
    logger.audio(`Reload ${file.name} split into ${parts.length} parts`);
    return out;
  } catch (e) {
    toast('error', `${file.name} konnte nicht importiert werden`, e instanceof Error ? e.message : String(e));
    return {};
  }
}

export interface SortedImport {
  /** gunshots, stored for the given weapon's shot slot */
  shots: LibraryEntry[];
  /** reload sounds by part (a whole reload recording is split into its parts) */
  reload: Record<string, LibraryEntry>;
  /** per file: what SP Tool made of it – for "Falsch erkannt" (the audio stays in memory only) */
  files: SortedFile[];
}
export interface SortedFile { name: string; audio: AudioData; as: 'shot' | 'reload'; predicted: 'shot' | 'reload'; sure: boolean; ids: string[] }

/** Puts a sound into the reload parts: a recording with several clicks is split, a single click takes the next free part. */
export async function reloadPartsOf(audio: AudioData, base: string, taken: string[], sourceInfo: string): Promise<Record<string, LibraryEntry>> {
  const order = ['mag_out', 'mag_in', 'slide', 'reload_finish'];
  const label: Record<string, string> = { mag_out: 'Magazin raus', mag_in: 'Magazin rein', slide: 'Schlitten', reload_finish: 'Nachladen fertig' };
  const parts = audio.channels[0].length / audio.sampleRate > 0.45 ? splitReload(audio) : [audio];
  const free = order.filter((s) => !taken.includes(s));
  const slots = parts.length >= 2 ? order.slice(0, Math.min(4, parts.length)) : [free[0] ?? 'mag_in'];
  const out: Record<string, LibraryEntry> = {};
  for (let i = 0; i < slots.length; i++) out[slots[i]] = await addAudioEntry(parts[i], parts.length >= 2 ? `${base} · ${label[slots[i]]}` : base, { weapon: 'universal', slot: slots[i] }, sourceInfo);
  return out;
}

/**
 * Imports files and sorts them by sound: gunshots become shots of `weapon`, reload / mechanical sounds become
 * reload parts (a recording with several clicks is split into magazine out / in / slide / finish; single clicks
 * fill the next free part).
 */
export async function importSorted(files: File[], weapon: WeaponId): Promise<SortedImport> {
  const out: SortedImport = { shots: [], reload: {}, files: [] };
  if (!requireFeature('wavImport')) return out;
  for (const f of files.slice(0, 12)) {
    if (!AUDIO_EXT.test(f.name) && !f.type.startsWith('audio/')) { toast('warning', `${f.name} übersprungen`, 'Das ist keine Audiodatei (MP3, WAV, OGG, M4A, FLAC …).'); continue; }
    if (f.size > MAX_BYTES) { toast('warning', `${f.name} übersprungen`, 'Dateien über 80 MB werden nicht unterstützt.'); continue; }
    try {
      const audio = await decodeAny(new Uint8Array(await f.arrayBuffer())).catch(() => { throw new Error('Das Format kann nicht gelesen werden. Wandle die Datei in MP3 oder WAV um.'); });
      if (peakOf(audio) < 0.001) throw new Error('Die Datei ist stumm.');
      const base = f.name.replace(/\.[^.]+$/, '');
      const cl = classifySound(audio);
      // on a weapon step: one file is the shot; of several files only clear reload sounds go to the reload
      if (files.length === 1 || cl.kind === 'shot' || !cl.sure) {
        const e = await addAudioEntry(audio, base, { weapon, slot: 'fire' }, `Importierte Datei ${f.name} (als Schuss erkannt)`);
        out.shots.push(e);
        out.files.push({ name: f.name, audio, as: 'shot', predicted: cl.kind, sure: cl.sure, ids: [e.id] });
        continue;
      }
      const got = await reloadPartsOf(audio, base, Object.keys(out.reload), `Importierte Datei ${f.name} (als Nachladen erkannt)`);
      Object.assign(out.reload, got);
      out.files.push({ name: f.name, audio, as: 'reload', predicted: cl.kind, sure: cl.sure, ids: Object.values(got).map((e) => e.id) });
      const parts = Object.keys(got);
      logger.audio(`Imported ${f.name}: reload sound, ${parts.length} part(s)`);
    } catch (e) {
      toast('error', `${f.name} konnte nicht importiert werden`, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
