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
 * A reload is always ONE whole sound. It is stored in the first reload slot (mag_out, where the game starts the
 * reload); the build mutes the other reload slots (SILENCE) so the game's own clicks do not play on top.
 */
export function addWholeReload(audio: AudioData, name: string, sourceInfo: string): Promise<LibraryEntry> {
  return addAudioEntry(audio, `${name} (Reload)`, { weapon: 'universal', slot: 'mag_out' }, sourceInfo);
}

/** Imports one reload file as one whole sound. */
export async function importWholeReload(file: File): Promise<LibraryEntry | null> {
  if (!requireFeature('wavImport')) return null;
  try {
    const audio = await decodeAny(new Uint8Array(await file.arrayBuffer())).catch(() => { throw new Error('Das Format kann nicht gelesen werden. Wandle die Datei in MP3 oder WAV um.'); });
    if (peakOf(audio) < 0.001) throw new Error('Die Datei ist stumm.');
    const e = await addWholeReload(audio, file.name.replace(/\.[^.]+$/, ''), `Reload aus ${file.name}`);
    logger.audio(`Reload ${file.name} imported (${(audio.channels[0].length / audio.sampleRate).toFixed(2)} s)`);
    return e;
  } catch (e) {
    toast('error', `${file.name} konnte nicht importiert werden`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

export interface SortedImport {
  /** gunshots, stored for the given weapon's shot slot */
  shots: LibraryEntry[];
  /** the first file recognised as a reload, kept whole */
  reload: LibraryEntry | null;
  /** per file: what SP Tool made of it – for "Falsch erkannt" (the audio stays in memory only) */
  files: SortedFile[];
}
export interface SortedFile { name: string; audio: AudioData; as: 'shot' | 'reload'; predicted: 'shot' | 'reload'; sure: boolean; ids: string[] }

/** Imports files and sorts them by sound: gunshots become shots of `weapon`, a reload sound becomes the whole reload. */
export async function importSorted(files: File[], weapon: WeaponId): Promise<SortedImport> {
  const out: SortedImport = { shots: [], reload: null, files: [] };
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
      const e = await addWholeReload(audio, base, `Importierte Datei ${f.name} (als Nachladen erkannt)`);
      out.reload ??= e;
      out.files.push({ name: f.name, audio, as: 'reload', predicted: cl.kind, sure: cl.sure, ids: [e.id] });
      logger.audio(`Imported ${f.name}: reload sound`);
    } catch (e) {
      toast('error', `${f.name} konnte nicht importiert werden`, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
