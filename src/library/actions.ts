// LibraryService actions: import, export, duplicate.
import { addUserEntry, notify, toast } from '../app/store';
import { audioWorker } from '../audio/workerClient';
import { freshEdit } from '../dsp/chain';
import type { LibraryEntry } from '../models/types';
import { logger } from '../services/logger';
import { putBlob } from '../services/storage';
import { saveBytes } from '../services/tauri';
import { getAudio } from './assets';
import { requireFeature } from '../account/perms';
import { AUDIO_EXT, decodeAny } from './importAudio';
import { classifySound } from '../dsp/classify';

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const safeName = (s: string) => s.replace(/[^\w .\-]+/g, '').trim().replace(/\s+/g, '_') || 'sound';

export async function exportEntryWav(e: LibraryEntry, bits: 16 | 24 = 16) {
  if (!requireFeature('wavExport')) return;
  try {
    const audio = await getAudio(e);
    const bytes = await audioWorker.encode(audio, bits);
    const path = await saveBytes(`${safeName(e.name)}.wav`, bytes, { name: 'WAV-Audio', extensions: ['wav'] });
    if (path) {
      toast('success', 'WAV exportiert', path);
      logger.audio(`Exported "${e.name}" → ${path}`);
    }
  } catch (err) {
    toast('error', 'Export fehlgeschlagen', err instanceof Error ? err.message : String(err));
    logger.error(`Export of "${e.name}" failed`, err);
  }
}

/** Imports audio files (WAV, MP3, OGG, M4A, FLAC …) into the user library. Original files are only read, never modified. */
export async function importWavFiles(files: File[]): Promise<string[]> {
  if (!requireFeature('wavImport')) return [];
  const ids: string[] = [];
  for (const f of files) {
    if (!AUDIO_EXT.test(f.name) && !f.type.startsWith('audio/')) { toast('warning', `${f.name} übersprungen`, 'Das ist keine Audiodatei (MP3, WAV, OGG, M4A, FLAC …).'); continue; }
    if (f.size > MAX_IMPORT_BYTES) { toast('warning', `${f.name} übersprungen`, 'Dateien über 80 MB werden nicht unterstützt.'); continue; }
    try {
      let bytes = new Uint8Array(await f.arrayBuffer());
      // MP3, OGG, M4A, FLAC … → WAV (the library stores WAV)
      if (!/\.wave?$/i.test(f.name)) bytes = await audioWorker.encode(await decodeAny(bytes).catch(() => { throw new Error('Das Format kann nicht gelesen werden. Wandle die Datei in MP3 oder WAV um.'); }), 16);
      const r = await audioWorker.decode(bytes); // validates the file before we store anything
      // gunshot or reload sound? – decides the type, so the library filters (Schuss / Nachladen) sort it right
      const kind = await decodeAny(bytes).then((a) => classifySound(a).kind).catch(() => 'shot' as const);
      const id = newId('imp');
      await putBlob(id, bytes);
      addUserEntry({
        id, name: f.name.replace(/\.[^.]+$/, ''), creator: 'Du', license: 'Deine eigene / wie an dich lizenziert', sourceInfo: `Importierte Datei ${f.name}`,
        source: 'imported', weapon: 'universal', type: kind === 'shot' ? 'fire' : 'reload', style: 'Clean', tags: ['imported', kind === 'shot' ? 'schuss' : 'nachladen'], version: '1.0.0', createdAt: Date.now(),
        blobKey: id, estDuration: r.analysis.duration,
      });
      ids.push(id);
      logger.audio(`Imported ${f.name} (${r.analysis.sampleRate} Hz, ${r.analysis.channels} ch, ${r.analysis.duration.toFixed(2)} s)`);
    } catch (err) {
      toast('error', `${f.name} konnte nicht importiert werden`, err instanceof Error ? err.message : String(err));
      logger.error(`Import of ${f.name} failed`, err);
    }
  }
  const ok = ids.length;
  if (ok) { toast('success', `${ok} Sound${ok > 1 ? 's' : ''} importiert`); notify('Sounds importiert', `${ok} ${ok === 1 ? 'Datei' : 'Dateien'} zu deiner Bibliothek hinzugefügt.`); }
  return ids;
}

/** Duplicate = a new non-destructive edit entry pointing at the original. */
export function duplicateEntry(e: LibraryEntry): LibraryEntry {
  const copy: LibraryEntry = e.edit
    ? { ...e, id: newId('edit'), name: `${e.name} Kopie`, createdAt: Date.now() }
    : {
        ...e, id: newId('edit'), name: `${e.name} Kopie`, source: 'edit', creator: 'Du', createdAt: Date.now(),
        sourceInfo: `Bearbeitung von ${e.name}`, synth: undefined, blobKey: undefined, edit: { baseId: e.id, state: freshEdit() },
      };
  addUserEntry(copy);
  return copy;
}
