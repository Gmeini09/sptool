// Soundpack Editor (spec §45–47): weapons left, slots (incl. attachment slots) centre, sound picker right.
import { useEffect, useMemo, useRef, useState } from 'react';
import { burstAt } from '../fx/effects';
import { engine } from '../audio/engine';
import { previewEntry, usePlayingKey } from '../audio/preview';
import { navigate, openInEditor, toast, updateProject, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { MiniWave } from '../components/MiniWave';
import { Sheet, useIsMobile } from '../components/mobile';
import { Button, EmptyState, IconButton, Modal } from '../components/ui';
import { allEntries, entryById, useEntryMeta } from '../library/assets';
import type { LibraryEntry, WeaponId, WeaponProfile } from '../models/types';
import { TYPE_LABEL } from '../models/types';
import { playAssignment, playSequence } from '../projects/actions';
import { assign, deriveSlot, filledCount, restoreSnapshot, slotMatches, validateProject, type Project, type SlotAssignment } from '../projects/project';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { DERIVE_FROM } from '../weapons/coverage';


export function SoundpackView() {
  const p = useApp((s) => s.projects.find((x) => x.id === s.currentProjectId));
  const projects = useApp((s) => s.projects);
  if (!p) {
    return (
      <div className="page" style={{ maxWidth: 820 }}>
        <EmptyState icon="layers" title="Kein Soundpack geöffnet" body="Öffne ein Soundpack oder erstelle ein neues, um die Waffen-Slots zu befüllen." action={<Button variant="primary" onClick={() => navigate('projects')}>{projects.length ? 'Soundpack auswählen' : 'Neues Soundpack'}</Button>} />
      </div>
    );
  }
  return <Editor key={p.id} p={p} />;
}

function Editor({ p }: { p: Project }) {
  const mobile = useIsMobile();
  const [weapon, setWeapon] = useState<WeaponId>('pistol');
  const [slot, setSlot] = useState<string>('fire');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const prof = WEAPON_PROFILES.find((w) => w.id === weapon)!;
  const validation = validateProject(p, WEAPON_PROFILES);
  const issuesHere = validation.problems.filter((x) => x.weapon === prof.displayName);
  const set = (fn: (x: Project) => Project) => updateProject(p.id, fn);

  const attachmentSlots = new Set(prof.attachments.flatMap((a) => a.soundSlots));
  const base = prof.slots.filter((s) => !attachmentSlots.has(s.id));
  const att = prof.slots.filter((s) => attachmentSlots.has(s.id));

  const assignEntry = (e: LibraryEntry, slotId = slot) => {
    set((x) => assign(x, weapon, slotId, { entryId: e.id }));
    setPickerOpen(false);
  };
  const fixAll = () => {
    let n = 0;
    set((x) => {
      let y = x;
      for (const prob of validateProject(x, WEAPON_PROFILES).problems) {
        const w = WEAPON_PROFILES.find((q) => q.displayName === prob.weapon)!;
        if (prob.fix === 'derive') { y = deriveSlot(y, w.id, prob.slot); n++; }
      }
      return y;
    });
    toast(n ? 'success' : 'info', n ? `${n} Aufsatz-Sound${n > 1 ? 's' : ''} abgeleitet` : 'Nichts konnte abgeleitet werden', n ? 'Die Schalldämpfer-Sounds wurden aus den Schuss-Sounds erstellt.' : 'Wähle Sounds für die restlichen Slots.');
  };
  const playFull = () => {
    if (nowPlaying) { engine.stop(); setNowPlaying(null); return; }
    const order = ['fire', 'suppressed_fire', 'mag_out', 'mag_in', 'slide', 'reload_finish'];
    const items: Array<{ key: string; a: SlotAssignment }> = [];
    for (const w of WEAPON_PROFILES) for (const sid of order) { const a = p.weapons[w.id]?.[sid]; if (a) items.push({ key: `${w.id}:${sid}`, a }); }
    if (!items.length) { toast('info', 'Noch nichts zum Abspielen', 'Befülle zuerst ein paar Slots.'); return; }
    void playSequence(items, setNowPlaying);
  };

  const slotList = (
    <div className="col" style={{ gap: 16 }}>
      {issuesHere.length > 0 && (
        <div className="callout">
          <Icon name="alert" size={18} />
          <div style={{ flex: 1 }}>
            <strong>{issuesHere.length} Slot{issuesHere.length > 1 ? 's spielen' : ' spielt'} noch den Original-Sound</strong>
            <div className="muted small">{issuesHere.map((i) => i.message).join(' ')}</div>
          </div>
          {issuesHere.some((i) => i.fix === 'derive') && <Button size="sm" variant="primary" onClick={fixAll}>Fehlende ableiten</Button>}
        </div>
      )}
      <SlotGroup title="Grund-Sounds" slots={base} p={p} prof={prof} sel={slot} playingKey={nowPlaying} onSelect={(id) => { setSlot(id); if (mobile) setPickerOpen(true); }} onDrop={assignEntry} set={set} />
      <SlotGroup title="Schalldämpfer" note="Wird gespielt, solange der Schalldämpfer aufgesetzt ist. Landet in denselben Archiven wie die Grund-Sounds, damit nichts auf das Original zurückfällt." slots={att} p={p} prof={prof} sel={slot} playingKey={nowPlaying} onSelect={(id) => { setSlot(id); if (mobile) setPickerOpen(true); }} onDrop={assignEntry} set={set} />
    </div>
  );

  return (
    <div className="sp-editor">
      <header className="sp-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{p.name}</h2>
          <div className="faint small">v{p.version} · automatisch gespeichert · {WEAPON_PROFILES.reduce((s, w) => s + filledCount(p, w), 0)} Slots befüllt</div>
        </div>
        {WEAPON_PROFILES.every((w) => filledCount(p, w) === 0)
          ? <span className="chip" title="Klick unten auf einen Slot und wähle einen Sound – oder nutze „Pack automatisch erstellen“">Leer – wähle deinen ersten Sound</span>
          : validation.ok
          ? <button className="chip ok link-like" title="Zu „Bauen“ wechseln" onClick={() => navigate('build')}><Icon name="check" size={12} />Fertig – jetzt bauen →</button>
          : <span className="chip warn">{validation.problems.length} zu beheben</span>}
        <Button size="sm" icon={nowPlaying ? 'stop' : 'play'} onClick={playFull}>{nowPlaying ? 'Stopp' : 'Ganzes Pack anhören'}</Button>
        <IconButton icon="refresh" title="Versionsverlauf" solid onClick={() => setHistory(true)} />
      </header>

      <nav className="sp-weapons" aria-label="Waffen">
        {WEAPON_PROFILES.map((w) => {
          const n = filledCount(p, w);
          const bad = validation.problems.some((x) => x.weapon === w.displayName);
          return (
            <button key={w.id} className={`sp-weapon${w.id === weapon ? ' on' : ''}`} onClick={() => setWeapon(w.id)}>
              <Icon name="target" size={18} />
              <span className="n-label">{w.displayName}</span>
              <span className={`chip num ${bad ? 'warn' : n === w.slots.length ? 'ok' : ''}`}>{n} / {w.slots.length}</span>
            </button>
          );
        })}
      </nav>

      <section className="sp-slots">{slotList}</section>

      {!mobile && (
        <aside className="sp-picker">
          <Picker weapon={weapon} slot={slot} prof={prof} p={p} onPick={assignEntry} />
        </aside>
      )}
      {mobile && pickerOpen && (
        <Sheet onClose={() => setPickerOpen(false)} title={<strong>{prof.displayName} · {prof.slots.find((s) => s.id === slot)?.label}</strong>}>
          <Picker weapon={weapon} slot={slot} prof={prof} p={p} onPick={assignEntry} />
        </Sheet>
      )}

      {history && (
        <Modal onClose={() => setHistory(false)}>
          <h3>Versionsverlauf</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Während du arbeitest, wird jede Minute ein Zwischenstand gespeichert. Beim Wiederherstellen wird der aktuelle Stand vorher gesichert.</p>
          {p.snapshots.length === 0 ? <p className="faint">Noch keine Zwischenstände.</p> : (
            <div className="recent-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {p.snapshots.map((s) => (
                <div key={s.at} className="recent-item" style={{ cursor: 'default' }}>
                  <div style={{ flex: 1 }}><div className="num" style={{ fontWeight: 600 }}>{new Date(s.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div><div className="faint small">{s.label} · {Object.values(s.weapons).reduce((n, w) => n + Object.keys(w ?? {}).length, 0)} Slots</div></div>
                  <Button size="sm" onClick={() => { set((x) => restoreSnapshot(x, s.at)); setHistory(false); toast('success', 'Zwischenstand wiederhergestellt'); }}>Wiederherstellen</Button>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><Button variant="ghost" onClick={() => setHistory(false)}>Schließen</Button></div>
        </Modal>
      )}
    </div>
  );
}

function SlotGroup(props: { title: string; note?: string; slots: WeaponProfile['slots']; p: Project; prof: WeaponProfile; sel: string; playingKey: string | null; onSelect: (id: string) => void; onDrop: (e: LibraryEntry, slot: string) => void; set: (fn: (x: Project) => Project) => void }) {
  if (!props.slots.length) return null;
  return (
    <div>
      <div className="section-title" style={{ margin: '0 0 8px' }}><h2>{props.title}</h2></div>
      {props.note && <div className="faint small" style={{ margin: '-4px 0 10px' }}>{props.note}</div>}
      <div className="sp-slot-grid">
        {props.slots.map((s) => <SlotCard key={s.id} {...props} slotId={s.id} label={s.label} required={s.required} />)}
      </div>
    </div>
  );
}

function SlotCard({ p, prof, slotId, label, required, sel, onSelect, onDrop, set, playingKey }: { p: Project; prof: WeaponProfile; slotId: string; label: string; required: boolean; sel: string; playingKey: string | null; onSelect: (id: string) => void; onDrop: (e: LibraryEntry, slot: string) => void; set: (fn: (x: Project) => Project) => void }) {
  const a = p.weapons[prof.id]?.[slotId];
  const e = a ? entryById(a.entryId) : undefined;
  const meta = useEntryMeta(e);
  const [over, setOver] = useState(false);
  const key = `${prof.id}:${slotId}`;
  const playing = usePlayingKey() === key || playingKey === key;
  const derivable = !a && DERIVE_FROM[slotId] && p.weapons[prof.id]?.[DERIVE_FROM[slotId]];
  const attachment = prof.attachments.find((x) => x.soundSlots.includes(slotId));
  // "lock-in" animation whenever a new sound lands in this slot
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(a?.entryId + (a?.derivedFrom ?? ''));
  const [lock, setLock] = useState(false);
  useEffect(() => {
    const cur = a?.entryId + (a?.derivedFrom ?? '');
    if (a && cur !== prev.current) { setLock(true); burstAt(ref.current, 28, 0.7); const t = setTimeout(() => setLock(false), 750); prev.current = cur; return () => clearTimeout(t); }
    prev.current = cur;
  }, [a?.entryId, a?.derivedFrom]);
  return (
    <div
      ref={ref}
      className={`sp-slot${sel === slotId ? ' sel' : ''}${over ? ' over' : ''}${a ? '' : ' empty'}${lock ? ' lock-in' : ''}${playing ? ' is-playing' : ''}`}
      onClick={() => onSelect(slotId)}
      onDragOver={(ev) => { if (ev.dataTransfer.types.includes('application/x-sptool-sound')) { ev.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(ev) => { ev.preventDefault(); setOver(false); const id = ev.dataTransfer.getData('application/x-sptool-sound'); const en = entryById(id); if (en) onDrop(en, slotId); }}
    >
      <div className="row" style={{ gap: 8 }}>
        <strong style={{ flex: 1 }}>{label}</strong>
        {attachment && <span className="chip">{attachment.label}</span>}
        {required && !a && <span className="chip warn">Pflicht</span>}
      </div>
      {a && e ? (
        <>
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <button className={`play-btn${playing ? ' playing' : ''}`} aria-label={`${label} abspielen`} onClick={(ev) => { ev.stopPropagation(); void playAssignment(key, a); }}><Icon name={playing ? 'stop' : 'play'} size={13} /></button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sp-sound-name">{e.name}</div>
              <div className="faint small">{a.derivedFrom ? `Abgeleitet von ${prof.slots.find((s) => s.id === a.derivedFrom)?.label}` : `${TYPE_LABEL[e.type]} · ${e.style}`}</div>
            </div>
          </div>
          {meta ? <MiniWave peaks={meta.peaks} height={30} /> : <div className="wave-skeleton" style={{ height: 30 }} />}
          <div className="row" style={{ gap: 4 }} onClick={(ev) => ev.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => onSelect(slotId)}>Ersetzen</Button>
            <Button size="sm" variant="ghost" onClick={() => openInEditor(e.id)}>Bearbeiten</Button>
            <span className="spacer" />
            <IconButton icon="x" title="Slot leeren" onClick={() => set((x) => assign(x, prof.id, slotId, null))} />
          </div>
        </>
      ) : (
        <div className="sp-empty">
          <span className="faint small">{derivable ? 'Leer – kann aus dem Schuss-Sound abgeleitet werden' : 'Zieh einen Sound hierher oder wähle einen aus'}</span>
          {derivable && <Button size="sm" variant="primary" onClick={() => set((x) => deriveSlot(x, prof.id, slotId))}>Ableiten</Button>}
        </div>
      )}
    </div>
  );
}

function Picker({ weapon, slot, prof, p, onPick }: { weapon: WeaponId; slot: string; prof: WeaponProfile; p: Project; onPick: (e: LibraryEntry) => void }) {
  const userEntries = useApp((s) => s.userEntries);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const label = prof.slots.find((s) => s.id === slot)?.label ?? slot;
  const fireStyle = (() => { const a = p.weapons[weapon]?.fire; return a ? entryById(a.entryId)?.style : undefined; })();
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let l = allEntries().filter((e) => (all || slotMatches(e, weapon, slot)) && words.every((w) => `${e.name} ${e.tags.join(' ')}`.toLowerCase().includes(w)));
    // smart recommendation (spec §115): same style as the chosen fire sound first
    if (fireStyle) l = [...l.filter((e) => e.style === fireStyle), ...l.filter((e) => e.style !== fireStyle)];
    return l.slice(0, 80);
  }, [q, all, weapon, slot, fireStyle, userEntries]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div><strong>{label}</strong><div className="faint small">{prof.displayName}{fireStyle ? ` · ${fireStyle}-Sounds zuerst` : ''}</div></div>
      <input className="input" placeholder="Sounds suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Sounds suchen" />
      <label className="row small muted" style={{ gap: 8 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Alle Sounds zeigen, nicht nur passende</label>
      <div className="recent-list">
        {list.length === 0 && <div className="faint small">Keine passenden Sounds. Probier „Alle Sounds zeigen“.</div>}
        {list.map((e) => <PickRow key={e.id} e={e} onPick={onPick} />)}
      </div>
    </div>
  );
}

function PickRow({ e, onPick }: { e: LibraryEntry; onPick: (e: LibraryEntry) => void }) {
  const meta = useEntryMeta(e);
  const playing = usePlayingKey() === e.id;
  return (
    <div className="recent-item" draggable onDragStart={(ev) => { ev.dataTransfer.setData('application/x-sptool-sound', e.id); ev.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onPick(e)}>
      <button className={`play-btn${playing ? ' playing' : ''}`} aria-label={`${e.name} abspielen`} onClick={(ev) => { ev.stopPropagation(); void previewEntry(e); }}><Icon name={playing ? 'stop' : 'play'} size={13} /></button>
      <div style={{ flex: 1, minWidth: 0 }}><div className="sp-sound-name">{e.name}</div><div className="faint small">{e.style}</div></div>
      <MiniWave peaks={meta?.peaks} height={24} />
    </div>
  );
}

