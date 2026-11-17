// "Sounds aus einem Soundpack holen": drop a soundpack (ZIP or WEAPONS_PLAYER.rpf / RESIDENT.rpf) – SP Tool pulls
// the weapon sounds out (Pistol shot etc. labelled, unknown ones to listen to), and each can go into the library
// or straight into the soundpack being made. The dropped pack also becomes the template if none is set up yet.
import { useEffect, useRef, useState } from 'react';
import { toast, useApp } from '../app/store';
import { engine } from '../audio/engine';
import { usePlayingKey } from '../audio/preview';
import type { Pack } from '../formats/pack';
import { addAudioEntry } from '../library/importAudio';
import type { LibraryEntry, WeaponId } from '../models/types';
import { adoptBase, baseFromUserFiles, openBase } from '../projects/basePack';
import { getBasePack } from '../projects/build';
import { extractPack, isWholeReload, pistolShotStreams, restCount, type Extracted } from '../projects/extractPack';
import { reportDetection } from '../services/detectionFeedback';
import type { Transplant } from '../projects/build';
import type { BaseFile } from '../projects/basePack';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { Icon } from './Icon';
import { Button, Modal } from './ui';

export interface SlotTarget { weapon: WeaponId; slot: string }
/** the game's reload slots – a sound from any of them becomes the whole reload */
const RELOAD_SLOTS = ['mag_out', 'mag_in', 'slide', 'reload_finish'];
const RELOAD_TARGET = 'reload:whole';

/** The kill sound is one sound for every weapon; the project keeps it on the Pistol. */
const KILL_TARGET = 'pistol:kill';
/** Target options: every pistol shot, the reload (one whole sound for all pistols) and the kill sound. */
const TARGETS: Array<{ value: string; label: string }> = [
  ...WEAPON_PROFILES.map((p) => ({ value: `${p.id}:fire`, label: `${p.displayName} · Schuss` })),
  { value: RELOAD_TARGET, label: 'Nachladen (ganzer Reload)' },
  { value: KILL_TARGET, label: 'Kill-Sound (alle Waffen)' },
];

export function PackSoundsDialog({ open, onClose, onUse, context, initialFiles, hasReload, onTakeRest }: {
  open: boolean; onClose: () => void;
  /** take over everything of this pack except the pistol shots (reload, echoes, other weapons …) */
  onTakeRest?: (t: Transplant) => void;
  /** the soundpack being made already has reload sounds → automatic taking leaves them alone on the weapon steps */
  hasReload?: boolean;
  /** files dropped somewhere else (e.g. on the library) – opened right away */
  initialFiles?: File[];
  /** put the sound into the soundpack being made ("reload" = for all pistols) */
  onUse?: (target: SlotTarget | { weapon: 'reload'; slot: string }, entry: LibraryEntry) => void;
  /** the weapon/slot the user is working on (default target for unknown shots) */
  context?: SlotTarget;
}) {
  const [pack, setPack] = useState<{ pack: Pack; label: string } | null>(null);
  const [list, setList] = useState<Extracted[] | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState<'shot' | 'mechanical' | 'all'>('all');
  const [auto, setAuto] = useState(true);
  const simple = useApp((st) => st.settings.simpleMode);
  const [all, setAll] = useState(false);
  const labelRef = useRef('Soundpack');
  const allRef = useRef(false);
  const filesRef = useRef<BaseFile[] | null>(null);
  const [shown, setShown] = useState(150);
  const fileRef = useRef<HTMLInputElement>(null);
  const playing = usePlayingKey();

  // kill step: the kill sound is none of the pistol sounds – show the whole pack right away (before anything loads)
  useEffect(() => {
    if (!open || context?.slot !== 'kill' || allRef.current) return;
    allRef.current = true; setAll(true);
    if (pack) load(pack.pack, pack.label);
  }, [open, context?.slot]);
  useEffect(() => {
    if (!open) { engine.stop(); return; }
    setDone({});
    if (initialFiles?.length) { void take(initialFiles); return; }
    // nothing dropped yet → start with the template pack, if there is one
    const b = getBasePack();
    if (!pack && b) { filesRef.current = null; load(b.pack, 'Deine Vorlage'); }
  }, [open]);

  // Where "Nehmen" puts a sound by default. In the soundpack steps every shot goes to the weapon of the current
  // step (whatever pistol it was in the imported pack) and a reload sound becomes the whole reload.
  const targetsFor = (ex: Extracted[]) => Object.fromEntries(ex.map((x) => {
    const isReload = !!x.slot && RELOAD_SLOTS.includes(x.slot);
    let t = '';
    // kill step: any sound of the pack can be the kill sound – "Nehmen" takes it straight away
    if (context?.slot === 'kill') t = KILL_TARGET;
    else if (context?.slot === 'fire') t = x.kind === 'shot' ? `${context.weapon}:fire` : '';
    else if (context?.slot === 'reload') t = x.kind === 'mechanical' || isReload ? RELOAD_TARGET : '';
    else if (x.weapon && x.slot) t = isReload ? RELOAD_TARGET : `${x.weapon}:${x.slot}`;
    return [x.key, t];
  }));
  // "Falsch erkannt": the user turns a candidate around – it is re-sorted and the correction helps the detection
  const flipKind = (x: Extracted) => {
    if (!list) return;
    const kind: Extracted['kind'] = x.kind === 'shot' ? 'mechanical' : 'shot';
    const next = list.map((y) => (y.key === x.key ? { ...y, kind, sure: true, whole: kind === 'mechanical' && isWholeReload(y.audio), label: kind === 'shot' ? `Schuss-Sound (von dir umgestellt)` : `Nachlade-Sound (von dir umgestellt)` } : y));
    setList(next);
    const t = targetsFor(next);
    setTarget((old) => ({ ...old, [x.key]: t[x.key] ?? '' }));
    reportDetection(x.audio, kind === 'shot' ? 'shot' : 'reload', 'pack');
  };
  const load = (p: Pack, label: string) => {
    const ex = extractPack(p, undefined, { all: allRef.current });
    setPack({ pack: p, label }); setList(ex); labelRef.current = label;
    setTarget(targetsFor(ex));
    return ex;
  };

  // "automatisch übernehmen": the shot goes to the current weapon (the pack's sound for that weapon if SP Tool
  // knows it, otherwise its Pistol shot, otherwise the first shot), and every sure reload sound goes into the
  // reload parts in order – the whole reload of the pack in one go.
  const autoTake = async (ex: Extracted[]) => {
    if (!onUse || !context) return;
    const got: string[] = [];
    if (context.slot === 'kill') {
      // only a kill sound SP Tool knows for sure (in-game search test) is taken by itself – nothing is guessed
      const known = ex.find((x) => x.slot === 'kill');
      if (known) { await save(known, true, KILL_TARGET); toast('success', 'Automatisch übernommen', 'Kill-Sound aus dem Soundpack'); }
      else toast('info', 'Kill-Sound noch unbekannt', 'SP Tool weiß noch nicht, wo GTA den Kill-Sound ablegt. Hör die Sounds des Packs an und klick beim richtigen auf „Nehmen“.');
      return;
    }
    if (context.slot === 'fire') {
      const shots = ex.filter((x) => x.kind === 'shot');
      const best = shots.find((x) => x.weapon === context.weapon && x.slot === 'fire') ?? shots.find((x) => x.weapon && x.slot === 'fire') ?? shots[0];
      if (best) { await save(best, true, `${context.weapon}:fire`); got.push(`Schuss → ${WEAPON_PROFILES.find((p) => p.id === context.weapon)?.displayName}`); }
    }
    if (context.slot === 'reload' || !hasReload) {
      // the pack's reload SP Tool knows (the Pistol's first), else a whole reload in one sound – always one sound
      const known = ex.filter((x) => x.slot === RELOAD_SLOTS[0]).sort((a, b) => (a.weapon === 'pistol' ? -1 : 0) - (b.weapon === 'pistol' ? -1 : 0));
      const best = known[0] ?? ex.find((x) => x.whole && x.kind === 'mechanical');
      if (best) { await save(best, true, RELOAD_TARGET); got.push(`Reload (${best.seconds.toFixed(1)} s) → Nachladen`); }
      else if (context.slot === 'reload') got.push('keinen Reload erkannt – mit „Ganzes Pack zeigen“ kannst du alle Sounds (auch aus der RESIDENT) anhören und selbst wählen');
    }
    if (got.length) toast(got.some((g) => g.startsWith('keine')) && got.length === 1 ? 'warning' : 'success', 'Automatisch übernommen', got.join(' · '));
  };
  // reopened on another step → targets follow the new step
  useEffect(() => { if (open && list) setTarget(targetsFor(list)); }, [open, context?.weapon, context?.slot]);
  useEffect(() => { if (open) setFilter(context?.slot === 'fire' ? 'shot' : context?.slot === 'reload' ? 'mechanical' : 'all'); }, [open, context?.slot]);

  const take = async (files: File[]) => {
    if (!files.length) return;
    setBusy('Soundpack wird geöffnet…');
    try {
      const { files: base, label } = await baseFromUserFiles(files);
      const p = openBase(base);
      filesRef.current = base;
      const ex = load(p, label);
      if (onUse && context && auto) await autoTake(ex);
      if (!getBasePack()) { await adoptBase(base, 'Importiertes Soundpack', label); toast('info', 'Auch als Vorlage gemerkt', 'Damit baut SP Tool ab jetzt deine Soundpacks.'); }
    } catch (e) { toast('error', 'Dieses Soundpack geht nicht', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const save = async (x: Extracted, use: boolean, forced?: string) => {
    const t = forced ?? target[x.key] ?? '';
    const [w, slot] = t ? t.split(':') : ['universal', x.kind === 'shot' ? 'fire' : 'mag_in'];
    const weapon = (w === 'reload' || slot === 'kill' ? 'universal' : w) as WeaponId | 'universal';
    const storeSlot = slot === 'whole' ? 'mag_out' : slot;
    const name = `${labelRef.current} · ${x.label.replace(/ \(.*\)$/, '')}`;
    const e = await addAudioEntry(x.audio, name, { weapon, slot: storeSlot }, `Aus Soundpack ${labelRef.current}`);
    setDone((d) => ({ ...d, [x.key]: use ? 'im Soundpack' : 'in der Bibliothek' }));
    if (use && onUse && t) {
      onUse({ weapon: w as WeaponId, slot } as SlotTarget, e);
      if (!forced) toast('success', 'Übernommen', `${x.label.replace(/ \(.*\)$/, '')} → ${TARGETS.find((o) => o.value === t)?.label ?? t}`);
    }
    return e;
  };
  const saveAll = async () => {
    setBusy('Wird in deine Bibliothek gelegt…');
    try { let n = 0; for (const x of list ?? []) if (!done[x.key]) { await save(x, false); n++; } toast('success', `${n} Sounds in deiner Bibliothek`); }
    finally { setBusy(null); }
  };

  if (!open) return null;
  return (
    <Modal onClose={() => { if (!busy) onClose(); }}>
      <div className="pack-sounds">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <div className="qp-badge"><Icon name="box" size={18} /></div>
          <h3 className="grow" style={{ margin: 0 }}>Sounds aus einem Soundpack holen</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen"><Icon name="x" size={17} /></button>
        </div>
        {context?.slot === 'fire' && onUse && <p className="small muted" style={{ margin: '0 0 10px' }}>„Nehmen“ macht den Sound zum Schuss der <b>{WEAPON_PROFILES.find((p) => p.id === context.weapon)?.displayName}</b> – egal von welcher Waffe er im Pack war.</p>}
        {context?.slot === 'reload' && onUse && <p className="small muted" style={{ margin: '0 0 10px' }}>„Nehmen“ macht den Sound zu deinem <b>Reload</b> – ein ganzer Sound für alle Pistolen.</p>}
        {context?.slot === 'kill' && onUse && <p className="small muted" style={{ margin: '0 0 10px' }}>„Nehmen“ macht den Sound zu deinem <b>Kill-Sound</b>. Mit ✓ markiert ist nur ein Kill-Sound, den SP Tool aus dem Suchtest sicher kennt – sonst die Sounds des Packs anhören und den richtigen nehmen.</p>}
        <input ref={fileRef} type="file" accept=".rpf,.zip,.rar,.7z" multiple hidden onChange={(e) => { void take(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <div className={`base-drop${over ? ' over' : ''}`} role="button" tabIndex={0} onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void take(Array.from(e.dataTransfer.files)); }}>
          <Icon name="upload" size={22} />
          <div><b>{pack ? `Geöffnet: ${pack.label}` : 'Soundpack hierher ziehen'}</b><div className="small muted">{pack ? 'Ein anderes Pack reinziehen oder klicken.' : 'ZIP des Packs – oder WEAPONS_PLAYER.rpf und RESIDENT.rpf (beide zusammen ergeben den vollen Schuss).'}</div></div>
        </div>
        {onUse && context && !simple && <label className="row small muted" style={{ gap: 6, marginTop: 8 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Beim Reinziehen automatisch übernehmen ({context.slot === 'kill' ? 'Kill-Sound, wenn SP Tool ihn kennt' : `Schuss für diese Waffe${context.slot === 'fire' && hasReload ? '' : ' + ganzer Reload'}`})</label>}
        {pack && (onTakeRest || (filesRef.current && !simple)) && (
          <div className="ps-whole">
            <div className="grow"><b>Das ganze SP verwenden</b><div className="small muted">Für alles, was du nicht selbst auswählst: Reload, Nachhall, stumm geschaltete Original-Sounds, andere Waffen – genau wie im Pack.</div></div>
            {onTakeRest && <Button size="sm" variant="primary" icon="layers" onClick={() => { onTakeRest({ pack: pack.pack, label: pack.label, exclude: pistolShotStreams() }); toast('success', 'Reload & Rest übernommen', `${restCount(pack.pack)} Sounds aus „${pack.label}“ kommen in dein Soundpack. Deine Schüsse wählst du selbst.`); }}>Reload & Rest übernehmen</Button>}
            {filesRef.current && !simple && <Button size="sm" variant="ghost" onClick={async () => { await adoptBase(filesRef.current!, 'Importiertes Soundpack', pack.label); toast('success', 'Als Vorlage gesetzt', `„${pack.label}“ ist jetzt die Grundlage – alles, was du nicht änderst, klingt wie in diesem SP.`); }}>Als Vorlage setzen</Button>}
          </div>
        )}
        {pack && <label className="row small muted" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); allRef.current = e.target.checked; setShown(150); load(pack.pack, pack.label); }} />Ganzes Pack zeigen – alle Sounds aus WEAPONS_PLAYER und RESIDENT (auch andere Waffen und die Original-Sounds, die im Pack stecken)</label>}
        {busy && <div className="small muted" style={{ marginTop: 10 }}><span className="spinner" /> {busy}</div>}
        {list && (list.length ? <>
          <div className="row" style={{ margin: '14px 0 6px', gap: 8 }}>
            <b className="grow">{list.length} Sounds gefunden</b>
            <div className="seg" role="radiogroup" aria-label="Filter">
              {([['shot', 'Schüsse'], ['mechanical', 'Nachladen'], ['all', 'Alle']] as const).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} ({k === 'all' ? list.length : list.filter((x) => x.kind === k).length})</button>
              ))}
            </div>
            {onUse && context && <Button size="sm" variant="primary" icon="sparkles" disabled={!!busy} onClick={() => void autoTake(list)}>Automatisch übernehmen</Button>}
            <Button size="sm" variant="ghost" icon="download" disabled={!!busy} onClick={() => void saveAll()}>Alle in die Bibliothek</Button>
          </div>
          <div className="ps-list">
            {list.filter((x) => filter === 'all' || x.kind === filter).length === 0 && <div className="small muted" style={{ padding: 10 }}>{filter === 'shot' ? 'In diesem Pack wurden keine Schüsse erkannt.' : 'In diesem Pack wurden keine Nachlade-Sounds erkannt.'} Schalte auf „Alle“, um trotzdem alles zu sehen.</div>}
            {list.filter((x) => filter === 'all' || x.kind === filter).slice(0, shown).map((x) => {
              const key = `pack:${x.key}`;
              return (
                <div key={x.key} className={`ps-row${x.weapon ? ' known' : ''}`}>
                  <button className={`play-btn${playing === key ? ' playing' : ''}`} aria-label="Anhören" onClick={() => playing === key ? engine.stop() : engine.play(x.audio, { key })}><Icon name={playing === key ? 'stop' : 'play'} size={12} /></button>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">{x.weapon && <Icon name="check" size={12} />} {x.label}</div>
                    <div className="faint small"><span className={`chip ${x.kind === 'shot' ? 'accent' : ''}`}>{x.kind === 'shot' ? 'Schuss' : 'Nachladen'}{x.sure ? '' : '?'}</span> {x.seconds.toFixed(2)} s · {x.audio.channels.length === 2 ? 'Stereo' : 'Mono'}{x.weapon ? ' · sicher erkannt' : <> · <button className="link-btn" onClick={() => flipKind(x)}>{x.kind === 'shot' ? 'ist Nachladen' : 'ist ein Schuss'}</button></>}</div>
                  </div>
                  {done[x.key] ? <span className="chip ok"><Icon name="check" size={12} />{done[x.key]}</span> : <>
                    <select className="select" value={target[x.key] ?? ''} onChange={(e) => setTarget((t) => ({ ...t, [x.key]: e.target.value }))} aria-label="Wofür">
                      <option value="">Wofür? (nur Bibliothek)</option>
                      {TARGETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => void save(x, false)}>Bibliothek</Button>
                    {onUse && <Button size="sm" variant="primary" disabled={!target[x.key]} title={target[x.key] ? `→ ${TARGETS.find((o) => o.value === target[x.key])?.label}` : 'Erst wählen, wofür'} onClick={() => void save(x, true)}>Nehmen</Button>}
                  </>}
                </div>
              );
            })}
            {list.filter((x) => filter === 'all' || x.kind === filter).length > shown && <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + 150)}>Weitere {Math.min(150, list.filter((x) => filter === 'all' || x.kind === filter).length - shown)} anzeigen</Button>}
          </div>
          <p className="small faint" style={{ marginBottom: 0 }}>SP Tool erkennt am Klang, ob ein Sound ein Schuss oder ein Nachlade-Sound ist (mit „?“ = knapp). Mit ✓ markierte kennt es sicher; bei den anderen weiß es die Waffe noch nicht – anhören und selbst wählen, wofür.</p>
        </> : <p className="muted small">In diesem Pack sind keine Pistolen-Sounds, die SP Tool lesen kann.</p>)}
      </div>
    </Modal>
  );
}
