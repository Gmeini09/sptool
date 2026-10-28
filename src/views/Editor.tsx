import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { engine } from '../audio/engine';
import { audioWorker } from '../audio/workerClient';
import { addUserEntry, navigate, notify, openInEditor, setState, toast, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { WaveformEditor, type WaveView } from '../components/WaveformEditor';
import { Button, EmptyState, IconButton, Slider, Toggle, fmtDb, fmtDur, fmtLufs } from '../components/ui';
import { MiniWave } from '../components/MiniWave';
import { analyze, type AudioAnalysis } from '../dsp/analysis';
import { DEFAULT_EDIT, freshEdit, mergeEdit, type EditPatch, type EditState, type Region } from '../dsp/chain';
import { type AudioData, durationOf } from '../dsp/types';
import { entryById, getAudio, invalidate, useEntryMeta } from '../library/assets';
import { importWavFiles, newId } from '../library/actions';
import { AUDIO_ACCEPT } from '../library/importAudio';
import { WEAPON_LABEL, type LibraryEntry } from '../models/types';
import { logger } from '../services/logger';
import { saveBytes } from '../services/tauri';

type Slot = 'A' | 'B' | 'C';
interface History { past: EditState[]; future: EditState[]; lastPush: number; lastKey: string }
const emptyHistory = (): History => ({ past: [], future: [], lastPush: 0, lastKey: '' });

const fmtT = (s: number) => `${(s * 1000).toFixed(0)} ms`;
const isTurbo = (e: LibraryEntry) => !!e.asset;

// ── Collapsible effect module ────────────────────────────────────────────────
function Fx({ title, enabled, onToggle, children, open: openDefault = false }: { title: string; enabled?: boolean; onToggle?: (v: boolean) => void; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(openDefault);
  return (
    <div className={`fx${open ? ' open' : ''}${enabled === false ? ' disabled' : ''}`}>
      <div className="fx-head" onClick={() => setOpen(!open)} role="button" aria-expanded={open} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(!open))}>
        <span className="chev"><Icon name="chevron" size={14} /></span>
        <span className="fx-t">{title}</span>
        {onToggle && <span onClick={(e) => e.stopPropagation()}><Toggle on={!!enabled} onChange={onToggle} label={`${title} aktivieren`} /></span>}
      </div>
      {open && <div className="fx-body">{children}</div>}
    </div>
  );
}

function Picker() {
  const recent = useApp((s) => s.recent);
  const favorites = useApp((s) => s.favorites);
  const ids = [...new Set([...recent, ...favorites])].slice(0, 8);
  const entries = ids.map((id) => entryById(id)).filter(Boolean) as LibraryEntry[];
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <EmptyState icon="wave" title="Wähle einen Sound zum Bearbeiten" body="Bearbeiten ist zerstörungsfrei: Das Original bleibt unberührt, deine Änderungen werden als Rezept gespeichert und erst beim Export berechnet." action={
        <div className="row"><Button variant="primary" icon="library" onClick={() => navigate('library')}>Aus Bibliothek wählen</Button><Button icon="upload" onClick={() => fileRef.current?.click()}>Sound importieren</Button></div>
      } />
      <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={async (e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; const ids = await importWavFiles(f); if (ids[0]) openInEditor(ids[0]); }} />
      {entries.length > 0 && (
        <section className="panel" style={{ marginTop: 8 }}>
          <div className="panel-head"><h3>Zuletzt verwendet und Favoriten</h3></div>
          <div className="panel-body recent-list">{entries.map((e) => <PickRow key={e.id} e={e} />)}</div>
        </section>
      )}
    </div>
  );
}
function PickRow({ e }: { e: LibraryEntry }) {
  const meta = useEntryMeta(e);
  return (
    <div className="recent-item" onClick={() => openInEditor(e.id)}>
      <Icon name="wave" size={16} />
      <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div><div className="faint small">{WEAPON_LABEL[e.weapon]}</div></div>
      <MiniWave peaks={meta?.peaks} height={26} />
    </div>
  );
}

export function EditorView() {
  const entryId = useApp((s) => s.editorEntryId);
  const entry = entryId ? entryById(entryId) : undefined;
  if (!entry) return <Picker />;
  return <EditorSession key={entry.id} entry={entry} />;
}

function EditorSession({ entry }: { entry: LibraryEntry }) {
  const isEdit = !!entry.edit;
  const baseEntry = isEdit ? entryById(entry.edit!.baseId) : entry;
  const [source, setSource] = useState<AudioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ B: EditState; C: EditState | null }>({ B: entry.edit?.state ?? freshEdit(), C: null });
  const [hist, setHist] = useState<{ B: History; C: History }>({ B: emptyHistory(), C: emptyHistory() });
  const [mode, setMode] = useState<Slot>('B');
  const [outputs, setOutputs] = useState<Record<Slot, { audio: AudioData; analysis: AudioAnalysis } | null>>({ A: null, B: null, C: null });
  const [rendering, setRendering] = useState(false);
  const [view, setView] = useState<WaveView>({ start: 0, end: 1 });
  const [selection, setSelection] = useState<Region | null>(null);
  const [cursor, setCursor] = useState(0);
  const [markers, setMarkers] = useState<number[]>(entry.edit?.markers ?? []);
  const [loop, setLoop] = useState(false);
  const [lane, setLane] = useState<'source' | 'output' | null>(null);
  const [ignoreClip, setIgnoreClip] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const meterRef = useRef<HTMLDivElement>(null);
  const playKey = `editor:${entry.id}`;
  const editSlot: 'B' | 'C' = mode === 'C' && slots.C ? 'C' : 'B';
  const edit: EditState = (editSlot === 'C' ? slots.C : slots.B) ?? slots.B;

  // Load original audio
  useEffect(() => {
    if (!baseEntry) { setLoadError('Der Original-Sound zu dieser Bearbeitung existiert nicht mehr.'); return; }
    let alive = true;
    getAudio(baseEntry).then((a) => {
      if (!alive) return;
      setSource(a);
      setView({ start: 0, end: durationOf(a) });
      setOutputs((o) => ({ ...o, A: { audio: a, analysis: analyze(a) } }));
      logger.audio(`Editor opened "${entry.name}"`);
    }).catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; engine.stop(); };
  }, [baseEntry?.id]);

  // Render B and C in the worker (debounced; stale results dropped)
  const reqSeq = useRef(0);
  useEffect(() => {
    if (!source) return;
    const id = ++reqSeq.current;
    setRendering(true);
    const t = setTimeout(async () => {
      try {
        const b = await audioWorker.render(source, slots.B);
        const c = slots.C ? await audioWorker.render(source, slots.C) : null;
        if (id !== reqSeq.current) return;
        setOutputs((o) => ({ ...o, B: { audio: b.audio, analysis: b.analysis }, C: c ? { audio: c.audio, analysis: c.analysis } : null }));
      } catch (e) {
        if (id === reqSeq.current) toast('error', 'Berechnen fehlgeschlagen', e instanceof Error ? e.message : String(e));
      } finally {
        if (id === reqSeq.current) setRendering(false);
      }
    }, 140);
    return () => clearTimeout(t);
  }, [source, slots]);

  // ── Edit state changes with coalesced undo history ────────────────────────
  const apply = useCallback((patch: EditPatch | ((e: EditState) => EditState), key = 'misc') => {
    setSlots((s) => {
      const cur = s[editSlot]!;
      const next = typeof patch === 'function' ? patch(cur) : mergeEdit(cur, patch);
      setHist((h) => {
        const hh = h[editSlot];
        const now = Date.now();
        const coalesce = hh.lastKey === key && now - hh.lastPush < 600 && key !== 'misc';
        return { ...h, [editSlot]: { past: coalesce ? hh.past : [...hh.past.slice(-99), cur], future: [], lastPush: now, lastKey: key } };
      });
      return { ...s, [editSlot]: next };
    });
    setDirty(true);
    if (mode === 'A') setMode(editSlot);
  }, [editSlot, mode]);

  const undo = useCallback(() => {
    const h = hist[editSlot];
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    setHist({ ...hist, [editSlot]: { past: h.past.slice(0, -1), future: [slots[editSlot]!, ...h.future], lastPush: 0, lastKey: '' } });
    setSlots({ ...slots, [editSlot]: prev });
  }, [hist, slots, editSlot]);
  const redo = useCallback(() => {
    const h = hist[editSlot];
    if (!h.future.length) return;
    const nxt = h.future[0];
    setHist({ ...hist, [editSlot]: { past: [...h.past, slots[editSlot]!], future: h.future.slice(1), lastPush: 0, lastKey: '' } });
    setSlots({ ...slots, [editSlot]: nxt });
  }, [hist, slots, editSlot]);

  // ── Playback ──────────────────────────────────────────────────────────────
  const total = source ? durationOf(source) : 0;
  const play = useCallback((slot: Slot = mode) => {
    if (engine.playingKey === playKey) { engine.stop(); setLane(null); return; }
    const out = outputs[slot];
    if (!out) return;
    if (slot === 'A') {
      const sel = selection && Math.abs(selection.end - selection.start) > 0.005 ? { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) } : null;
      engine.play(out.audio, { key: playKey, offset: sel?.start ?? cursor, loop: loop && sel ? sel : null, onEnded: () => setLane(null) });
      setLane('source');
    } else {
      engine.play(out.audio, { key: playKey, loop: loop ? { start: 0, end: durationOf(out.audio) } : null, onEnded: () => setLane(null) });
      setLane('output');
    }
  }, [mode, outputs, selection, cursor, loop, playKey]);

  // ── Region tools ──────────────────────────────────────────────────────────
  const sel = selection && Math.abs(selection.end - selection.start) > 0.002 ? { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) } : null;
  const crop = () => { if (!sel) return; apply({ trimStart: sel.start, trimEnd: sel.end >= total - 0.0005 ? null : sel.end, cuts: edit.cuts.filter((c) => c.end > sel.start && c.start < sel.end) }); setSelection(null); };
  const cut = () => { if (!sel) return; apply((e) => ({ ...e, cuts: [...e.cuts, sel] })); setSelection(null); };
  const clearRegions = () => apply({ trimStart: 0, trimEnd: null, cuts: [] });
  const zoomBy = (f: number) => {
    const span = view.end - view.start, c = (view.start + view.end) / 2;
    const ns = Math.max(0.005, Math.min(total, span * f));
    const start = Math.max(0, Math.min(total - ns, c - ns / 2));
    setView({ start, end: start + ns });
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); play(); }
      else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); cut(); } }
      else if (e.key.toLowerCase() === 'm' && !ctrl) setMarkers((m) => [...m, cursor].sort((a, b) => a - b));
      else if (e.key.toLowerCase() === 'l' && !ctrl) setLoop((l) => !l);
      else if (['1', '2', '3'].includes(e.key) && !ctrl) { const s = (['A', 'B', 'C'] as Slot[])[+e.key - 1]; if (s !== 'C' || slots.C) setMode(s); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // ── Save / export ─────────────────────────────────────────────────────────
  const save = () => {
    if (!baseEntry) return;
    const state = slots[editSlot]!;
    if (isEdit) {
      setState((s) => ({ userEntries: s.userEntries.map((u) => u.id === entry.id ? { ...u, edit: { baseId: baseEntry.id, state, markers } } : u) }));
      invalidate(entry.id);
      toast('success', 'Änderungen gespeichert', entry.name);
    } else {
      const id = newId('edit');
      const name = `${entry.name} (bearbeitet)`;
      addUserEntry({
        ...entry, id, name, source: 'edit', creator: 'Du', createdAt: Date.now(), sourceInfo: `Bearbeitung von ${entry.name}`,
        synth: undefined, blobKey: undefined, edit: { baseId: entry.id, state, markers }, tags: [...entry.tags, 'edited'],
      });
      toast('success', 'Als neuer Sound gespeichert', `${name} – das Original bleibt unverändert.`);
      notify('Bearbeiteter Sound gespeichert', name);
      openInEditor(id);
    }
    setDirty(false);
  };
  const exportWav = async () => {
    const out = outputs[mode];
    if (!out) return;
    const bytes = await audioWorker.encode(out.audio, 16);
    const path = await saveBytes(`${entry.name.replace(/[^\w .-]+/g, '').replace(/\s+/g, '_')}_${mode}.wav`, bytes, { name: 'WAV-Audio', extensions: ['wav'] });
    if (path) toast('success', 'WAV exportiert', path);
  };
  const autoFixClipping = () => {
    const a = outputs[editSlot]?.analysis;
    const over = a ? Math.max(0, a.peakDb + 1) : 0;
    apply({ limiter: { enabled: true, ceiling: -1 }, gainDb: Math.round((edit.gainDb - over * 0.5) * 10) / 10 }, 'clipfix');
    toast('success', 'Übersteuerung behoben', 'Limiter bei −1 dB aktiviert.');
  };

  const current = outputs[mode];
  const an = current?.analysis;
  const showClip = !ignoreClip && mode !== 'A' && an?.clipping;
  const eNum = (v: number, d = 1) => v.toFixed(d);
  const histFor = hist[editSlot];

  const rack = useMemo(() => edit, [edit]);

  if (loadError) return <div className="page"><EmptyState icon="alert" title="Dieser Sound konnte nicht geöffnet werden" body={loadError} action={<Button onClick={() => setState({ editorEntryId: null })}>Anderen Sound wählen</Button>} /></div>;
  if (!source) return <div className="page"><div className="wave-skeleton" style={{ height: 300 }} /></div>;

  return (
    <div className="editor">
      <div className="ed-main">
        <div className="ed-head">
          <IconButton icon="x" title={dirty && !discardArmed ? 'Editor schließen' : 'Schließen und Änderungen verwerfen'} onClick={() => {
            if (dirty && !discardArmed) { setDiscardArmed(true); toast('warning', 'Ungespeicherte Änderungen', 'Tipp nochmal auf Schließen, um sie zu verwerfen, oder speichere vorher.'); setTimeout(() => setDiscardArmed(false), 4000); return; }
            engine.stop(); setState({ editorEntryId: null });
          }} />
          <div style={{ minWidth: 0 }}>
            <h2>{entry.name}</h2>
            <div className="faint small">{WEAPON_LABEL[entry.weapon]} · {({ builtin: isTurbo(entry) ? 'Turbo' : 'Mitgeliefert', imported: 'Importiert', generated: 'Erzeugt', edit: 'Bearbeitet' } as Record<string, string>)[entry.source] ?? entry.source} · {isEdit ? `Bearbeitung von ${baseEntry?.name}` : 'Original bleibt unverändert'}{dirty ? ' · ungespeicherte Änderungen' : ''}</div>
          </div>
          <span className="spacer" />
          <div className="abc" role="group" aria-label="A, B und C vergleichen">
            {(['A', 'B', 'C'] as Slot[]).map((s) => (
              <button key={s} className={mode === s ? 'on' : ''} disabled={s === 'C' && !slots.C} onClick={() => setMode(s)} title={s === 'A' ? 'Original (1)' : s === 'B' ? 'Bearbeitet (2)' : 'Alternative (3)'}>{s}</button>
            ))}
          </div>
          <Button size="sm" icon="copy" onClick={() => { setSlots((s) => ({ ...s, C: JSON.parse(JSON.stringify(s.B)) })); setMode('C'); }} title="B nach C kopieren, um eine Alternative auszuprobieren">{slots.C ? 'C aus B zurücksetzen' : 'C aus B erstellen'}</Button>
          <Button size="sm" icon="export" onClick={() => void exportWav()} disabled={!current}>{mode} exportieren</Button>
          <Button size="sm" variant="primary" icon="check" onClick={save}>{isEdit ? 'Änderungen speichern' : 'Als neuen Sound speichern'}</Button>
        </div>

        <WaveformEditor
          source={source} output={mode === 'A' ? null : outputs[mode]?.audio ?? null}
          outputLabel={mode === 'A' ? 'Ausgabe – wechsle zu B oder C' : `Ausgabe (${mode})${rendering ? ' – wird berechnet…' : ''}`}
          view={view} onView={setView} selection={selection} onSelection={setSelection} cursor={cursor} onCursor={setCursor}
          trimStart={edit.trimStart} trimEnd={edit.trimEnd} onTrim={(s, e) => apply({ trimStart: s, trimEnd: e }, 'trim')}
          cuts={edit.cuts} markers={markers} playingLane={lane} playKey={playKey} meterRef={meterRef}
        />

        <div className="transport">
          <Button variant="primary" icon={lane ? 'stop' : 'play'} onClick={() => play()}>{lane ? 'Stopp' : `${mode} abspielen`}</Button>
          <IconButton icon="repeat" title="Schleife (L) – wiederholt in A die Auswahl, in B/C die ganze Ausgabe" on={loop} onClick={() => setLoop(!loop)} />
          <div className="meter" ref={meterRef} title="Ausgangspegel"><div style={{ transform: 'scaleX(0)' }} /></div>
          <span className="time">Cursor {fmtT(cursor)}{sel ? ` · Auswahl ${fmtT(sel.end - sel.start)}` : ''}</span>
          <span className="spacer" />
          <IconButton icon="undo" title="Rückgängig (Strg+Z)" disabled={!histFor.past.length} onClick={undo} />
          <IconButton icon="redo" title="Wiederholen (Strg+Y)" disabled={!histFor.future.length} onClick={redo} />
          <IconButton icon="zoomIn" title="Hineinzoomen (Mausrad)" onClick={() => zoomBy(0.5)} />
          <IconButton icon="zoomOut" title="Herauszoomen" onClick={() => zoomBy(2)} />
          <Button size="sm" variant="ghost" onClick={() => setView({ start: 0, end: total })}>Einpassen</Button>
          <Button size="sm" icon="crop" disabled={!sel} onClick={crop} title="Nur die Auswahl behalten (auf Auswahl zuschneiden)">Zuschneiden</Button>
          <Button size="sm" icon="scissors" disabled={!sel} onClick={cut} title="Auswahl entfernen (Entf)">Ausschneiden</Button>
          <Button size="sm" disabled={!cursor} onClick={() => apply({ trimStart: Math.min(cursor, (edit.trimEnd ?? total) - 0.005) }, 'trim')} title="Anfang am Cursor setzen">Anfang setzen</Button>
          <Button size="sm" disabled={!cursor} onClick={() => apply({ trimEnd: Math.max(cursor, edit.trimStart + 0.005) }, 'trim')} title="Ende am Cursor setzen">Ende setzen</Button>
          <Button size="sm" variant="ghost" disabled={!edit.cuts.length && !edit.trimStart && edit.trimEnd == null} onClick={clearRegions}>Bereiche zurücksetzen</Button>
          <IconButton icon="tag" title="Marker am Cursor setzen (M)" onClick={() => setMarkers((m) => [...m, cursor].sort((a, b) => a - b))} />
          {markers.length > 0 && <Button size="sm" variant="ghost" onClick={() => setMarkers([])}>{markers.length} Marker entfernen</Button>}
        </div>

        {showClip && (
          <div className="callout">
            <Icon name="alert" size={18} />
            <div style={{ flex: 1 }}><strong>Übersteuerung erkannt.</strong><div className="muted small">{an!.clippedSamples} Samples erreichen in {mode} den Maximalpegel. „Automatisch beheben“ aktiviert einen Limiter bei −1 dB und senkt die Verstärkung etwas.</div></div>
            <Button size="sm" variant="primary" onClick={autoFixClipping}>Automatisch beheben</Button>
            <Button size="sm" onClick={() => play(mode)}>Vorhören</Button>
            <Button size="sm" variant="ghost" onClick={() => setIgnoreClip(true)}>Ignorieren</Button>
          </div>
        )}

        <div className="analysis" aria-label={`Analyse von ${mode}`}>
          {[
            ['Spitzenpegel', an ? fmtDb(an.peakDb) : '…'], ['RMS', an ? fmtDb(an.rmsDb) : '…'], ['Lautstärke', an ? fmtLufs(an.lufs) : '…'],
            ['Dauer', an ? fmtDur(an.duration) : '…'], ['Abtastrate', an ? `${(an.sampleRate / 1000).toFixed(1)} kHz` : '…'],
            ['Kanäle', an ? (an.channels === 1 ? 'Mono' : 'Stereo') : '…'], ['Übersteuerung', an ? (an.clipping ? `${an.clippedSamples} Samples` : 'Keine') : '…'],
            ['Dynamikumfang', an ? `${eNum(an.dynamicRangeDb)} dB` : '…'],
          ].map(([k, v]) => <div className="a-cell" key={k}><div className="a-k">{k}</div><div className="a-v">{v}</div></div>)}
        </div>
        <div className="faint small">Auf der Wellenform ziehen zum Auswählen · orange Griffe ziehen zum Kürzen · Mausrad zum Zoomen, Umschalt+Mausrad zum Scrollen · Leertaste abspielen · 1/2/3 wechselt A/B/C · M Marker · L Schleife</div>
      </div>

      <aside className="fx-rack" aria-label="Effekte">
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => apply((cur) => ({ ...freshEdit(), trimStart: cur.trimStart, trimEnd: cur.trimEnd, cuts: cur.cuts }), 'reset')} title="Alle Effekte zurücksetzen (Kürzungen und Schnitte bleiben)">Zurücksetzen</Button>
        </div>
        <div className="row faint small" style={{ margin: '-4px 0 10px' }}>Bearbeite Slot {editSlot}{mode === 'A' ? ' (du hörst A)' : ''}</div>

        <Fx title="Pegel & Blenden" open>
          <Slider label="Verstärkung" value={rack.gainDb} min={-24} max={24} step={0.1} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => apply({ gainDb: v }, 'gain')} />
          <div className="row"><span className="muted small" style={{ flex: 1 }}>Spitzenpegel normalisieren</span><Toggle on={rack.normalize.enabled} onChange={(v) => apply({ normalize: { enabled: v } }, 'norm')} label="Normalisieren" /></div>
          {rack.normalize.enabled && <Slider label="Normalisieren auf" value={rack.normalize.targetDb} min={-12} max={0} step={0.1} def={-1} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => apply({ normalize: { targetDb: v } }, 'normt')} />}
          <Slider label="Einblenden" value={rack.fadeIn} min={0} max={0.5} step={0.001} def={0} format={fmtT} onChange={(v) => apply({ fadeIn: v }, 'fi')} />
          <Slider label="Ausblenden" value={rack.fadeOut} min={0} max={1.5} step={0.001} def={0} format={fmtT} onChange={(v) => apply({ fadeOut: v }, 'fo')} />
        </Fx>
        <Fx title="Tonhöhe & Tempo">
          <Slider label="Tonhöhe (Länge bleibt)" value={rack.pitch} min={-12} max={12} step={0.1} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} HT`} onChange={(v) => apply({ pitch: v }, 'pitch')} />
          <Slider label="Tempo (wie Tonband)" value={rack.speed} min={0.5} max={2} step={0.01} def={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => apply({ speed: v }, 'speed')} />
        </Fx>
        <Fx title="Klang">
          <Slider label="Bass · 120 Hz" value={rack.eq.bass} min={-15} max={15} step={0.5} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => apply({ eq: { bass: v } }, 'bass')} />
          <Slider label="Mitten · 1 kHz" value={rack.eq.mid} min={-15} max={15} step={0.5} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => apply({ eq: { mid: v } }, 'mid')} />
          <Slider label="Höhen · 6 kHz" value={rack.eq.treble} min={-15} max={15} step={0.5} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => apply({ eq: { treble: v } }, 'treble')} />
        </Fx>
        <Fx title="Parametrischer EQ" enabled={rack.peq.some((b) => b.enabled)} onToggle={(v) => apply((e) => ({ ...e, peq: e.peq.map((b) => ({ ...b, enabled: v })) }), 'peq')}>
          {rack.peq.map((b, i) => {
            const set = (p: Partial<typeof b>) => apply((e) => ({ ...e, peq: e.peq.map((x, j) => (j === i ? { ...x, ...p } : x)) }), `peq${i}`);
            return (
              <div key={i} className="col" style={{ gap: 8, paddingBottom: 8, borderBottom: i < 2 ? '1px solid var(--border-soft)' : 0 }}>
                <div className="row">
                  <span className="small" style={{ fontWeight: 600, flex: 1 }}>Band {i + 1}</span>
                  <select className="select" style={{ height: 28, width: 120 }} value={b.type} onChange={(e) => set({ type: e.target.value as typeof b.type })} aria-label={`Band ${i + 1} Typ`}>
                    <option value="peaking">Glocke</option><option value="lowshelf">Tiefen-Kuhschwanz</option><option value="highshelf">Höhen-Kuhschwanz</option>
                  </select>
                  <Toggle on={b.enabled} onChange={(v) => set({ enabled: v })} label={`Band ${i + 1}`} />
                </div>
                <Slider label="Frequenz" value={Math.log10(b.freq)} min={Math.log10(20)} max={Math.log10(20000)} step={0.005} format={() => b.freq >= 1000 ? `${(b.freq / 1000).toFixed(2)} kHz` : `${Math.round(b.freq)} Hz`} onChange={(v) => set({ freq: Math.round(10 ** v) })} disabled={!b.enabled} />
                <Slider label="Verstärkung" value={b.gain} min={-18} max={18} step={0.5} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => set({ gain: v })} disabled={!b.enabled} />
                <Slider label="Q" value={b.q} min={0.2} max={10} step={0.05} def={1} format={(v) => v.toFixed(2)} onChange={(v) => set({ q: v })} disabled={!b.enabled} />
              </div>
            );
          })}
        </Fx>
        <Fx title="Hochpass" enabled={rack.highpass.enabled} onToggle={(v) => apply({ highpass: { enabled: v } }, 'hp')}>
          <Slider label="Grenzfrequenz" value={rack.highpass.freq} min={20} max={1000} step={1} def={40} format={(v) => `${Math.round(v)} Hz`} onChange={(v) => apply({ highpass: { freq: v } }, 'hpf')} disabled={!rack.highpass.enabled} />
        </Fx>
        <Fx title="Tiefpass" enabled={rack.lowpass.enabled} onToggle={(v) => apply({ lowpass: { enabled: v } }, 'lp')}>
          <Slider label="Grenzfrequenz" value={rack.lowpass.freq} min={1000} max={20000} step={50} def={16000} format={(v) => `${(v / 1000).toFixed(1)} kHz`} onChange={(v) => apply({ lowpass: { freq: v } }, 'lpf')} disabled={!rack.lowpass.enabled} />
        </Fx>
        <Fx title="Kompressor" enabled={rack.compressor.enabled} onToggle={(v) => apply({ compressor: { enabled: v } }, 'comp')}>
          <Slider label="Schwelle" value={rack.compressor.threshold} min={-48} max={0} step={0.5} def={-18} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => apply({ compressor: { threshold: v } }, 'ct')} disabled={!rack.compressor.enabled} />
          <Slider label="Verhältnis" value={rack.compressor.ratio} min={1} max={20} step={0.1} def={4} format={(v) => `${v.toFixed(1)}:1`} onChange={(v) => apply({ compressor: { ratio: v } }, 'cr')} disabled={!rack.compressor.enabled} />
          <Slider label="Anschlag" value={rack.compressor.attack} min={0.1} max={50} step={0.1} def={3} format={(v) => `${v.toFixed(1)} ms`} onChange={(v) => apply({ compressor: { attack: v } }, 'ca')} disabled={!rack.compressor.enabled} />
          <Slider label="Rücklauf" value={rack.compressor.release} min={10} max={500} step={1} def={80} format={(v) => `${Math.round(v)} ms`} onChange={(v) => apply({ compressor: { release: v } }, 'crl')} disabled={!rack.compressor.enabled} />
          <Slider label="Ausgleich" value={rack.compressor.makeup} min={0} max={18} step={0.1} def={0} format={(v) => `+${v.toFixed(1)} dB`} onChange={(v) => apply({ compressor: { makeup: v } }, 'cm')} disabled={!rack.compressor.enabled} />
        </Fx>
        <Fx title="Transienten-Former" enabled={rack.transient.enabled} onToggle={(v) => apply({ transient: { enabled: v } }, 'ts')}>
          <Slider label="Anschlag" value={rack.transient.attack} min={-12} max={12} step={0.5} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => apply({ transient: { attack: v } }, 'tsa')} disabled={!rack.transient.enabled} />
          <Slider label="Ausklang" value={rack.transient.sustain} min={-18} max={12} step={0.5} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => apply({ transient: { sustain: v } }, 'tss')} disabled={!rack.transient.enabled} />
        </Fx>
        <Fx title="Pack-Klang (Klangabgleich)" enabled={!!rack.tone?.enabled} onToggle={(v) => apply({ tone: { ...(rack.tone ?? DEFAULT_EDIT.tone!), enabled: v } }, 'tone')}>
          <div className="row"><span className="muted small" style={{ flex: 1 }}>Ziel</span>
            <select className="select" style={{ height: 28, width: 170 }} value={(rack.tone ?? DEFAULT_EDIT.tone!).profile} onChange={(e) => apply({ tone: { ...(rack.tone ?? DEFAULT_EDIT.tone!), profile: e.target.value as 'balanced' } }, 'tonep')} disabled={!rack.tone?.enabled} aria-label="Klangziel">
              <option value="balanced">Ausgewogen</option><option value="dense">Dicht &amp; laut</option><option value="bright">Hell &amp; cracky</option><option value="gambo">Gambo (deutsche Gangwar-Packs)</option>
            </select>
          </div>
          <Slider label="Stärke" value={(rack.tone ?? DEFAULT_EDIT.tone!).amount} min={0} max={1} step={0.01} def={0.6} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ tone: { ...(rack.tone ?? DEFAULT_EDIT.tone!), amount: v } }, 'tonea')} disabled={!rack.tone?.enabled} />
          <div className="faint small">Bringt die Klangbalance in Richtung gemessener FiveM-Soundpacks (nur Messwerte, kein fremdes Audio).</div>
        </Fx>
        <Fx title="Crack (Exciter)" enabled={!!rack.exciter?.enabled} onToggle={(v) => apply({ exciter: { ...(rack.exciter ?? DEFAULT_EDIT.exciter!), enabled: v } }, 'exc')}>
          <Slider label="Ab Frequenz" value={(rack.exciter ?? DEFAULT_EDIT.exciter!).freq} min={1000} max={8000} step={50} def={3000} format={(v) => `${(v / 1000).toFixed(1)} kHz`} onChange={(v) => apply({ exciter: { ...(rack.exciter ?? DEFAULT_EDIT.exciter!), freq: v } }, 'excf')} disabled={!rack.exciter?.enabled} />
          <Slider label="Stärke" value={(rack.exciter ?? DEFAULT_EDIT.exciter!).amount} min={0} max={1} step={0.01} def={0.3} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ exciter: { ...(rack.exciter ?? DEFAULT_EDIT.exciter!), amount: v } }, 'exca')} disabled={!rack.exciter?.enabled} />
        </Fx>
        <Fx title="Wumms (Punch-Ebene)" enabled={!!rack.thump?.enabled} onToggle={(v) => apply({ thump: { ...(rack.thump ?? DEFAULT_EDIT.thump!), enabled: v } }, 'thp')}>
          <Slider label="Tonhöhe" value={(rack.thump ?? DEFAULT_EDIT.thump!).freq} min={45} max={200} step={1} def={85} format={(v) => `${Math.round(v)} Hz`} onChange={(v) => apply({ thump: { ...(rack.thump ?? DEFAULT_EDIT.thump!), freq: v } }, 'thpf')} disabled={!rack.thump?.enabled} />
          <Slider label="Stärke" value={(rack.thump ?? DEFAULT_EDIT.thump!).amount} min={0} max={1} step={0.01} def={0.35} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ thump: { ...(rack.thump ?? DEFAULT_EDIT.thump!), amount: v } }, 'thpa')} disabled={!rack.thump?.enabled} />
        </Fx>
        <Fx title="Stadt-Echo" enabled={!!rack.slap?.enabled} onToggle={(v) => apply({ slap: { ...(rack.slap ?? DEFAULT_EDIT.slap!), enabled: v } }, 'slp')}>
          <Slider label="Abstand" value={(rack.slap ?? DEFAULT_EDIT.slap!).time} min={60} max={400} step={1} def={150} format={(v) => `${Math.round(v)} ms`} onChange={(v) => apply({ slap: { ...(rack.slap ?? DEFAULT_EDIT.slap!), time: v } }, 'slpt')} disabled={!rack.slap?.enabled} />
          <Slider label="Mix" value={(rack.slap ?? DEFAULT_EDIT.slap!).mix} min={0} max={1} step={0.01} def={0.3} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ slap: { ...(rack.slap ?? DEFAULT_EDIT.slap!), mix: v } }, 'slpm')} disabled={!rack.slap?.enabled} />
          <div className="faint small">Echo von Häuserwänden – klingt auch im Spiel (Mono) sauber.</div>
        </Fx>
        <Fx title="Rauschminderung (Gate)" enabled={rack.noise.enabled} onToggle={(v) => apply({ noise: { enabled: v } }, 'nr')}>
          <Slider label="Schwelle" value={rack.noise.threshold} min={-80} max={-20} step={0.5} def={-55} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => apply({ noise: { threshold: v } }, 'nrt')} disabled={!rack.noise.enabled} />
          <div className="faint small">Dämpft leises Rauschen und Raumgeräusche zwischen und nach den Schüssen.</div>
        </Fx>
        <Fx title="Hall" enabled={rack.reverb.enabled} onToggle={(v) => apply({ reverb: { enabled: v } }, 'rv')}>
          <Slider label="Raumgröße" value={rack.reverb.room} min={0} max={1} step={0.01} def={0.4} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ reverb: { room: v } }, 'rvr')} disabled={!rack.reverb.enabled} />
          <Slider label="Dämpfung" value={rack.reverb.damping} min={0} max={1} step={0.01} def={0.5} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ reverb: { damping: v } }, 'rvd')} disabled={!rack.reverb.enabled} />
          <Slider label="Mix" value={rack.reverb.mix} min={0} max={1} step={0.01} def={0.15} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ reverb: { mix: v } }, 'rvm')} disabled={!rack.reverb.enabled} />
        </Fx>
        <Fx title="Echo (Delay)" enabled={rack.delay.enabled} onToggle={(v) => apply({ delay: { enabled: v } }, 'dl')}>
          <Slider label="Zeit" value={rack.delay.time} min={10} max={800} step={1} def={120} format={(v) => `${Math.round(v)} ms`} onChange={(v) => apply({ delay: { time: v } }, 'dlt')} disabled={!rack.delay.enabled} />
          <Slider label="Rückkopplung" value={rack.delay.feedback} min={0} max={0.9} step={0.01} def={0.25} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ delay: { feedback: v } }, 'dlf')} disabled={!rack.delay.enabled} />
          <Slider label="Mix" value={rack.delay.mix} min={0} max={1} step={0.01} def={0.2} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ delay: { mix: v } }, 'dlm')} disabled={!rack.delay.enabled} />
        </Fx>
        <Fx title="Stereo">
          <Slider label="Breite" value={rack.width} min={0} max={2} step={0.01} def={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ width: v }, 'width')} disabled={rack.mono} />
          <div className="row"><span className="muted small" style={{ flex: 1 }}>Mono</span><Toggle on={rack.mono} onChange={(v) => apply({ mono: v }, 'mono')} label="Mono" /></div>
        </Fx>
        <Fx title="Sanfte Sättigung" enabled={rack.softClip.enabled} onToggle={(v) => apply({ softClip: { enabled: v } }, 'sc')}>
          <Slider label="Stärke" value={rack.softClip.drive} min={0} max={1} step={0.01} def={0.3} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply({ softClip: { drive: v } }, 'scd')} disabled={!rack.softClip.enabled} />
        </Fx>
        <Fx title="Limiter" enabled={rack.limiter.enabled} onToggle={(v) => apply({ limiter: { enabled: v } }, 'lim')}>
          <Slider label="Obergrenze" value={rack.limiter.ceiling} min={-12} max={0} step={0.1} def={-1} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => apply({ limiter: { ceiling: v } }, 'limc')} disabled={!rack.limiter.enabled} />
        </Fx>
        <Fx title="Harte Begrenzung" enabled={rack.hardLimit.enabled} onToggle={(v) => apply({ hardLimit: { enabled: v } }, 'hl')}>
          <Slider label="Obergrenze" value={rack.hardLimit.ceiling} min={-12} max={0} step={0.1} def={-0.3} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => apply({ hardLimit: { ceiling: v } }, 'hlc')} disabled={!rack.hardLimit.enabled} />
        </Fx>
      </aside>
    </div>
  );
}
