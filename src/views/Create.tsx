// "Soundpack erstellen": Pistol → Pistol MK2 → Pistol .50 → Nachladen → Fertig.
// Every step is built around YOUR sounds: drop in any audio file (MP3, WAV, OGG, M4A, FLAC …), take one out of a
// soundpack you have, or pick one from the library – or keep the original. Nothing is installed and no backups
// are made: WEAPONS_PLAYER.rpf + RESIDENT.rpf go as one ZIP to Downloads › SP Tool › <name>.zip.
import { useEffect, useMemo, useRef, useState } from 'react';
import { addProject, FILES_DROPPED, getState, removeUserEntry, setState, toast, useApp } from '../app/store';
import { engine } from '../audio/engine';
import { previewEntry, usePlayingKey } from '../audio/preview';
import { BasePicker, useBase } from '../components/BasePicker';
import { Icon } from '../components/Icon';
import { PackSoundsDialog } from '../components/PackSounds';
import { Button, DoneMark, Progress } from '../components/ui';
import type { AudioData } from '../dsp/types';
import { classifySound } from '../dsp/classify';
import { loadMapping, MAPPING_EVENT } from '../formats/mapping';
import { allEntries, entryById } from '../library/assets';
import { featuredFirst } from '../library/turbo';
import { freeReloads } from '../library/freeReloads';
import { AUDIO_ACCEPT, AUDIO_EXT, addAudioEntry, importAudioFiles, importSorted, importWholeReload, reloadPartsOf, type SortedFile } from '../library/importAudio';
import { reportDetection } from '../services/detectionFeedback';
import type { LibraryEntry, Style, WeaponId } from '../models/types';
import { renderAssignment } from '../projects/actions';
import { baseInfo, ensureBase, moreRoomBase } from '../projects/basePack';
import { soundReport } from '../projects/report';
import { blockedLabels, inGameAudio, nothingChangesMessage, planBuild, runBuild, sameAsBase, sharedReload, SILENCE, type BuildPlan, type InGameSound, type PlanItem, type Transplant } from '../projects/build';
import { openPack, type Pack } from '../formats/pack';
import { streamToAudio } from '../formats/awc';
import { assign, newProject, slotMatches, usedEntryIds, type Project } from '../projects/project';
import { saveToDownloads, showDownloads } from '../services/downloads';
import { deleteBlob } from '../services/storage';
import { checkInGame, sha256Hex, showSfxFolder, type CheckResult, type FileState } from '../services/modsCheck';
import { openGameTest } from './GameTest';
import { nativeInfo } from '../services/native';
import { logger } from '../services/logger';
import { WEAPON_PROFILES } from '../weapons/profiles';

const WEAPONS = WEAPON_PROFILES.map((p) => p.id as WeaponId); // pistol, pistol_mk2, pistol50
const RELOAD_SLOTS = ['mag_out', 'mag_in', 'slide', 'reload_finish'] as const;
const RELOAD_LABEL: Record<string, string> = { mag_out: 'Magazin raus', mag_in: 'Magazin rein', slide: 'Schlitten', reload_finish: 'Nachladen fertig' };
const ORIGINAL = 'original';
const label = (w: WeaponId) => WEAPON_PROFILES.find((p) => p.id === w)!.displayName;
const STEPS = [...WEAPONS.map(label), 'Nachladen', 'Fertig'];
const RELOAD_STEP = WEAPONS.length, DONE_STEP = WEAPONS.length + 1;

type ReloadMode = 'whole' | 'single' | 'none';
interface ReloadChoice { mode: ReloadMode; split: boolean; whole: Record<string, string> | null; single: Record<string, string | null>; weapons: WeaponId[] }

const entriesFor = (lib: LibraryEntry[], w: WeaponId, slot: string) => lib.filter((e) => slotMatches(e, w, slot));

/** Plays the reload parts one after another. */
async function playSequence(ids: string[]) {
  const parts: AudioData[] = [];
  for (const id of ids) if (id && id !== SILENCE) parts.push(await renderAssignment({ entryId: id }));
  if (!parts.length) return;
  const sr = parts[0].sampleRate, gap = Math.round(sr * 0.3);
  const len = parts.reduce((n, p) => n + Math.round(p.channels[0].length * sr / p.sampleRate) + gap, 0);
  const out = [new Float32Array(len), new Float32Array(len)];
  let pos = 0;
  for (const p of parts) {
    const ratio = p.sampleRate / sr, n = Math.round(p.channels[0].length / ratio);
    for (let ch = 0; ch < 2; ch++) { const src = p.channels[Math.min(ch, p.channels.length - 1)]; for (let i = 0; i < n; i++) out[ch][pos + i] = src[Math.min(src.length - 1, Math.floor(i * ratio))]; }
    pos += n + gap;
  }
  engine.play({ sampleRate: sr, channels: out }, { key: `seq:${ids.join(',')}` });
}

/** Drop zone + button for audio files (any format). */
function AudioDrop({ title, hint, multiple, onFiles }: { title: string; hint: string; multiple?: boolean; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={`audio-drop${over ? ' over' : ''}`} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}>
      <input ref={ref} type="file" accept={AUDIO_ACCEPT} multiple={multiple} hidden onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <Icon name="upload" size={22} />
      <div className="grow"><b>{title}</b><div className="small muted">{hint}</div></div>
    </div>
  );
}

function SoundRow({ e, sel, onPick, playing, extra }: { e: LibraryEntry; sel: boolean; onPick: () => void; playing: string | null; extra?: string }) {
  return (
    <div className={`create-item${sel ? ' sel' : ''}`} onClick={onPick}>
      <button className={`play-btn${playing === e.id ? ' playing' : ''}`} aria-label="Anhören" onClick={(ev) => { ev.stopPropagation(); if (playing === e.id) engine.stop(); else void previewEntry(e); }}><Icon name={playing === e.id ? 'stop' : 'play'} size={12} /></button>
      <span className="grow ellipsis">{e.name}</span>
      {extra && <span className="faint small">{extra}</span>}
      {sel && <span className="chip ok"><Icon name="check" size={12} />gewählt</span>}
    </div>
  );
}

export function CreateView() {
  const session = useApp((s) => s.session);
  const userEntries = useApp((s) => s.userEntries);
  const lib = useMemo(() => allEntries(), [userEntries]);
  const base = useBase();
  const playing = usePlayingKey();
  const [step, setStep] = useState(0);
  const [style, setStyle] = useState<Style | 'all' | 'featured'>('all');
  const [fire, setFire] = useState<Record<string, string | null>>({});
  const [reload, setReload] = useState<ReloadChoice>({ mode: 'whole', split: true, whole: null, single: {}, weapons: [...WEAPONS] });
  const [name, setName] = useState('Mein Soundpack');
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<number | null>(null);
  const [needBase, setNeedBase] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [rest, setRest] = useState<Transplant | null>(null);
  const [showLib, setShowLib] = useState(false);
  const [done, setDone] = useState<{ dir: string | null; names: string[]; zip?: string; folder: string; plan: BuildPlan; built: Array<{ name: string; sha256: string }>; pack: Pack; template: string } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const runCheck = async () => {
    if (!done) return;
    setChecking(true);
    try { setCheck(await checkInGame(done.built)); } catch (e) { toast('error', 'Prüfen fehlgeschlagen', e instanceof Error ? e.message : String(e)); } finally { setChecking(false); }
  };
  // what the last import on a weapon step was sorted into – "Falsch erkannt" turns a file around
  const [recog, setRecog] = useState<SortedFile[]>([]);
  const [native, setNative] = useState(true);
  // sounds dropped anywhere on this page (not only on the drop field) are taken like the field would
  const dropRef = useRef<(files: File[]) => boolean>(() => false);
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent<{ files: File[]; taken: boolean }>).detail; if (!d.taken && dropRef.current(d.files)) d.taken = true; };
    window.addEventListener(FILES_DROPPED, f);
    return () => window.removeEventListener(FILES_DROPPED, f);
  }, []);
  useEffect(() => { void nativeInfo().then((n) => setNative(!!n)).catch(() => setNative(false)); }, []);
  useEffect(() => () => engine.stop(), []);
  // "Alle löschen" asks once more before the imported sounds of this step are gone
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { engine.stop(); setShowLib(false); setRecog([]); setConfirmClear(false); }, [step]);

  const cur: WeaponId | null = step < WEAPONS.length ? WEAPONS[step] : null;
  const pickFire = (w: WeaponId, id: string | null) => setFire((f) => ({ ...f, [w]: id }));
  const lastReload = useRef<File | null>(null);
  // switching between "in Teile" and "als Ganzes" reuses what was already imported (no duplicates in the library)
  const reloadCache = useRef(new Map<string, Record<string, LibraryEntry>>());
  const importReload = async (file: File, split: boolean) => {
    setBusy(split ? 'Reload wird zerlegt…' : 'Reload wird übernommen…');
    const ck = `${file.name}:${file.size}:${file.lastModified}:${split}`;
    let whole = false;
    const cached = reloadCache.current.get(ck);
    const parts = cached ?? await importWholeReload(file, 'universal', split, { onWhole: () => { whole = true; } });
    // nothing to cut (one continuous sound): it runs as one whole reload instead of a cut-off "Magazin rein"
    if (split && !cached && whole) {
      setBusy(null);
      if (Object.keys(parts).length) reloadCache.current.set(`${file.name}:${file.size}:${file.lastModified}:false`, parts);
      return importReload(file, false);
    }
    if (Object.keys(parts).length) reloadCache.current.set(ck, parts);
    const first = parts.mag_out ?? Object.values(parts)[0];
    if (first) { const c = classifySound(await renderAssignment({ entryId: first.id })); if (c.kind === 'shot' && c.sure) toast('warning', 'Klingt eher nach einem Schuss', 'Trotzdem als Nachladen übernommen – prüf es mit „Alles anhören“.'); }
    setBusy(null);
    const ids: Record<string, string> = Object.fromEntries(Object.entries(parts).map(([k, e]) => [k, e.id]));
    // as ONE sound: the other reload parts are muted in the pack, which also frees room for the full length
    if (!split && ids.mag_out) for (const k of ['mag_in', 'slide', 'reload_finish']) ids[k] = SILENCE;
    if (!Object.keys(ids).length) return;
    setReload((r) => ({ ...r, split, whole: ids }));
    void playSequence(split ? RELOAD_SLOTS.map((k) => ids[k] ?? '') : [ids.mag_out]);
  };

  const reloadIds = (): Record<string, string> => {
    if (reload.mode === 'whole') return reload.whole ?? {};
    if (reload.mode === 'single') return Object.fromEntries(Object.entries(reload.single).filter(([, v]) => v)) as Record<string, string>;
    return {};
  };
  const project = (): Project => {
    let p = newProject(name.trim() || 'Mein Soundpack', session?.displayName ?? '');
    const rel = reloadIds();
    for (const w of WEAPONS) {
      const f = fire[w];
      if (f && f !== ORIGINAL) p = assign(p, w, 'fire', { entryId: f });
      if (reload.weapons.includes(w)) for (const s of RELOAD_SLOTS) {
        if (rel[s]) p = assign(p, w, s, { entryId: rel[s] });
        // a whole reload as ONE sound plays at the start of the reload – the other reload parts are muted, so the
        // game's own clicks do not sound on top of it (the way creator packs do it)
        else if (reload.mode === 'whole' && !reload.split && rel.mag_out) p = assign(p, w, s, { entryId: SILENCE });
      }
    }
    return p;
  };
  // plan anew when the mapping changes (in-game test saved, mapping published by an admin)
  const [mapRev, setMapRev] = useState(0);
  useEffect(() => { const f = () => setMapRev((n) => n + 1); window.addEventListener(MAPPING_EVENT, f); return () => window.removeEventListener(MAPPING_EVENT, f); }, []);
  const plan = useMemo(() => planBuild(project(), WEAPON_PROFILES, loadMapping(), base?.pack ?? null), [fire, reload, name, base, mapRev]);
  const ok = (i: PlanItem) => i.status === 'ready' || (!base && i.status === 'not-in-base') || sharedReload(plan, i);
  // the pack the build writes into: "Reload & Rest" of an SP first, the template fills in a missing archive
  const withRest = (tmpl: Pack | null): Pack | null => rest ? openPack([...rest.pack.archives, ...(tmpl?.archives ?? []).filter((a) => !rest.pack.archives.some((r) => r.name.toLowerCase() === a.name.toLowerCase()))].map((a) => ({ name: a.name, bytes: a.bytes }))) : tmpl;
  const quickPack = useMemo(() => withRest(base?.pack ?? null), [rest, base]);

  // "So klingt es im Spiel": the sound exactly as it is written into the game file (1 : 1, mono) – worked out ahead,
  // so "passt nicht in die Vorlage" shows before "Soundpack erstellen"
  const [inGame, setInGame] = useState<{ key: string; info: InGameSound } | null>(null);
  const gameItem = (p: BuildPlan): PlanItem | undefined => cur
    ? p.items.find((i) => i.weapon === cur && i.slot === 'fire')
    : step === RELOAD_STEP ? p.items.find((i) => RELOAD_SLOTS.includes(i.slot as typeof RELOAD_SLOTS[number]) && i.status === 'ready' && i.assignment.entryId !== SILENCE) : undefined;
  const gameKey = (i: PlanItem) => `ingame:${i.weapon}:${i.slot}:${i.assignment.entryId}`;
  useEffect(() => {
    setInGame(null);
    if (!quickPack) return;
    const p = planBuild(project(), WEAPON_PROFILES, loadMapping(), quickPack), it = gameItem(p);
    if (!it) return;
    let live = true;
    void inGameAudio(p, quickPack, it, renderAssignment).then((info) => { if (live && info) setInGame({ key: gameKey(it), info }); }).catch((e) => logger.warn(`Im-Spiel-Vorschau: ${e instanceof Error ? e.message : String(e)}`));
    return () => { live = false; };
  }, [fire, reload, quickPack, mapRev, step]);
  const playInGame = async () => {
    if (inGame && engine.playingKey === inGame.key) { engine.stop(); return; }
    engine.unlock();
    try {
      let info = inGame;
      if (!info) {
        // no template known yet: find one like "Soundpack erstellen" does
        const pack = withRest((await ensureBase((s) => setBusy(s))) ?? null);
        setBusy(null);
        if (!pack) { setNeedBase(true); toast('warning', 'Keine Vorlage gefunden', 'Zieh einmal irgendein Waffen-Soundpack (ZIP oder .rpf) in das Feld – dann geht die Vorschau.'); return; }
        const p = planBuild(project(), WEAPON_PROFILES, loadMapping(), pack), it = gameItem(p);
        const got = it ? await inGameAudio(p, pack, it, renderAssignment) : null;
        if (!it || !got) { toast('info', 'Kommt so nicht ins Spiel', 'Dieser Sound wird noch nicht ins Spiel geschrieben (siehe Hinweis darunter).'); return; }
        info = { key: gameKey(it), info: got };
        setInGame(info);
      }
      engine.setVolume(getState().settings.volume);
      engine.play(info.info.audio, { key: info.key });
    } catch (e) {
      setBusy(null);
      toast('error', 'Vorschau ging nicht', e instanceof Error ? e.message : String(e));
    }
  };
  const num = (x: number) => x.toFixed(1).replace(".", ",");
  // "Original": the sound that sits in the template at that place now – to compare with yours
  const playOriginal = () => {
    const key = 'ingame:original';
    if (engine.playingKey === key) { engine.stop(); return; }
    engine.unlock();
    if (!quickPack) { toast('info', 'Noch keine Vorlage', 'Hör zuerst „So klingt es im Spiel“ an – dabei wird die Vorlage gesucht.'); return; }
    const it = gameItem(planBuild(project(), WEAPON_PROFILES, loadMapping(), quickPack));
    const t = it?.status === 'ready' ? it.targets[0] : undefined;
    const st = t && quickPack.groups[t.group].awc.streams.find((x) => x.id === t.stream);
    if (!st) { toast('info', 'Kein Original zum Vergleich', 'Diesen Sound gibt es in deiner Vorlage nicht.'); return; }
    engine.setVolume(getState().settings.volume);
    engine.play(streamToAudio(st), { key });
  };
  // the archive cannot grow – another soundpack on this PC whose creator used longer sounds gives more room
  const findRoom = async () => {
    try {
      const label = await moreRoomBase((s) => setBusy(s));
      if (label) toast('success', `Neue Vorlage: „${label}“`, 'Hat mehr Platz für lange Sounds. Waffen, die du nicht änderst, klingen jetzt wie in diesem Soundpack.');
      else toast('info', 'Keine Vorlage mit mehr Platz gefunden', 'Zieh ein Soundpack mit längeren Schüssen in das Vorlagen-Feld unter „Fertig“.');
    } catch (e) { toast('error', 'Suche fehlgeschlagen', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const inGameHint = (
    <div className="create-ingame">
      <Button size="sm" icon={playing && inGame && playing === inGame.key ? 'stop' : 'gamepad'} disabled={!!busy} onClick={() => void playInGame()}>So klingt es im Spiel</Button>
      <Button size="sm" variant="ghost" icon={playing === 'ingame:original' ? 'stop' : 'play'} disabled={!!busy || !quickPack} title="Der Sound, der jetzt an dieser Stelle in deiner Vorlage steckt" onClick={playOriginal}>Original</Button>
      <span className="small muted grow">1 : 1 wie deine Datei – Länge, Abtastrate und Lautstärke bleiben, nur Mono wie im Spiel.</span>
      {needBase && !quickPack && <div style={{ width: '100%' }}><div className="qp-label">Einmalig: ein Soundpack als Vorlage</div><BasePicker autoSearch={false} /></div>}
      {inGame && (!inGame.info.fits || inGame.info.monoLossDb < -6) && (
        <div className="callout small" style={{ width: '100%', marginTop: 8 }}><Icon name="alert" size={16} /><div>
          {!inGame.info.fits && <div><b>Passt nicht in die Vorlage: {num(inGame.info.overSeconds)} s zu lang</b> (dein Sound: {num(inGame.info.sourceSeconds)} s). SP Tool kürzt nichts selbst – kürze den Sound im Editor oder nimm eine Vorlage mit mehr Platz.</div>}
          {!inGame.info.fits && native && !rest && <div style={{ marginTop: 6 }}><Button size="sm" icon="search" disabled={!!busy} onClick={() => void findRoom()}>{busy ?? 'Vorlage mit mehr Platz suchen'}</Button></div>}
          {inGame.info.monoLossDb < -6 && <div><b>Klingt im Spiel dünner:</b> GTA spielt den Sound in Mono, dabei löschen sich Teile des Stereo-Sounds aus ({inGame.info.monoLossDb.toFixed(0)} dB).</div>}
        </div></div>
      )}
    </div>
  );

  const copyReport = async () => {
    if (!done) return;
    setBusy('Bericht wird erstellt…');
    try {
      const text = await soundReport(done.plan, done.pack, renderAssignment, { name: done.folder, template: done.template, soundName: (id) => entryById(id)?.name ?? id });
      logger.info(`Bericht „Klingt im Spiel anders“:\n${text}`);
      try { await navigator.clipboard.writeText(text); toast('success', 'Bericht kopiert', 'Füg ihn im Discord beim SP-Tool-Team ein (Strg + V) und schreib dazu, was im Spiel anders klingt.'); }
      catch { toast('warning', 'Kopieren ging nicht', 'Der Bericht steht im Protokoll (Experten-Ansicht: Einfache Ansicht in den Einstellungen ausschalten).'); }
    } catch (e) { toast('error', 'Bericht ging nicht', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const create = async () => {
    setBusy('Vorlage wird vorbereitet…'); setProg(null);
    try {
      // "Reload & Rest" of another SP: its archives are the base of this build (the whole SP, untouched), the
      // current template only fills in an archive that SP does not have
      // the template is checked every time: a template without RESIDENT.rpf is completed from another pack on the PC
      const pack = withRest((await ensureBase((s) => setBusy(s))) ?? base?.pack ?? null);
      if (!pack) { setNeedBase(true); toast('warning', 'Keine Vorlage gefunden', 'Zieh einmal irgendein Waffen-Soundpack (ZIP oder .rpf) in das Feld – danach geht es automatisch.'); return; }
      setNeedBase(false);
      const p = project();
      const pl = planBuild(p, WEAPON_PROFILES, loadMapping(), pack);
      // "Reload & Rest" of an SP: without one writable own sound the result would be that SP again – say so instead
      if (rest) { const msg = nothingChangesMessage(pl, rest.label); if (msg) throw new Error(msg); }
      if (!pl.ready && !rest) throw new Error(pl.items.some((i) => i.status === 'not-in-base') ? 'In deiner Vorlage fehlen die Dateien für deine Auswahl – nimm ein Soundpack mit WEAPONS_PLAYER.rpf und RESIDENT.rpf.' : `Deine Auswahl wirkt im Spiel noch nicht: SP Tool weiß noch nicht, wo GTA ${blockedLabels(pl).join(', ')} ablegt. Wähl bei der Pistol einen Schuss oder mach den Test im Spiel.`);
      addProject(p, false);
      const r = await runBuild(pl, pack, renderAssignment, (d, t, l) => { setBusy(d < t ? `Sound ${d + 1} von ${t} · ${l}` : 'WEAPONS_PLAYER.rpf und RESIDENT.rpf werden geschrieben…'); setProg(d < t ? d / t : null); }, { allowEmpty: !!rest, allArchives: true }); // always WEAPONS_PLAYER.rpf + RESIDENT.rpf
      if (sameAsBase(pack, r.outputs)) throw new Error(`Es hat sich nichts geändert – das Ergebnis wäre genau ${rest ? `„${rest.label}“` : 'deine Vorlage'}. ${blockedLabels(pl).length ? `${blockedLabels(pl).join(', ')} kann SP Tool noch nicht ins Spiel schreiben.` : 'Prüf, ob deine Sounds wirklich anders sind als die im Pack.'}`);
      const missing = ['WEAPONS_PLAYER.rpf', 'RESIDENT.rpf'].filter((n) => !r.outputs.some((o) => o.name.toLowerCase() === n.toLowerCase()));
      if (missing.length) { toast('warning', `${missing.join(' und ')} fehlt`, `Deine Vorlage enthält ${missing.join(' und ')} nicht, deshalb ist nur ${r.outputs.map((o) => o.name).join(' und ')} entstanden. Zieh beim nächsten Erstellen ein komplettes Soundpack (mit WEAPONS_PLAYER.rpf und RESIDENT.rpf) als Vorlage rein.`); setNeedBase(true); }
      setBusy('Wird in deinen Downloads gespeichert…'); setProg(null);
      const saved = await saveToDownloads(p.name, r.outputs.map((o) => ({ name: o.name, bytes: o.bytes })));
      logger.info(`Soundpack erstellt: ${p.name} – ${r.replacedStreams} Sounds → ${saved.names.join(', ')}`);
      const built = await Promise.all(r.outputs.map(async (o) => ({ name: o.name, sha256: await sha256Hex(o.bytes) })));
      setCheck(null);
      setDone({ ...saved, folder: p.name, plan: pl, built, pack, template: rest ? `Reload & Rest von „${rest.label}“` : baseInfo()?.label ?? 'unbekannt' });
    } catch (e) {
      toast('error', 'Das hat nicht geklappt', e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProg(null); }
  };

  const importForWeapon = async (files: File[]) => {
    if (!cur) return;
    setBusy('Sounds werden erkannt…');
    const r = await importSorted(files, cur);
    setBusy(null);
    setRecog(r.files);
    if (r.shots[0]) { pickFire(cur, r.shots[0].id); void previewEntry(r.shots[0]); }
    const rel = Object.fromEntries(Object.entries(r.reload).map(([k, e]) => [k, e.id]));
    if (Object.keys(rel).length) setReload((x) => ({ ...x, mode: 'single', single: { ...x.single, ...rel } }));
    const parts = [r.shots.length ? `${r.shots.length} Schuss${r.shots.length > 1 ? '-Sounds' : ''}${r.shots[0] ? ` → ${label(cur)}` : ''}` : '', Object.keys(rel).length ? `${Object.keys(rel).length} Nachlade-Teil${Object.keys(rel).length > 1 ? 'e' : ''} (${Object.keys(rel).map((k) => RELOAD_LABEL[k]).join(', ')}) → Schritt „Nachladen“` : ''].filter(Boolean);
    if (parts.length) toast('success', 'Erkannt und einsortiert', parts.join(' · '));
  };
  // drops anywhere on the page (see FILES_DROPPED): weapon step → import, reload step → whole reload
  dropRef.current = (files) => {
    const audio = files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'));
    if (!audio.length || busy) return false;
    if (cur) { void importForWeapon(audio); return true; }
    if (step === RELOAD_STEP) {
      lastReload.current = audio[0];
      setReload((r) => ({ ...r, mode: 'whole' }));
      void importReload(audio[0], reload.split);
      return true;
    }
    return false;
  };

  // the sounds a file was first sorted into go away when it is turned around (unless a saved soundpack uses them)
  const dropEntries = (ids: string[]) => {
    const inUse = new Set(getState().projects.flatMap(usedEntryIds));
    for (const id of ids) {
      const e = getState().userEntries.find((x) => x.id === id);
      if (!e || inUse.has(id)) continue;
      if (e.blobKey) void deleteBlob(e.blobKey);
      removeUserEntry(id);
    }
  };
  const flip = async (i: number) => {
    const f = recog[i];
    if (!f || !cur) return;
    const base = f.name.replace(/\.[^.]+$/, '');
    if (f.as === 'shot') {
      if (f.ids.includes(fire[cur] ?? '')) pickFire(cur, null);
      dropEntries(f.ids);
      const taken = Object.keys(reload.single).filter((k) => reload.single[k]);
      const got = await reloadPartsOf(f.audio, base, taken, `Importierte Datei ${f.name} (von dir als Nachladen markiert)`);
      const ids = Object.fromEntries(Object.entries(got).map(([k, e]) => [k, e.id]));
      setReload((x) => ({ ...x, mode: 'single', single: { ...x.single, ...ids } }));
      setRecog((r) => r.map((x, j) => (j === i ? { ...x, as: 'reload', ids: Object.values(ids) } : x)));
      reportDetection(f.audio, 'reload', 'import');
      toast('success', 'Geändert: Nachladen', `${Object.keys(ids).map((k) => RELOAD_LABEL[k]).join(', ')} → Schritt „Nachladen“`);
    } else {
      setReload((x) => {
        const single = Object.fromEntries(Object.entries(x.single).filter(([, v]) => !f.ids.includes(v ?? '')));
        return { ...x, single, mode: x.mode === 'single' && !Object.values(single).some(Boolean) ? 'whole' : x.mode };
      });
      dropEntries(f.ids);
      const e = await addAudioEntry(f.audio, base, { weapon: cur, slot: 'fire' }, `Importierte Datei ${f.name} (von dir als Schuss markiert)`);
      pickFire(cur, e.id);
      setRecog((r) => r.map((x, j) => (j === i ? { ...x, as: 'shot', ids: [e.id] } : x)));
      reportDetection(f.audio, 'shot', 'import');
      toast('success', `Geändert: Schuss für die ${label(cur)}`);
    }
  };

  const stepOk = (i: number) => i < WEAPONS.length ? !!fire[WEAPONS[i]] : true;
  const reachable = (i: number) => Array.from({ length: i }, (_, k) => k).every(stepOk);
  const fireLib = (w: WeaponId) => { const all = featuredFirst(entriesFor(lib, w, 'fire').filter((e) => e.source !== 'imported')); const s = style === 'all' ? all : style === 'featured' ? all.filter((e) => e.featured) : all.filter((e) => e.style === style); return s.length ? s : all; };
  const imported = (w: WeaponId) => entriesFor(lib, w, 'fire').filter((e) => e.source === 'imported' && !e.hidden);
  // clears the whole import list of this weapon; whatever pointed at one goes back to "nothing chosen".
  // A sound a saved soundpack still uses only leaves the list (deleting it would break that pack), the rest is deleted.
  const clearImported = (w: WeaponId) => {
    const inUse = new Set(getState().projects.flatMap(usedEntryIds));
    const all = imported(w);
    if (!all.length) return;
    engine.stop();
    const ids = new Set(all.map((e) => e.id));
    for (const e of all) if (!inUse.has(e.id)) { if (e.blobKey) void deleteBlob(e.blobKey); removeUserEntry(e.id); }
    setState((s) => ({ userEntries: s.userEntries.map((e) => (ids.has(e.id) && inUse.has(e.id) ? { ...e, hidden: true } : e)) }));
    setFire((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v && ids.has(v) ? null : v])));
    setRecog((r) => r.filter((x) => !x.ids.some((id) => ids.has(id))));
    setConfirmClear(false);
    toast('info', `${all.length} importierte${all.length > 1 ? ' Sounds' : 'r Sound'} gelöscht`, `Schuss für die ${label(w)}`);
  };
  const nameOf = (id: string | null | undefined) => id === SILENCE ? 'stumm (steckt im ganzen Reload)' : (id ? lib.find((e) => e.id === id)?.name : null) ?? '–';

  if (done) {
    const kept = blockedLabels(done.plan);
    const works = [...new Set(done.plan.items.filter((i) => i.status === 'ready' && i.assignment.entryId !== SILENCE).map((i) => `${i.weaponLabel} · ${i.slotLabel}`))];
    const fmt = (t: number) => new Date(t).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const stateText = (n: string, st: FileState) => {
      switch (st.kind) {
        case 'ok': return <><b>{n}</b> ist deine neue Datei – passt.</>;
        case 'old': return <><b>{n}</b> im sfx-Ordner ist noch die <b>alte</b> (vom {fmt(st.modified)}). Ersetz sie durch die aus der ZIP.</>;
        case 'subfolder': return <><b>{n}</b> liegt in <span className="mono">sfx\{st.path}</span> – in Unterordnern liest GTA sie nicht{st.old ? ', deshalb spielt es weiter die alte direkt in sfx' : ''}. Schieb sie direkt in den sfx-Ordner.</>;
        case 'renamed': return <><b>{n}</b> heißt im sfx-Ordner <span className="mono">{st.path}</span> – GTA lädt nur genau <b>{n}</b>. Alte Datei löschen und deine umbenennen.</>;
        case 'missing': return <><b>{n}</b> fehlt im sfx-Ordner.</>;
      }
    };
    return (
      <div className="page create-page">
        <div className="panel create-done">
          <DoneMark />
          <h2>{done.folder} ist fertig!</h2>
          <p className="muted"><b>{done.zip}</b> liegt {done.dir ? <>in <b>Downloads › SP Tool</b></> : 'in deinem Download-Ordner'} ({done.names.join(' + ')}). Nichts wurde automatisch installiert.</p>
          <p className="small muted">Vorlage: <b>{done.template}</b> – Waffen und Sounds, die du nicht geändert hast, klingen wie in diesem Soundpack.</p>
          <div className="callout info small" style={{ textAlign: 'left' }}><Icon name="info" size={16} /><div>
            <b>So kommt es ins Spiel:</b>
            <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li><b>FiveM bzw. GTA komplett schließen</b> – die Sounds werden nur beim Start gelesen.</li>
              <li>ZIP öffnen und <b>{done.names.join(' + ')}</b> <b>direkt</b> in deinen <b>sfx</b>-Ordner ziehen (<span className="mono">Grand Theft Auto V\x64\audio\sfx</span>) und <b>„Dateien im Ziel ersetzen“</b> wählen. Sichere vorher einmal die Originaldateien von GTA.</li>
              <li>Klick auf <b>„Prüfen“</b> – SP Tool sagt dir, ob wirklich dein neues Pack drinliegt. Dann FiveM starten.</li>
            </ol>
          </div></div>
          {works.length > 0 && <div className="callout info small" style={{ textAlign: 'left' }}><Icon name="check" size={16} /><div><b>Wirkt im Spiel: {works.join(', ')}.</b></div></div>}
          {!done.names.some((n) => n.toLowerCase() === 'resident.rpf') && <div className="callout small" style={{ textAlign: 'left' }}><Icon name="alert" size={16} /><div><b>RESIDENT.rpf fehlt.</b> Deine Vorlage hat keine RESIDENT.rpf, deshalb ist nur WEAPONS_PLAYER.rpf entstanden. Zieh unter „Noch eins erstellen“ → „Soundpack erstellen“ ein komplettes Soundpack (ZIP oder WEAPONS_PLAYER.rpf + RESIDENT.rpf) als Vorlage rein und erstelle es noch einmal.</div></div>}
          {kept.length > 0 && <div className="callout small" style={{ textAlign: 'left' }}><Icon name="alert" size={16} /><div className="grow"><b>Noch ohne Wirkung: {kept.join(', ')}.</b> Diese Sounds bleiben im Spiel wie in der Vorlage, bis SP Tool weiß, wo GTA sie ablegt. Mit dem <b>Test im Spiel</b> findest du das in zwei Minuten heraus – danach einfach neu erstellen.</div><Button size="sm" icon="gamepad" onClick={openGameTest}>Im Spiel testen</Button></div>}
          {check && (
            <div className={`callout small ${check.allOk && !check.running ? 'info' : 'danger'}`} style={{ textAlign: 'left' }}>
              <Icon name={check.allOk ? 'check' : 'alert'} size={16} />
              <div className="grow">
                <b>{check.allOk ? 'Dein neues Pack liegt richtig im sfx-Ordner.' : 'Im Spiel ist noch nicht dein neues Pack:'}</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {check.files.map((f) => <li key={f.name}>{stateText(f.name, f.state)}</li>)}
                  {check.running && <li><b>FiveM läuft gerade.</b> Komplett schließen und neu starten – sonst hörst du weiter das alte Pack.</li>}
                </ul>
                <div className="faint mono" style={{ marginTop: 4 }}>{check.modsDir}</div>
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            {done.dir && <Button variant="primary" icon="folder" onClick={() => void showDownloads()}>ZIP zeigen</Button>}
            {done.dir && <Button icon="folder" onClick={() => void showSfxFolder().then((ok) => { if (!ok) toast('error', 'sfx-Ordner nicht gefunden', 'Trag den GTA-V-Ordner unter Einstellungen ein.'); })}>sfx-Ordner öffnen</Button>}
            {done.dir && <Button icon="search" disabled={checking} onClick={() => void runCheck()}>{checking ? 'Prüft…' : 'Prüfen'}</Button>}
            <Button icon="copy" disabled={!!busy} title="Kopiert einen Bericht, was genau ins Spiel geschrieben wurde – zum Weiterschicken ans SP-Tool-Team" onClick={() => void copyReport()}>Klingt im Spiel anders?</Button>
            <Button icon="plus" onClick={() => { setDone(null); setCheck(null); setStep(0); }}>Noch eins erstellen</Button>
          </div>
        </div>
      </div>
    );
  }

  const fireStatus = (w: WeaponId) => plan.items.find((i) => i.weapon === w && i.slot === 'fire');
  return (
    <div className="page create-page">
      <div className="create-head">
        <h1>Soundpack erstellen</h1>
        <Button size="sm" icon="gamepad" onClick={openGameTest}>Test im Spiel</Button>
        <ol className="create-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step && stepOk(i) ? 'done' : ''}>
              <button disabled={!!busy || !reachable(i)} onClick={() => setStep(i)}><span>{i < step && stepOk(i) ? <Icon name="check" size={13} /> : i + 1}</span>{s}</button>
            </li>
          ))}
        </ol>
      </div>

      {cur && (
        <div className="panel"><div className="panel-body">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <h3 className="grow" style={{ margin: 0 }}>Schuss für die {label(cur)}</h3>
            <span className="small muted">Gewählt: <b>{fire[cur] === ORIGINAL ? 'Original' : nameOf(fire[cur])}</b></span>
          </div>
          <div className="create-sources">
            <AudioDrop multiple title="Eigene Sounds importieren" hint="MP3, WAV, OGG, M4A, FLAC … reinziehen oder klicken – auch mehrere. SP Tool erkennt selbst, was Schuss und was Nachladen ist." onFiles={importForWeapon} />
            <button className="create-source" onClick={() => setPackOpen(true)}>
              <Icon name="box" size={22} />
              <div><b>Aus einem Soundpack holen</b><div className="small muted">Pack reinziehen – SP Tool zieht die Schüsse und Nachlade-Sounds raus.</div></div>
            </button>
          </div>
          {recog.length > 0 && (
            <div className="create-recog">
              <span className="small muted">Erkannt – stimmt etwas nicht? Einfach umstellen:</span>
              {recog.map((f, i) => (
                <div key={`${f.name}:${i}`} className="row create-recog-row">
                  <span className="grow ellipsis small">{f.name}</span>
                  <span className={`chip ${f.as === 'shot' ? 'accent' : ''}`}>{f.as === 'shot' ? 'Schuss' : 'Nachladen'}</span>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void flip(i)}>{f.as === 'shot' ? 'Ist Nachladen' : 'Ist ein Schuss'}</Button>
                </div>
              ))}
            </div>
          )}
          <div className="create-list">
            <div className={`create-item original${fire[cur] === ORIGINAL ? ' sel' : ''}`} onClick={() => { engine.stop(); pickFire(cur, ORIGINAL); }}>
              <span className="play-btn ghost"><Icon name="undo" size={12} /></span>
              <span className="grow"><b>Original behalten</b> <span className="faint small">– kein neuer Schuss, im Spiel bleibt der GTA-Sound</span></span>
              {fire[cur] === ORIGINAL && <span className="chip ok"><Icon name="check" size={12} />gewählt</span>}
            </div>
            {imported(cur).map((e) => <SoundRow key={e.id} e={e} sel={fire[cur] === e.id} playing={playing} extra="importiert" onPick={() => { pickFire(cur, e.id); void previewEntry(e); }} />)}
          </div>
          {imported(cur).length > 0 && (
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              {confirmClear
                ? <>
                  <span className="small muted grow">Alle {imported(cur).length} importierten Sounds der {label(cur)} wirklich löschen?</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Abbrechen</Button>
                  <Button size="sm" icon="trash" disabled={!!busy} onClick={() => clearImported(cur)}>Ja, löschen</Button>
                </>
                : <Button size="sm" variant="ghost" icon="trash" disabled={!!busy} onClick={() => setConfirmClear(true)}>Alle importierten löschen</Button>}
            </div>
          )}
          {fireLib(cur).length > 0 && <button className="link-like small create-libtoggle" onClick={() => setShowLib((v) => !v)}><Icon name="library" size={13} /> {showLib ? 'Bibliothek ausblenden' : 'Oder einen deiner Sounds aus der Bibliothek nehmen'}</button>}
          {showLib && fireLib(cur).length > 0 && <>
            <div className="create-chips">
              {(['all', ...(lib.some((e) => e.featured) ? ['featured'] : []), ...new Set(entriesFor(lib, cur, 'fire').filter((e) => e.source !== 'imported').map((e) => e.style))] as Array<Style | 'all' | 'featured'>).map((s) => <button key={s} className={`chip${style === s ? ' accent' : ''}`} onClick={() => setStyle(s)}>{s === 'all' ? 'Alle' : s === 'featured' ? '★ Empfohlen' : s}</button>)}
            </div>
            <div className="create-list">
              {fireLib(cur).map((e) => <SoundRow key={e.id} e={e} sel={fire[cur] === e.id} playing={playing} extra={e.featured ? `★ ${e.style}` : e.style} onPick={() => { pickFire(cur, e.id); void previewEntry(e); }} />)}
            </div>
          </>}
          {fire[cur] && fire[cur] !== ORIGINAL && fireStatus(cur) && !ok(fireStatus(cur)!) && (
            fireStatus(cur)!.status === 'not-in-base'
              ? <div className="callout small" style={{ marginTop: 12 }}><Icon name="info" size={16} /><div>Deine Vorlage enthält den Schuss der {label(cur)} nicht. Nimm als Vorlage ein Soundpack, das die {label(cur)} auch ändert – dann wirkt dein Sound im Spiel.</div></div>
              : <div className="callout small" style={{ marginTop: 12 }}><Icon name="gamepad" size={16} /><div className="grow">Wird mit gespeichert, wirkt im Spiel aber erst, wenn SP Tool weiß, welcher GTA-Sound der Schuss der {label(cur)} ist. Das findest du mit dem <b>Test im Spiel</b> in zwei Minuten heraus (einmal schießen, Pieptöne zählen) – danach einfach neu erstellen.</div><Button size="sm" icon="gamepad" onClick={openGameTest}>Im Spiel testen</Button></div>
          )}
          {fire[cur] && fire[cur] !== ORIGINAL && inGameHint}
        </div></div>
      )}

      {step === RELOAD_STEP && (
        <div className="panel"><div className="panel-body">
          <h3 style={{ marginTop: 0 }}>Nachladen</h3>
          {rest && (
            <div className="ps-whole" style={{ marginTop: 0, marginBottom: 12 }}>
              <Icon name="layers" size={18} />
              <div className="grow"><b>Reload & Rest aus „{rest.label}“</b><div className="small muted">Alles außer deinem Pistol-Schuss kommt 1:1 aus diesem SP – auch der Reload, egal wo er im Pack liegt. Schüsse, die SP Tool noch nicht kennt, bleiben wie in diesem SP.</div></div>
              <Button size="sm" variant="ghost" icon="x" onClick={() => setRest(null)}>Entfernen</Button>
            </div>
          )}
          {!rest && <p className="small muted" style={{ marginTop: 0 }}>Tipp: Den Reload eines fertigen SP nimmst du am einfachsten mit „Aus einem Soundpack holen“ → <b>Reload & Rest übernehmen</b>.</p>}
          <div className="seg" style={{ marginBottom: 12 }}>
            <button className={reload.mode === 'whole' ? 'on' : ''} onClick={() => setReload((r) => ({ ...r, mode: 'whole' }))}>Ganzer Reload-Sound</button>
            <button className={reload.mode === 'single' ? 'on' : ''} onClick={() => setReload((r) => ({ ...r, mode: 'single' }))}>Einzelne Teile</button>
            <button className={reload.mode === 'none' ? 'on' : ''} onClick={() => setReload((r) => ({ ...r, mode: 'none' }))}>Original lassen</button>
          </div>

          {reload.mode === 'whole' && <>
            <div className="seg" style={{ marginBottom: 10 }} role="radiogroup" aria-label="Reload-Sound">
              <button role="radio" aria-checked={reload.split} className={reload.split ? 'on' : ''} onClick={() => { setReload((r) => ({ ...r, split: true })); if (lastReload.current && !reload.split) void importReload(lastReload.current, true); }}>In Teile schneiden</button>
              <button role="radio" aria-checked={!reload.split} className={!reload.split ? 'on' : ''} onClick={() => { setReload((r) => ({ ...r, split: false })); if (lastReload.current && reload.split) void importReload(lastReload.current, false); }}>Als Ganzes einfügen</button>
            </div>
            <div className="create-sources">
              <AudioDrop title="Ganzen Reload-Sound importieren" hint={reload.split ? 'Eine Datei mit dem kompletten Nachladen – SP Tool schneidet sie in Magazin raus, Magazin rein, Schlitten und Fertig.' : 'Eine Datei mit dem kompletten Nachladen – sie läuft als EIN Sound, sobald nachgeladen wird.'} onFiles={async (files) => {
                if (!files[0]) return;
                lastReload.current = files[0];
                await importReload(files[0], reload.split);
              }} />
              <button className="create-source" onClick={() => setPackOpen(true)}>
                <Icon name="box" size={22} />
                <div><b>Aus einem Soundpack holen</b><div className="small muted">Nachlade-Sounds eines Packs anhören und übernehmen.</div></div>
              </button>
            </div>
            {reload.whole && !reload.split && (
              <div className="create-parts">
                <div className="create-part grow"><span className="small muted">Ganzer Reload (ein Sound)</span><span>{nameOf(reload.whole.mag_out)}</span></div>
                <Button size="sm" variant="ghost" icon="play" onClick={() => { const e = lib.find((x) => x.id === reload.whole?.mag_out); if (e) void previewEntry(e); }}>Anhören</Button>
              </div>
            )}
            {reload.whole && reload.split && (
              <div className="create-parts">
                {RELOAD_SLOTS.map((s) => (
                  <div key={s} className="create-part">
                    <span className="small muted">{RELOAD_LABEL[s]}</span>
                    {reload.whole![s] ? <button className="link-like small" onClick={() => { const e = lib.find((x) => x.id === reload.whole![s]); if (e) void previewEntry(e); }}><Icon name="play" size={11} /> {nameOf(reload.whole![s])}</button> : <span className="faint small">– (Original)</span>}
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon="play" onClick={() => void playSequence(RELOAD_SLOTS.map((k) => reload.whole?.[k] ?? ''))}>Alles anhören</Button>
              </div>
            )}
            <div className="qp-label" style={{ marginTop: 14 }}>Oder ein freier Reload-Sound (CC0, aus dem Internet)</div>
            <div className="create-list compact">
              {freeReloads().map((e) => {
                const sel = !reload.split && reload.whole?.mag_out === e.id;
                return <SoundRow key={e.id} e={e} sel={sel} playing={playing} extra={`von ${e.creator}`} onPick={() => { setReload((r) => ({ ...r, split: false, whole: { mag_out: e.id, mag_in: SILENCE, slide: SILENCE, reload_finish: SILENCE } })); void previewEntry(e); }} />;
              })}
            </div>
          </>}

          {reload.mode === 'single' && (
            <button className="create-source" style={{ width: '100%', marginBottom: 6 }} onClick={() => setPackOpen(true)}>
              <Icon name="box" size={22} />
              <div><b>Aus einem Soundpack holen</b><div className="small muted">Mechanik-Sounds eines Packs anhören und als einzelne Teile übernehmen.</div></div>
            </button>
          )}
          {reload.mode === 'single' && RELOAD_SLOTS.map((slot) => (
            <div key={slot} className="create-slot">
              <div className="row" style={{ gap: 8 }}><b className="grow">{RELOAD_LABEL[slot]}</b><span className="small muted">{reload.single[slot] ? nameOf(reload.single[slot]) : 'Original'}</span></div>
              <AudioDrop title={`${RELOAD_LABEL[slot]} importieren`} hint="Audiodatei reinziehen oder klicken." onFiles={async (files) => {
                const es = await importAudioFiles(files.slice(0, 1), { weapon: 'universal', slot });
                if (es[0]) { setReload((r) => ({ ...r, single: { ...r.single, [slot]: es[0].id } })); void previewEntry(es[0]); }
              }} />
              <div className="create-list compact">
                {entriesFor(lib, 'pistol', slot).filter((e) => e.source !== 'builtin').map((e) => {
                  const sel = reload.single[slot] === e.id;
                  return <SoundRow key={e.id} e={e} sel={sel} playing={playing} extra={e.source === 'imported' ? 'importiert' : undefined} onPick={() => { setReload((r) => ({ ...r, single: { ...r.single, [slot]: sel ? null : e.id } })); if (!sel) void previewEntry(e); }} />;
                })}
              </div>
            </div>
          ))}

          {reload.mode !== 'none' && <>
            <div className="qp-label" style={{ marginTop: 14 }}>Für welche Waffen?</div>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {WEAPONS.map((w) => (
                <label key={w} className="row small" style={{ gap: 6 }}>
                  <input type="checkbox" checked={reload.weapons.includes(w)} onChange={(e) => setReload((r) => ({ ...r, weapons: e.target.checked ? [...r.weapons, w] : r.weapons.filter((x) => x !== w) }))} />{label(w)}
                </label>
              ))}
            </div>
            {Object.keys(reloadIds()).length > 0 && plan.items.some((i) => RELOAD_SLOTS.includes(i.slot as typeof RELOAD_SLOTS[number]) && i.assignment.entryId !== SILENCE && !ok(i)) && (
              <div className="callout small" style={{ marginTop: 12 }}><Icon name="info" size={16} /><div className="grow">{reload.mode === 'whole' && reload.split && <><b>Im Spiel wirkt davon bisher nur „Magazin raus“</b> – für die anderen Teile bleibt der GTA-Sound. Mit „Als Ganzes einfügen“ kommt der ganze Reload rein. </>}Wird mit gespeichert, wirkt im Spiel aber erst, wenn SP Tool weiß, wo GTA die Nachlade-Sounds ablegt. Das findest du mit dem <b>Test im Spiel</b> in ein paar Minuten heraus (einmal nachladen und die tiefen Pieptöne anklicken) – danach einfach neu erstellen.</div><Button size="sm" icon="gamepad" onClick={openGameTest}>Im Spiel testen</Button></div>
            )}
            {Object.values(reloadIds()).some((v) => v && v !== SILENCE) && inGameHint}
          </>}
        </div></div>
      )}

      {step === DONE_STEP && (
        <div className="panel"><div className="panel-body">
          <h3 style={{ marginTop: 0 }}>Fertig machen</h3>
          <label className="field"><span className="small muted">Name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <div className="create-summary">
            {WEAPONS.map((w) => (
              <div key={w} className="cs-weapon">
                <b>{label(w)}</b>
                {fire[w] === ORIGINAL && <div className="cs-row muted"><Icon name="undo" size={13} /><span className="grow">Schuss: {rest ? `wie in „${rest.label}“` : 'Original'}</span></div>}
                {plan.items.filter((i) => i.weapon === w && !(i.assignment.entryId === SILENCE && !ok(i))).map((i) => (
                  <div key={i.slot} className={`cs-row ${ok(i) ? '' : 'muted'}`}>
                    <Icon name={ok(i) ? 'check' : 'lock'} size={13} />
                    <span className="grow">{i.slotLabel}: {nameOf(i.assignment.entryId)}</span>
                    {!ok(i) && <span className="faint small">noch ohne Wirkung</span>}
                  </div>
                ))}
                {(reload.mode === 'none' || !reload.weapons.includes(w)) && <div className="cs-row muted"><Icon name="undo" size={13} /><span className="grow">Nachladen: Original</span></div>}
              </div>
            ))}
          </div>
          {rest && <div className="cs-row" style={{ marginBottom: 8 }}><Icon name="layers" size={13} /><span className="grow">Reload & Rest: 1:1 aus „{rest.label}“</span></div>}
          {!plan.items.length && !rest && <div className="callout small"><Icon name="info" size={16} /><div>Alles steht auf „Original“ – es gibt nichts zu erstellen. Wähl bei mindestens einer Waffe einen Schuss.</div></div>}
          {plan.items.length > 0 && !rest && !plan.items.some(ok) && <div className="callout small"><Icon name="info" size={16} /><div className="grow">Deine Auswahl wirkt im Spiel noch nicht: SP Tool weiß noch nicht, wo GTA {blockedLabels(plan).join(', ')} ablegt. Wähl bei der Pistol einen Schuss oder finde es mit dem <b>Test im Spiel</b> heraus.</div><Button size="sm" icon="gamepad" onClick={openGameTest}>Im Spiel testen</Button></div>}
          {rest && nothingChangesMessage(plan, rest.label) && <div className="callout warning small"><Icon name="alert" size={16} /><div><b>So käme genau „{rest.label}“ wieder heraus.</b> {nothingChangesMessage(plan, rest.label)}</div></div>}
          {rest && !nothingChangesMessage(plan, rest.label) && blockedLabels(plan).length > 0 && <div className="callout warning small"><Icon name="alert" size={16} /><div><b>Noch ohne Wirkung: {blockedLabels(plan).join(', ')}.</b> Diese Sounds bleiben wie in „{rest.label}“, bis SP Tool weiß, wo GTA sie ablegt. Mit dem <b>Test im Spiel</b> findest du das heraus – danach einfach neu erstellen.</div></div>}
          {needBase && <><div className="qp-label">Einmalig: ein Soundpack als Vorlage</div><BasePicker /></>}
          <p className="small muted" style={{ marginBottom: 0 }}><Icon name="download" size={13} /> {native
            ? <>Kommt als <b>eine ZIP-Datei</b> (WEAPONS_PLAYER.rpf + RESIDENT.rpf) in <b>Downloads › SP Tool</b>.</>
            : <>Kommt als <b>eine ZIP-Datei</b> (WEAPONS_PLAYER.rpf + RESIDENT.rpf) in deinen Download-Ordner – am PC entpacken.</>} Nichts wird in FiveM oder GTA installiert, es werden keine Backups angelegt.</p>
          {busy && <div style={{ marginTop: 12 }}><div className="small"><span className="spinner" /> {busy}</div><Progress value={prog} label={busy} /></div>}
        </div></div>
      )}
      {busy && step !== DONE_STEP && <div className="small muted" style={{ marginTop: 8 }}><span className="spinner" /> {busy}</div>}

      <div className="row create-nav">
        {step > 0 && <Button variant="ghost" disabled={!!busy} onClick={() => setStep(step - 1)}>Zurück</Button>}
        <span className="grow" />
        {cur && !fire[cur] && <span className="small muted">Sound wählen oder „Original behalten“.</span>}
        {step < DONE_STEP ? <Button variant="primary" disabled={!stepOk(step) || !!busy} onClick={() => setStep(step + 1)}>Weiter</Button>
          : <Button variant="primary" size="lg" icon="hammer" disabled={!!busy || (!plan.items.length && !rest) || (!!rest && !!nothingChangesMessage(plan, rest.label))} onClick={() => void create()}>{busy ? 'Wird erstellt…' : 'Soundpack erstellen'}</Button>}
      </div>

      <PackSoundsDialog open={packOpen} onClose={() => setPackOpen(false)} onTakeRest={(t) => setRest(t)} hasReload={Object.keys(reloadIds()).length > 0} context={cur ? { weapon: cur, slot: 'fire' } : step === RELOAD_STEP ? { weapon: 'pistol', slot: 'reload' } : undefined}
        onUse={(t, e) => {
          if (t.slot === 'fire' && t.weapon !== 'reload') { pickFire(t.weapon, e.id); return; }
          if (t.slot === 'whole') {
            // the whole reload as ONE sound (starts with the reload); the other parts are made silent
            void (async () => {
              // muted parts shrink to a few milliseconds in the pack, so the whole reload keeps its full length
              const ids: Record<string, string> = { mag_out: e.id, mag_in: SILENCE, slide: SILENCE, reload_finish: SILENCE };
              setReload((r) => ({ ...r, mode: 'whole', split: false, whole: ids }));
            })();
            return;
          }
          // a part from a pack: into the cut-up whole reload if that is what is shown, otherwise into the single parts
          setReload((r) => r.mode === 'whole' && r.split
            ? { ...r, whole: { ...(r.whole ?? {}), [t.slot]: e.id } }
            : { ...r, mode: 'single', single: { ...r.single, [t.slot]: e.id } });
        }} />
    </div>
  );
}
