// Zuordnungs-Assistent (Admin/Developer): ordnet die Sounds eines geöffneten Packs per Gehör den Waffen-Slots zu –
// so schnell wie möglich: links der Ziel-Slot, rechts nur die wahrscheinlichen Kandidaten (Streams, die Creator in
// ihren Waffen-Packs ersetzt haben), Tastatur für alles. Die Zuordnung wird sofort gespeichert und kann mit einem
// Klick für alle SP-Tool-Nutzer veröffentlicht werden.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { engine } from '../audio/engine';
import { usePlayingKey } from '../audio/preview';
import { isAdmin, useAccount } from '../account/account';
import { toast } from '../app/store';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { streamToAudio, type AwcStream } from '../formats/awc';
import { CANDIDATES } from '../formats/candidates';
import { mappingOf, setStreamMapping, streamsFor, type Mapping } from '../formats/mapping';
import type { Pack } from '../formats/pack';
import type { CatalogEntry } from '../formats/mapping';
import type { WeaponId } from '../models/types';
import { publishMapping } from '../services/mappingSync';
import { WEAPON_PROFILES } from '../weapons/profiles';

const SHOT_SLOTS = /fire|suppress/;
const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

interface Row { gi: number; file: string; s: AwcStream; packs: number; shot: boolean; ms: number }

export function MapAssistant({ pack, catalogOf, mapping, setMapping, onClose }: {
  pack: Pack; catalogOf: Map<number, CatalogEntry | null>; mapping: Mapping; setMapping: (m: Mapping) => void; onClose: () => void;
}) {
  const admin = useAccount(isAdmin);
  const [weapon, setWeapon] = useState<WeaponId>(WEAPON_PROFILES[0].id as WeaponId);
  const prof = WEAPON_PROFILES.find((p) => p.id === weapon)!;
  const [slot, setSlot] = useState<string>(prof.slots[0].id);
  const [onlyCand, setOnlyCand] = useState(true);
  const [onlyFree, setOnlyFree] = useState(true);
  const [fitLen, setFitLen] = useState(true);
  const [autoPlay, setAutoPlay] = useState(true);
  const [idx, setIdx] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const playing = usePlayingKey();

  useEffect(() => { setSlot(prof.slots[0].id); }, [weapon]);

  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    pack.groups.forEach((g, gi) => {
      const ck = catalogOf.get(gi)?.key;
      if (!ck) return;
      const cand = new Map((CANDIDATES[ck] ?? []).map((c) => [c[0], c]));
      for (const s of g.awc.streams) {
        const c = cand.get(s.id);
        out.push({ gi, file: ck, s, packs: c?.[1] ?? 0, shot: !!c?.[2], ms: Math.round((s.format.samples / s.format.sampleRate) * 1000) });
      }
    });
    return out.sort((a, b) => b.packs - a.packs || a.file.localeCompare(b.file) || a.s.id - b.s.id);
  }, [pack, catalogOf]);

  const wantShot = SHOT_SLOTS.test(slot);
  const rows = useMemo(() => all.filter((r) => {
    const mp = mappingOf(mapping, r.file, r.s.id);
    if (onlyFree && mp && !(mp.weapon === weapon && mp.slot === slot)) return false;
    if (onlyCand && !r.packs) return false;
    if (fitLen && (wantShot ? r.ms < 120 : r.ms > 900)) return false;
    return true;
  }), [all, mapping, onlyFree, onlyCand, fitLen, wantShot, weapon, slot]);

  useEffect(() => { setIdx((i) => Math.min(i, Math.max(0, rows.length - 1))); }, [rows.length]);
  const cur = rows[idx];
  const keyOf = (r: Row) => `map:${r.file}:${r.s.id}`;
  const play = (r: Row | undefined, toggle = true) => {
    if (!r) return;
    if (toggle && engine.playingKey === keyOf(r)) { engine.stop(); return; }
    engine.play(streamToAudio(r.s), { key: keyOf(r) });
  };
  const move = (d: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, idx + d));
    setIdx(n);
    if (autoPlay) play(rows[n], false);
    listRef.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const assign = (r: Row | undefined) => {
    if (!r) return;
    setMapping(setStreamMapping(mapping, r.file, r.s.id, { weapon, slot }));
    move(1);
  };
  const unassign = (r: Row | undefined) => { if (r) setMapping(setStreamMapping(mapping, r.file, r.s.id, null)); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
      else if (e.key === ' ') { e.preventDefault(); play(cur); }
      else if (e.key === 'Enter') { e.preventDefault(); assign(cur); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); unassign(cur); }
      else if (/^[1-9]$/.test(e.key)) { const s = prof.slots[Number(e.key) - 1]; if (s) setSlot(s.id); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => () => engine.stop(), []);

  const totalSlots = WEAPON_PROFILES.reduce((n, p) => n + p.slots.length, 0);
  const doneSlots = WEAPON_PROFILES.reduce((n, p) => n + p.slots.filter((s) => streamsFor(mapping, p.id as WeaponId, s.id).length > 0).length, 0);
  const publish = async () => {
    setPublishing(true);
    try { const n = await publishMapping(mapping); toast('success', 'Zuordnung veröffentlicht', `${n} Sounds – alle SP-Tool-Nutzer bekommen sie beim nächsten Start.`); }
    catch (e) { toast('error', 'Veröffentlichen fehlgeschlagen', e instanceof Error ? e.message : String(e)); }
    finally { setPublishing(false); }
  };

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="map-assist" role="dialog" aria-modal="true" aria-label="Zuordnungs-Assistent">
        <header className="ma-head">
          <Icon name="target" size={18} />
          <div className="grow">
            <strong>Zuordnungs-Assistent</strong>
            <div className="faint small">Hör dir die Kandidaten an und ordne sie dem Slot links zu. {doneSlots} von {totalSlots} Slots haben mindestens einen Sound.</div>
          </div>
          <div className="ma-meter" aria-hidden="true"><i style={{ transform: `scaleX(${doneSlots / totalSlots})` }} /></div>
          {admin && <Button size="sm" variant="primary" icon="upload" disabled={publishing || !mapping.entries.length} onClick={() => void publish()}>{publishing ? 'Wird veröffentlicht…' : `Für alle veröffentlichen (${mapping.entries.length})`}</Button>}
          <button className="icon-btn" aria-label="Schließen" title="Schließen (Esc)" onClick={onClose}><Icon name="x" size={16} /></button>
        </header>
        <div className="ma-body">
          <aside className="ma-slots">
            <div className="seg ma-weapons">
              {WEAPON_PROFILES.map((p) => <button key={p.id} className={p.id === weapon ? 'on' : ''} onClick={() => setWeapon(p.id as WeaponId)}>{p.displayName}</button>)}
            </div>
            {prof.slots.map((s, i) => {
              const n = streamsFor(mapping, weapon, s.id).length;
              return (
                <button key={s.id} className={`ma-slot${s.id === slot ? ' on' : ''}${n ? ' done' : ''}`} onClick={() => setSlot(s.id)}>
                  <kbd>{i + 1}</kbd><span className="grow">{s.label}</span>
                  <span className="ma-count">{n ? <><Icon name="check" size={12} />{n}</> : '–'}</span>
                </button>
              );
            })}
            <div className="ma-keys faint small">
              <div><kbd>↑</kbd><kbd>↓</kbd> nächster Sound (spielt automatisch)</div>
              <div><kbd>Leertaste</kbd> abspielen / stoppen</div>
              <div><kbd>Enter</kbd> dem Slot zuordnen</div>
              <div><kbd>Entf</kbd> Zuordnung entfernen</div>
              <div><kbd>1</kbd>–<kbd>9</kbd> Slot wählen</div>
            </div>
          </aside>
          <section className="ma-list-wrap">
            <div className="ma-filters">
              <label><input type="checkbox" checked={onlyCand} onChange={(e) => setOnlyCand(e.target.checked)} />Nur Waffensounds (von Creatorn ersetzt)</label>
              <label><input type="checkbox" checked={fitLen} onChange={(e) => setFitLen(e.target.checked)} />Nur passende Länge ({wantShot ? 'Schüsse ≥ 0,12 s' : 'Mechanik ≤ 0,9 s'})</label>
              <label><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />Bereits zugeordnete ausblenden</label>
              <label><input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />Automatisch abspielen</label>
              <span className="grow" /><span className="faint small">{rows.length} Sounds</span>
            </div>
            <div className="ma-list" ref={listRef}>
              {rows.length === 0 && <div className="faint small" style={{ padding: 20 }}>Keine Sounds mit diesen Filtern. Schalte einen Filter aus.</div>}
              {rows.map((r, i) => {
                const mp = mappingOf(mapping, r.file, r.s.id);
                const mine = mp && mp.weapon === weapon && mp.slot === slot;
                return (
                  <div key={`${r.file}:${r.s.id}`} data-i={i} className={`ma-row${i === idx ? ' sel' : ''}${mine ? ' mine' : ''}`} onClick={() => { setIdx(i); if (autoPlay) play(r, false); }}>
                    <button className={`play-btn${playing === keyOf(r) ? ' playing' : ''}`} aria-label="Abspielen" onClick={(e) => { e.stopPropagation(); setIdx(i); play(r); }}><Icon name={playing === keyOf(r) ? 'stop' : 'play'} size={12} /></button>
                    <span className="num ma-id">{r.file} · {hex(r.s.id)}</span>
                    <span className="num faint">{(r.ms / 1000).toFixed(2)} s</span>
                    {r.packs > 0 && <span className="chip" title="So viele der 6 analysierten Packs ersetzen diesen Sound">{r.packs}/6 Packs</span>}
                    {r.shot && <span className="chip accent">klingt nach Schuss</span>}
                    <span className="grow" />
                    {mp && <span className={`chip ${mine ? 'ok' : ''}`}>{WEAPON_PROFILES.find((p) => p.id === mp.weapon)?.displayName} · {WEAPON_PROFILES.find((p) => p.id === mp.weapon)?.slots.find((s) => s.id === mp.slot)?.label ?? mp.slot}</span>}
                    {mine ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); unassign(r); }}>Entfernen</Button>
                      : <Button size="sm" onClick={(e) => { e.stopPropagation(); setIdx(i); assign(r); }}>Zuordnen</Button>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
