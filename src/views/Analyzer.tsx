// Pack Analyzer (spec §109–111): open an existing soundpack archive, inspect its containers,
// listen to and extract every stream, and replace streams with same-size patching.
// The opened file is only read; exports are always written as a new copy.
import { useMemo, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { usePlayingKey } from '../audio/preview';
import { audioWorker } from '../audio/workerClient';
import { navigate, notify, toast, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { Button, EmptyState, IconButton, Modal, fmtDur } from '../components/ui';
import { useIsMobile } from '../components/mobile';
import { fitStreamAudio, streamToAudio, type AwcStream } from '../formats/awc';
import { KNOWN_STREAM_NAMES } from '../formats/knownNames';
import { exportPack, openPack, type Pack } from '../formats/pack';
import { canonicalArchiveName } from '../services/install';
import { saveToDownloads, showDownloads } from '../services/downloads';
import { loadMapping, mappingOf, matchCatalog, saveMapping, setStreamMapping, parseMapping, type Mapping } from '../formats/mapping';
import { setBasePack } from '../projects/build';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { useCan } from '../account/perms';
import type { WeaponId } from '../models/types';
import { allEntries, getAudio } from '../library/assets';
import { importWavFiles } from '../library/actions';
import type { LibraryEntry } from '../models/types';
import { TYPE_LABEL, WEAPON_LABEL } from '../models/types';
import { logger } from '../services/logger';
import { saveBytes } from '../services/tauri';
import { MapAssistant } from './MapAssistant';
import { openGameTest } from './GameTest';

interface Replacement { stream: AwcStream; source: string; truncated: boolean; padded: boolean }
const key = (ci: number, id: number) => `${ci}:${id}`;
const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;
const fmtMB = (b: number) => (b > 1e6 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

export function AnalyzerView() {
  const dev = useApp((s) => s.settings.devMode);
  const canMap = useCan('devMode'); // Developer + Admin: create the stream → slot mapping by ear
  const [mapping, setMappingState] = useState<Mapping>(() => loadMapping());
  const mapRef = useRef<HTMLInputElement>(null);
  const setMapping = (m: Mapping) => { setMappingState(m); saveMapping(m); };
  const exportMapping = async () => {
    const path = await saveBytes('sptool-mapping.json', new TextEncoder().encode(JSON.stringify({ ...mapping, updatedAt: Date.now() }, null, 2)), { name: 'SP-Tool-Zuordnung', extensions: ['json'] });
    if (path) toast('success', 'Zuordnung exportiert', `${mapping.entries.length} Sound${mapping.entries.length === 1 ? '' : 's'} zugeordnet – schick diese Datei ans SP-Tool-Team, damit sie für alle ausgeliefert wird.`);
  };
  const importMapping = async (f: File | undefined) => {
    if (!f) return;
    try { const m = parseMapping(JSON.parse(await f.text())); setMapping(m); toast('success', 'Zuordnung importiert', `${m.entries.length} zugeordnete Sound${m.entries.length === 1 ? '' : 's'}`); }
    catch (e) { toast('error', 'Zuordnung konnte nicht importiert werden', e instanceof Error ? e.message : String(e)); }
  };
  const slotOptions = WEAPON_PROFILES.flatMap((p) => p.slots.map((s) => ({ value: `${p.id}:${s.id}`, label: `${p.displayName} · ${s.label}` })));
  const labelOf = (weapon: string, slot: string) => slotOptions.find((o) => o.value === `${weapon}:${slot}`)?.label ?? `${weapon} · ${slot}`;
  const [pack, setPack] = useState<Pack | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repl, setRepl] = useState<Map<string, Replacement>>(new Map());
  const [picker, setPicker] = useState<{ ci: number; stream: AwcStream } | null>(null);
  const [assist, setAssist] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const playing = usePlayingKey();
  const mobile = useIsMobile();
  const catalogOf = useMemo(() => new Map((pack?.groups ?? []).map((g, i) => [i, matchCatalog(g.awc)])), [pack]);

  /** Opens one or more archives of the same pack together (e.g. WEAPONS_PLAYER + RESIDENT). */
  const open = async (files: File[]) => {
    setBusy(true); setError(null); setRepl(new Map()); setSel(0);
    try {
      const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      await new Promise((r) => setTimeout(r, 0));
      const p = openPack(loaded);
      setPack(p);
      for (const a of p.archives) logger.info(`Analyzed ${a.name}: RPF7 ${a.header.encryption.toUpperCase()}, ${a.header.entryCount} entries, ${a.containers.length} readable AWC containers`);
      const shared = p.groups.filter((g) => g.refs.length > 1).length;
      if (shared) logger.info(`${shared} container(s) are stored identically in more than one archive – they are always patched together`);
    } catch (e) {
      setPack(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const found = pack?.groups ?? [];
  const totalStreams = found.reduce((s, a) => s + a.awc.streams.length, 0);
  const cur = found[sel];
  const archivesOf = (gi: number) => [...new Set(found[gi].refs.map((r) => pack!.archives[r.archive].name.replace(/\.rpf$/i, '')))];

  const play = (ci: number, s: AwcStream) => {
    const k = `an:${key(ci, s.id)}`;
    if (engine.playingKey === k) { engine.stop(); return; }
    const r = repl.get(key(ci, s.id));
    engine.play(streamToAudio(r ? r.stream : s), { key: k });
  };
  const nameOf = (ci: number, s: AwcStream) => KNOWN_STREAM_NAMES.get(s.id) ?? `${archivesOf(ci)[0]}_c${String(ci).padStart(2, '0')}_${hex(s.id)}`;
  const exportWav = async (ci: number, s: AwcStream) => {
    const bytes = await audioWorker.encode(streamToAudio(s), 16);
    const path = await saveBytes(`${nameOf(ci, s)}.wav`, bytes, { name: 'WAV-Audio', extensions: ['wav'] });
    if (path) toast('success', 'WAV extrahiert', path);
  };
  const addToLibrary = async (ci: number, s: AwcStream) => {
    const bytes = await audioWorker.encode(streamToAudio(s), 16);
    await importWavFiles([new File([new Uint8Array(bytes)], `${nameOf(ci, s)}.wav`, { type: 'audio/wav' })]);
  };
  const extractAll = async () => {
    if (!cur) return;
    for (const s of cur.awc.streams) await addToLibrary(sel, s);
  };

  const replaceWith = async (e: LibraryEntry) => {
    if (!picker) return;
    try {
      const audio = await getAudio(e);
      const { stream, truncated, padded } = fitStreamAudio(picker.stream, audio);
      setRepl((m) => new Map(m).set(key(picker.ci, picker.stream.id), { stream, source: e.name, truncated, padded }));
      toast('success', 'Stream ersetzt', `${e.name}${truncated ? ' – passend gekürzt' : padded ? ' – mit Stille aufgefüllt' : ''}`);
      setPicker(null);
    } catch (err) {
      toast('error', 'Stream konnte nicht ersetzt werden', err instanceof Error ? err.message : String(err));
    }
  };

  const exportPatched = async () => {
    if (!pack || !repl.size) return;
    setBusy(true);
    try {
      const byGroup = new Map<number, Map<number, AwcStream>>();
      for (const [k, r] of repl) {
        const [gi, sid] = k.split(':').map(Number);
        if (!byGroup.has(gi)) byGroup.set(gi, new Map());
        byGroup.get(gi)!.set(sid, r.stream);
      }
      const outs = exportPack(pack, byGroup);
      const saved = await saveToDownloads('Eigenes Pack', outs.map((o) => ({ name: canonicalArchiveName(o.name), bytes: o.bytes })));
      if (saved.dir) void showDownloads();
      {
        toast('success', 'Gepatchte Kopie als ZIP gespeichert', `${saved.zip} ${saved.dir ? 'liegt in Downloads › SP Tool' : 'liegt in deinem Download-Ordner'} – die Dateien darin direkt in GTA V › x64 › audio › sfx ziehen (kein Unterordner), dann FiveM neu starten.`);
        notify('Gepatchtes Pack exportiert', `${repl.size} Stream(s) ersetzt in ${outs.map((o) => o.name).join(' + ')}`);
        logger.info(`Exported patched pack: ${outs.map((o) => `${o.name} (${o.patchedContainers} container copies)`).join(', ')}`);
      }
    } catch (e) {
      toast('error', 'Export fehlgeschlagen', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!pack) {
    return (
      <div className="page" style={{ maxWidth: 860 }}>
        <input ref={inputRef} type="file" accept=".rpf" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void open(f); }} />
        <EmptyState icon="box" title="Soundpack analysieren" body="Öffne alle .rpf-Archive eines Packs zusammen – zum Beispiel WEAPONS_PLAYER.rpf und RESIDENT.rpf. SP Tool listet jeden Audio-Container und Stream auf und findet Container, die in mehreren Archiven vorkommen, damit sie immer gemeinsam geändert werden. Die Dateien werden nur gelesen."
          action={<Button variant="primary" icon="upload" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Wird gelesen…' : '.rpf-Archive öffnen'}</Button>} />
        {error && <div className="callout"><Icon name="alert" size={18} /><div><strong>Diese Datei konnte nicht analysiert werden.</strong><div className="muted small">{error}</div></div></div>}
      </div>
    );
  }

  const sharedCount = found.filter((g) => g.refs.length > 1).length;
  return (
    <div className="lib analyzer">
      <aside className="lib-filters">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong style={{ flex: 1 }}>{pack.archives.length} Archiv{pack.archives.length > 1 ? 'e' : ''}</strong>
          <IconButton icon="x" title="Pack schließen" onClick={() => { engine.stop(); setPack(null); }} />
        </div>
        {pack.archives.map((a) => (
          <div key={a.name} className="panel" style={{ padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</div>
            <div className="faint small">RPF7 · {a.header.encryption.toUpperCase()} · {a.header.entryCount} Einträge · {fmtMB(a.bytes.byteLength)}</div>
            <div className="faint small">{a.containers.length} lesbare{a.containers.length === 1 ? 'r' : ''} Container{a.header.entryCount - 1 - a.containers.length > 0 ? ` · ${a.header.entryCount - 1 - a.containers.length} verschlüsselt` : ''}</div>
          </div>
        ))}
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>Eindeutige Container</dt><dd>{found.length}</dd>
          <dt>Streams</dt><dd>{totalStreams}</dd>
          <dt>In mehreren Archiven</dt><dd>{sharedCount}</dd>
        </dl>
        {sharedCount > 0 && (
          <div className="callout info small" style={{ marginTop: 12 }}>
            <Icon name="layers" size={16} />
            <div>{sharedCount} Container {sharedCount > 1 ? 'sind' : 'ist'} in mehr als einem Archiv gespeichert. Wenn du dort einen Sound ersetzt, wird jede Kopie gepatcht – so greift das Spiel nie auf eine alte Kopie zurück.</div>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}><Button size="sm" icon="plus" onClick={() => inputRef.current?.click()}>Archiv hinzufügen</Button></div>
        <input ref={inputRef} type="file" accept=".rpf" multiple hidden onChange={async (e) => {
          const f = Array.from(e.target.files ?? []); e.target.value = '';
          if (!f.length) return;
          if (repl.size) { toast('warning', 'Exportiere oder verwirf zuerst deine Ersetzungen', 'Beim Hinzufügen von Archiven wird das Pack zurückgesetzt.'); return; }
          const existing = pack.archives.map((a) => new File([new Uint8Array(a.bytes)], a.name));
          void open([...existing, ...f.filter((x) => !pack.archives.some((a) => a.name === x.name))]);
        }} />
        <div className="f-title" style={{ marginTop: 18 }}>Container</div>
        {found.map((c, i) => {
          const n = [...repl.keys()].filter((k) => k.startsWith(`${i}:`)).length;
          const known = c.awc.streams.filter((s) => KNOWN_STREAM_NAMES.has(s.id)).length;
          return (
            <button key={c.id} className={`nav-item${sel === i ? ' active' : ''}`} style={{ padding: '7px 10px' }} onClick={() => setSel(i)}>
              <Icon name="box" size={15} />
              <span className="n-label">{catalogOf.get(i)?.key ?? `#${String(i).padStart(2, '0')}`} · {c.awc.streams.length} Stream{c.awc.streams.length === 1 ? '' : 's'}</span>
              <span className="soon">{n ? `${n} ersetzt` : (() => { const ck = catalogOf.get(i)?.key; const mc = ck ? c.awc.streams.filter((s) => mappingOf(mapping, ck, s.id)).length : 0; return mc ? `${mc} zugeordnet` : c.refs.length > 1 ? `in ${new Set(c.refs.map((r) => r.archive)).size} Archiven` : known ? `${known} benannt` : fmtMB(c.length); })()}</span>
            </button>
          );
        })}
      </aside>
      <section className="lib-center">
        <div className="lib-toolbar">
          {mobile ? (
            <select className="select" style={{ flex: '1 1 100%' }} value={sel} onChange={(e) => setSel(Number(e.target.value))} aria-label="Container">
              {found.map((c, i) => <option key={c.id} value={i}>#{String(i).padStart(2, '0')} · {c.awc.streams.length} Stream{c.awc.streams.length === 1 ? '' : 's'}{[...repl.keys()].some((k) => k.startsWith(`${i}:`)) ? ' · ersetzt' : ''}</option>)}
            </select>
          ) : <strong>{catalogOf.get(sel) ? `Originaldatei ${catalogOf.get(sel)!.key}` : `Container #${String(sel).padStart(2, '0')}`}</strong>}
          {catalogOf.get(sel) && <span className="chip" title="Wie viele der 12 analysierten Creator-Archive diese Spieldatei ersetzen">in {catalogOf.get(sel)!.seenIn}/12 Packs</span>}
          <span className="faint small">{cur.awc.streams.length} Streams · {fmtMB(cur.length)}{cur.refs.length > 1 ? ` · in ${archivesOf(sel).join(' + ')}` : ` · ${archivesOf(sel)[0]}`}{dev ? ` · Offsets ${cur.refs.map((r) => r.offset).join(', ')}` : ''}</span>
          <span className="spacer" />
          {canMap && <>
            <input ref={mapRef} type="file" accept=".json" hidden onChange={(e) => { void importMapping(e.target.files?.[0]); e.target.value = ''; }} />
            <Button size="sm" variant="primary" icon="target" onClick={() => setAssist(true)}>Zuordnungs-Assistent</Button>
            <Button size="sm" icon="gamepad" onClick={openGameTest}>Im Spiel testen</Button>
            <Button size="sm" variant="ghost" icon="upload" onClick={() => mapRef.current?.click()}>Zuordnung importieren</Button>
            <Button size="sm" variant="ghost" icon="export" disabled={!mapping.entries.length} onClick={() => void exportMapping()}>Zuordnung exportieren ({mapping.entries.length})</Button>
          </>}
          <Button size="sm" icon="hammer" onClick={() => { setBasePack(pack); navigate('build'); }}>Zum Bauen verwenden</Button>
          <Button size="sm" icon="download" onClick={() => void extractAll()}>Alle zur Bibliothek hinzufügen</Button>
          <Button size="sm" variant="primary" icon="download" disabled={!repl.size || busy} onClick={() => void exportPatched()}>Als ZIP speichern{repl.size ? ` (${repl.size})` : ''}</Button>
        </div>
        <div className="lib-scroll">
          {canMap && mapping.entries.length < 10 && (
            <div className="callout small" style={{ marginTop: 0, marginBottom: 14 }}>
              <Icon name="target" size={16} />
              <div><strong>Wichtig: Noch fast keine Sounds zugeordnet.</strong> Ohne Zuordnung kann „Bauen“ keinen Spielsound ersetzen. Der Zuordnungs-Assistent zeigt dir nur die wahrscheinlichen Waffensounds – hören, Enter drücken, weiter.
                <div style={{ marginTop: 8 }}><Button size="sm" variant="primary" icon="target" onClick={() => setAssist(true)}>Zuordnungs-Assistent öffnen</Button></div></div>
            </div>
          )}
          <div className="callout info small" style={{ marginTop: 0, marginBottom: 14 }}>
            <Icon name="info" size={16} />
            <div>Ersetzungen behalten die Originallänge, Abtastrate und Spiel-Lautstärke jedes Streams, damit das Archiv gültig bleibt. Längere Sounds werden mit Ausblenden gekürzt, kürzere mit Stille aufgefüllt. Der Export ist eine neue Datei – installiere sie erst, nachdem du sie im Spiel geprüft hast.</div>
          </div>
          <div className="recent-list">
            {cur.awc.streams.map((s) => {
              const r = repl.get(key(sel, s.id));
              const k = `an:${key(sel, s.id)}`;
              const known = KNOWN_STREAM_NAMES.get(s.id);
              return (
                <div key={s.id} className="recent-item" style={{ cursor: 'default' }}>
                  <button className={`play-btn${playing === k ? ' playing' : ''}`} aria-label="Abspielen" onClick={() => play(sel, s)}><Icon name={playing === k ? 'stop' : 'play'} size={13} /></button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{known ?? hex(s.id)}{r && <span className="chip accent" style={{ marginLeft: 8 }}>→ {r.source}</span>}
                      {(() => { const ck = catalogOf.get(sel)?.key; const mp = ck ? mappingOf(mapping, ck, s.id) : null; return mp && !canMap ? <span className="chip ok" style={{ marginLeft: 8 }}>{labelOf(mp.weapon, mp.slot)}</span> : null; })()}</div>
                    <div className="faint small num">
                      {fmtDur(s.format.samples / s.format.sampleRate)} · {(s.format.sampleRate / 1000).toFixed(1)} kHz · Headroom {(s.format.headroom / 100).toFixed(2)} dB
                      {s.format.loopPoint >= 0 ? ' · Schleife' : ''}{known && dev ? ` · ${hex(s.id)}` : ''}
                      {r?.truncated ? ' · neuer Sound gekürzt' : r?.padded ? ' · neuer Sound aufgefüllt' : ''}
                    </div>
                  </div>
                  <div className="row an-stream-actions" style={{ gap: 4 }}>
                  {canMap && catalogOf.get(sel) && (() => {
                    const ck = catalogOf.get(sel)!.key; const mp = mappingOf(mapping, ck, s.id);
                    return (
                      <select className={`select map-select${mp ? ' on' : ''}`} aria-label="Waffen-Slot" value={mp ? `${mp.weapon}:${mp.slot}` : ''}
                        onChange={(e) => { const [w, sl] = e.target.value.split(':'); setMapping(setStreamMapping(mapping, ck, s.id, e.target.value ? { weapon: w as WeaponId, slot: sl } : null)); }}>
                        <option value="">Nicht zugeordnet</option>
                        {slotOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    );
                  })()}
                  <IconButton icon="export" title="WAV extrahieren" onClick={() => void exportWav(sel, s)} />
                  <IconButton icon="plus" title="Zur Bibliothek hinzufügen" onClick={() => void addToLibrary(sel, s)} />
                  {r ? <Button size="sm" variant="ghost" onClick={() => setRepl((m) => { const n = new Map(m); n.delete(key(sel, s.id)); return n; })}>Verwerfen</Button>
                    : <Button size="sm" onClick={() => setPicker({ ci: sel, stream: s })}>Ersetzen…</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {assist && <MapAssistant pack={pack} catalogOf={catalogOf} mapping={mapping} setMapping={setMapping} onClose={() => { engine.stop(); setAssist(false); }} />}
      {picker && <ReplacePicker stream={picker.stream} onPick={(e) => void replaceWith(e)} onClose={() => setPicker(null)} />}
    </div>
  );
}

function ReplacePicker({ stream, onPick, onClose }: { stream: AwcStream; onPick: (e: LibraryEntry) => void; onClose: () => void }) {
  const userEntries = useApp((s) => s.userEntries);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return allEntries().filter((e) => w.every((x) => `${e.name} ${e.tags.join(' ')} ${TYPE_LABEL[e.type]} ${WEAPON_LABEL[e.weapon]}`.toLowerCase().includes(x))).slice(0, 60);
  }, [q, userEntries]);
  const target = stream.format.samples / stream.format.sampleRate;
  return (
    <Modal onClose={onClose}>
      <h3>Stream ersetzen</h3>
      <p className="muted small" style={{ marginTop: 0 }}>Ziellänge {fmtDur(target)} bei {(stream.format.sampleRate / 1000).toFixed(1)} kHz. Wähle einen beliebigen Sound aus der Bibliothek – auch bearbeitete und erzeugte Sounds.</p>
      <input className="input" autoFocus placeholder="Bibliothek durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="recent-list" style={{ maxHeight: 340, overflowY: 'auto', marginTop: 10 }}>
        {list.map((e) => (
          <div key={e.id} className="recent-item" onClick={() => onPick(e)}>
            <Icon name="wave" size={15} />
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div><div className="faint small">{WEAPON_LABEL[e.weapon]} · {TYPE_LABEL[e.type]}</div></div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><Button variant="ghost" onClick={onClose}>Abbrechen</Button></div>
    </Modal>
  );
}
