// ProjectService: rendering, playback, import/export of .spproject files.
import { addProject, addUserEntry, getState, toast, updateProject } from '../app/store';
import { canAddProject, requireFeature } from '../account/perms';
import { engine } from '../audio/engine';
import { audioWorker } from '../audio/workerClient';
import type { AudioData } from '../dsp/types';
import { entryById, getAudio } from '../library/assets';
import { logger } from '../services/logger';
import { getBlob, putBlob } from '../services/storage';
import { b64ToBytes, bytesToB64, saveBytes } from '../services/tauri';
import { addSnapshot, newProject, parseProjectFile, PROJECT_FORMAT, PROJECT_VERSION, usedEntryIds, type Project, type ProjectFile, type SlotAssignment } from './project';

export async function renderAssignment(a: SlotAssignment): Promise<AudioData> {
  const e = entryById(a.entryId);
  if (!e) throw new Error('Der Sound in diesem Slot ist nicht mehr in deiner Bibliothek.');
  const src = await getAudio(e);
  if (!a.edit) return src;
  return (await audioWorker.render(src, a.edit)).audio;
}

export async function playAssignment(key: string, a: SlotAssignment) {
  if (engine.playingKey === key) { engine.stop(); return; }
  try {
    engine.setVolume(getState().settings.volume);
    engine.play(await renderAssignment(a), { key });
  } catch (e) {
    toast('error', 'Dieser Slot konnte nicht abgespielt werden', e instanceof Error ? e.message : String(e));
  }
}

/** Plays a sequence of slots one after another (spec §118 Play full pack). */
export async function playSequence(items: Array<{ key: string; a: SlotAssignment }>, onStep: (k: string | null) => void) {
  for (const it of items) {
    let audio: AudioData;
    try { audio = await renderAssignment(it.a); } catch { continue; }
    onStep(it.key);
    const done = new Promise<void>((res) => engine.play(audio, { key: 'fullpack', onEnded: () => res() }));
    await done;
    if (engine.playingKey && engine.playingKey !== 'fullpack') break;
    await new Promise((r) => setTimeout(r, 180));
  }
  onStep(null);
}

/** Self-contained project: the project plus every non-built-in sound it uses (edit originals and imported audio included). */
export async function buildProjectFile(p: Project): Promise<ProjectFile> {
  const entries = usedEntryIds(p).map((id) => entryById(id)).filter((e) => e && e.source !== 'builtin');
  // include originals of edits so the file is self-contained
  for (const e of [...entries]) if (e?.edit) { const base = entryById(e.edit.baseId); if (base && base.source !== 'builtin' && !entries.includes(base)) entries.push(base); }
  const blobs: Record<string, string> = {};
  for (const e of entries) if (e?.blobKey) { const b = await getBlob(e.blobKey); if (b) blobs[e.blobKey] = bytesToB64(b); }
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, project: p, entries: entries as ProjectFile['entries'], blobs };
}

/** Adds the sounds of a project file that are missing locally (imported audio included). */
export async function importProjectSounds(parsed: ProjectFile) {
  const have = new Set(getState().userEntries.map((e) => e.id));
  for (const e of parsed.entries) {
    if (have.has(e.id) || e.source === 'builtin') continue;
    if (e.blobKey && parsed.blobs[e.blobKey]) await putBlob(e.blobKey, b64ToBytes(parsed.blobs[e.blobKey]));
    addUserEntry(e);
  }
}

export async function exportProject(p: Project) {
  if (!requireFeature('projectFiles')) return;
  const file = await buildProjectFile(p);
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  const path = await saveBytes(`${p.name.replace(/[^\w .-]+/g, '').trim().replace(/\s+/g, '_') || 'project'}.spproject`, bytes, { name: 'SP Tool-Projekt', extensions: ['spproject'] });
  if (path) { toast('success', 'Soundpack exportiert', path); logger.info(`Exported project "${p.name}" → ${path}`); }
}

export async function importProjectFile(f: File): Promise<boolean> {
  if (!requireFeature('projectFiles') || !canAddProject()) return false;
  try {
    const parsed = parseProjectFile(await f.text());
    await importProjectSounds(parsed);
    const fresh = newProject(parsed.project.name, parsed.project.author);
    addProject({ ...parsed.project, id: fresh.id, updatedAt: Date.now() });
    toast('success', 'Soundpack importiert', parsed.project.name);
    return true;
  } catch (e) {
    toast('error', 'Soundpack konnte nicht geöffnet werden', e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Snapshot every minute while a project has changes since its last snapshot (spec §97). */
let lastSnap = new Map<string, number>();
export function snapshotTick() {
  const s = getState();
  const p = s.projects.find((x) => x.id === s.currentProjectId);
  if (!p) return;
  const last = lastSnap.get(p.id) ?? p.snapshots[0]?.at ?? 0;
  if (p.updatedAt > last) {
    updateProject(p.id, (x) => addSnapshot(x, 'Automatisch gespeichert'));
    lastSnap.set(p.id, Date.now());
  }
}
