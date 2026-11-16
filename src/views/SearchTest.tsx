// Suchtest im Spiel: round 0 lets EVERY sound of the pack beep (does the game read the files at all?), then each
// round splits the remaining sounds into 6 beep patterns until each pistol's shot is found. No guessing.
import { useState } from 'react';
import { isAdmin, useAccount } from '../account/account';
import { navigate, setState, toast } from '../app/store';
import { BasePicker, useBase } from '../components/BasePicker';
import { Icon } from '../components/Icon';
import { Button, DoneMark } from '../components/ui';
import { loadMapping, saveMapping } from '../formats/mapping';
import { active, applyRound, applySearch, buildRound, EVENTS, isFound, loadSearch, PATTERNS, saveSearch, splitTarget, startSearch, targetsFor, type SearchEvent, type SearchState } from '../projects/searchTest';
import { publishMapping } from '../services/mappingSync';
import { saveToDownloads, showDownloads } from '../services/downloads';
import { showSfxFolder } from '../services/modsCheck';
import { logger } from '../services/logger';
import { WEAPON_PROFILES } from '../weapons/profiles';
import type { WeaponId } from '../models/types';

const WEAPONS = WEAPON_PROFILES.map((w) => w.id as WeaponId);
const wName = (w: string) => WEAPON_PROFILES.find((p) => p.id === w)?.displayName ?? w;
/** "pistol50:reload" → "Pistol .50 · Nachladen"; a global event (kill) → "Kill-Sound (alle Waffen)" */
const label = (t: string) => {
  const { weapon, event } = splitTarget(t), ev = EVENTS.find((e) => e.id === event);
  return ev?.global ? `${ev.label} (alle Waffen)` : `${wName(weapon)} · ${ev?.label ?? event}`;
};

export function SearchTest({ busy, setBusy }: { busy: string | null; setBusy: (s: string | null) => void }) {
  const admin = useAccount(isAdmin);
  const base = useBase();
  const [st, setSt] = useState<SearchState | null>(() => loadSearch());
  const [built, setBuilt] = useState(false);
  const [heard, setHeard] = useState<Record<string, number[]>>({});
  const [done, setDone] = useState<{ found: string[]; published: number | null } | null>(null);
  const [events, setEvents] = useState<SearchEvent[]>(['fire', 'suppressed_fire', 'reload']);
  const targets = () => targetsFor(WEAPONS, events);
  const set = (s: SearchState | null) => { setSt(s); saveSearch(s); };

  const build = async (s: SearchState) => {
    if (!base) return;
    setBusy(`Runde ${s.round + 1} wird gebaut…`);
    try {
      const r = buildRound(base.pack, s);
      const next = { ...s, patterns: r.patterns, exact: r.exact };
      set(next);
      const saved = await saveToDownloads(`Suchtest Runde ${s.round + 1}`, r.outputs);
      toast('info', `Runde ${s.round + 1} gespeichert`, `${saved.zip} – die zwei Dateien in GTA V › x64 › audio › sfx ersetzen.`);
      if (saved.dir) void showDownloads();
      logger.info(`Suchtest Runde ${s.round + 1}: ${r.count} Sounds piepen`);
      setHeard({}); setBuilt(true);
    } catch (e) { toast('error', 'Testpack fehlgeschlagen', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const next = async () => {
    if (!st || !base) return;
    const after = applyRound(base.pack, st, st.patterns, heard);
    logger.info(`Suchtest Runde ${st.round + 1} gehört: ${JSON.stringify(heard)} → ${after.weapons.map((w) => `${w}=${after.notLoaded.includes(w) ? 'nicht geladen' : after.sets[w]?.length ?? 'alle'}`).join(', ')}`);
    set(after); setBuilt(false);
    if (!active(after).length) return;
    await build(after);
  };

  const finish = async (publish: boolean) => {
    if (!st) return;
    const r = applySearch(loadMapping(), st);
    saveMapping(r.mapping);
    let published: number | null = null;
    if (publish) {
      setBusy('Wird veröffentlicht…');
      try { published = await publishMapping(r.mapping); } catch (e) { toast('error', 'Veröffentlichen fehlgeschlagen', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
    }
    logger.info(`Suchtest gespeichert: ${r.weapons.join(', ')}`);
    setDone({ found: r.weapons.map(label), published });
    set(null);
  };

  if (done) return (
    <div className="qp-done">
      <DoneMark />
      <h3 style={{ margin: '8px 0 2px' }}>Gefunden: {done.found.join(', ') || 'nichts'}</h3>
      <p className="muted" style={{ marginTop: 0 }}>Gespeichert{done.published !== null ? ` und an alle SP-Tool-Nutzer geschickt (${done.published}).` : '.'} Erstell dein Soundpack jetzt neu – dann landen deine Sounds genau dort, wo das Spiel sie abspielt.</p>
      <p className="small faint">Leg danach wieder deine eigenen Dateien (oder die Originale) in den sfx-Ordner.</p>
      <Button variant="primary" onClick={() => { setState({ gameTestOpen: false }); navigate('create'); }}>Soundpack erstellen</Button>
    </div>
  );

  // not started (or nothing built yet for the saved round)
  if (!st || (!built && active(st).length && st.round === 0)) return <>
    <p className="muted" style={{ marginTop: 0 }}>
      Findet heraus, welche Sounds das Spiel <b>wirklich</b> für jede Pistole abspielt. <b>Runde 1:</b> Jeder Sound im Pack piept – so siehst du sofort, ob dein Spiel die Dateien überhaupt liest.
      Danach piept jede Runde anders (1–3×, hoch oder tief), du klickst an, was du gehört hast, und nach 5–6 Runden ist alles gefunden – für alle drei Pistolen gleichzeitig.
    </p>
    <div className="qp-label">Was soll gesucht werden?</div>
    <div className="seg" style={{ marginBottom: 12 }}>
      {EVENTS.map((e) => <button key={e.id} aria-pressed={events.includes(e.id)} className={events.includes(e.id) ? 'on' : ''} onClick={() => setEvents((x) => x.includes(e.id) ? x.filter((y) => y !== e.id) : [...x, e.id])}>{e.label}</button>)}
    </div>
    <div className="qp-label">Vorlage (dein Soundpack)</div>
    <BasePicker />
    <div className="row" style={{ marginTop: 16, gap: 10 }}>
      <span className="grow small muted">{busy ?? 'Jede Runde kommt als ZIP in deine Downloads.'}</span>
      <Button variant="primary" size="lg" icon="download" disabled={!base || !!busy || !events.length} onClick={() => void build(st ?? startSearch(targets()))}>Runde 1 erstellen</Button>
    </div>
  </>;

  const searching = active(st);
  if (!searching.length) {
    const found = st.weapons.filter((w) => isFound(st, w));
    const lost = st.weapons.filter((w) => !st.notLoaded.includes(w) && !isFound(st, w));
    return <>
      {st.notLoaded.length === st.weapons.length ? (
        <div className="callout danger small" style={{ textAlign: 'left' }}><Icon name="alert" size={16} /><div>
          <b>Dein Spiel liest die Dateien nicht.</b> Obwohl jeder Sound im Pack piept, klang alles normal. Das liegt nicht an deinen Sounds:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Liegen <b>WEAPONS_PLAYER.rpf</b> und <b>RESIDENT.rpf</b> wirklich direkt in <span className="mono">GTA V\x64\audio\sfx</span> (ersetzt, nicht daneben)? „Prüfen“ nach dem Erstellen zeigt es dir.</li>
            <li>Liegt im <b>FiveM-mods-Ordner</b> (<span className="mono">%localappdata%\FiveM\FiveM.app\mods</span>) noch ein anderes Soundpack? Das gewinnt immer gegen den sfx-Ordner – raus damit.</li>
            <li>War FiveM beim Kopieren noch offen? Ganz schließen und neu starten.</li>
            <li>Teste im <b>Story Mode</b> von FiveM statt auf einem Server.</li>
          </ul>
        </div></div>
      ) : <>
        {found.length > 0 && <div className="callout info small" style={{ textAlign: 'left' }}><Icon name="check" size={16} /><div><b>Gefunden: {found.map(label).join(', ')}.</b></div></div>}
        {st.notLoaded.length > 0 && <div className="callout small" style={{ textAlign: 'left' }}><Icon name="alert" size={16} /><div><b>{st.notLoaded.map(label).join(', ')}</b> klang auch in Runde 1 normal – diese Sounds liegen nicht in WEAPONS_PLAYER.rpf / RESIDENT.rpf deiner Vorlage (oder der Server bringt eigene mit).</div></div>}
        {lost.length > 0 && <div className="callout small" style={{ textAlign: 'left' }}><Icon name="alert" size={16} /><div><b>{lost.map(label).join(', ')}</b>: keine Übereinstimmung mehr – vermutlich falsch angeklickt. Starte den Suchtest neu.</div></div>}
      </>}
      <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => { set(null); setBuilt(false); }}>Neu starten</Button>
        <span className="grow" />
        {found.length > 0 && <Button disabled={!!busy} onClick={() => void finish(false)}>Speichern</Button>}
        {found.length > 0 && admin && <Button variant="primary" icon="upload" disabled={!!busy} onClick={() => void finish(true)}>Speichern & an alle senden</Button>}
      </div>
    </>;
  }

  const r0 = st.round === 0;
  const ready = searching.every((w) => heard[w] !== undefined);
  const evs = [...new Set(st.weapons.map((t) => splitTarget(t).event))];
  const toggle = (w: string, p: number) => setHeard((h) => { const cur = h[w] ?? []; return { ...h, [w]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] }; });
  return <>
    <div className="row" style={{ gap: 8, marginBottom: 8 }}><span className="chip accent">Runde {st.round + 1}</span>{!built && <span className="small muted">Testpack dieser Runde noch nicht erstellt</span>}</div>
    <ol className="gt-steps muted">
      <li><b>FiveM ganz schließen.</b></li>
      <li>Aus <b>Suchtest Runde {st.round + 1}.zip</b> beide Dateien in deinen sfx-Ordner ziehen und <b>ersetzen</b>. <button className="link" onClick={() => void showSfxFolder()}>sfx-Ordner öffnen</button></li>
      <li>FiveM starten – am besten <b>Story Mode</b> – und mit jeder Pistole: {EVENTS.filter((e) => evs.includes(e.id) && !e.global).map((e) => e.action).join(' · ')}.{EVENTS.filter((e) => evs.includes(e.id) && e.global).map((e) => <span key={e.id}> <b>{e.label}:</b> {e.action}.</span>)}</li>
      <li>{r0 ? 'Anklicken, ob es gepiept hat.' : <>Alles anklicken, was du gehört hast – wenn es sich zwischen den Schüssen ändert, mehrere. Beim <b>Nachladen</b> in der Reihenfolge, in der die Pieptöne kamen.</>}</li>
    </ol>
    <div className="gt-questions">
      {searching.map((w) => (
        <div key={w} className="gt-q" style={{ flexWrap: 'wrap' }}>
          <b className="grow">{label(w)}{!r0 && <span className="small muted"> · noch {st.sets[w]?.length ?? '?'} Sounds</span>}</b>
          <div className="seg" role="group" aria-label={label(w)} style={{ flexWrap: 'wrap' }}>
            {r0 ? <>
              <button className={heard[w]?.length ? 'on' : ''} onClick={() => setHeard((h) => ({ ...h, [w]: [0] }))}>Piept</button>
              <button className={heard[w] && !heard[w].length ? 'on' : ''} onClick={() => setHeard((h) => ({ ...h, [w]: [] }))}>{splitTarget(w).event === 'kill' ? 'Kein Piep beim Kill' : 'Normaler Schuss'}</button>
            </> : <>
              {PATTERNS.map((p, i) => <button key={p.label} aria-pressed={!!heard[w]?.includes(i)} className={heard[w]?.includes(i) ? 'on' : ''} onClick={() => toggle(w, i)}>{splitTarget(w).event === 'reload' && heard[w]?.includes(i) ? `${heard[w].indexOf(i) + 1}. ` : ''}{p.label}</button>)}
              <button className={heard[w] && !heard[w].length ? 'on' : ''} onClick={() => setHeard((h) => ({ ...h, [w]: [] }))}>Weiß nicht</button>
            </>}
          </div>
        </div>
      ))}
    </div>
    <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
      <Button variant="ghost" disabled={!!busy} onClick={() => { set(null); setBuilt(false); }}>Abbrechen</Button>
      <span className="grow small muted">{busy ?? ''}</span>
      {!built && <Button disabled={!base || !!busy} onClick={() => void build(st)}>Testpack Runde {st.round + 1} erstellen</Button>}
      <Button variant="primary" disabled={!ready || !!busy || !base} onClick={() => void next()}>Weiter</Button>
    </div>
  </>;
}
