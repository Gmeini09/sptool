import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { previewEntry, usePlayingKey, useProgress } from '../audio/preview';
import { engine } from '../audio/engine';
import { navigate, openInEditor, removeUserEntry, setState, toast, toggleFavorite, updateSettings, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { MiniWave } from '../components/MiniWave';
import { Button, EmptyState, IconButton, Modal, fmtDb, fmtDur, fmtLufs, useContextMenu, type MenuItem } from '../components/ui';
import { allEntries, entryById, useEntryMeta } from '../library/assets';
import { duplicateEntry, exportEntryWav, importWavFiles, newId } from '../library/actions';
import { AUDIO_ACCEPT } from '../library/importAudio';
import { PackSoundsDialog } from '../components/PackSounds';
import { COMPONENT_LABEL } from '../library/catalog';
import { TYPE_LABEL, WEAPON_LABEL, type LibraryEntry, type SoundType, type WeaponId } from '../models/types';
import { deleteBlob } from '../services/storage';
import { Sheet, useIsMobile } from '../components/mobile';

type Section = 'all' | 'turbo' | 'featured' | 'imported' | 'generated' | 'edit' | 'favorites' | 'recent' | `col:${string}`;
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'all', label: 'Alle Sounds' }, { id: 'turbo', label: 'Turbo' }, { id: 'featured', label: '★ Turbo Empfohlen' }, { id: 'imported', label: 'Importiert' },
  { id: 'generated', label: 'Erzeugt' }, { id: 'edit', label: 'Bearbeitet' }, { id: 'favorites', label: 'Favoriten' }, { id: 'recent', label: 'Zuletzt verwendet' },
];
const WEAPONS: Array<WeaponId | 'universal'> = ['pistol', 'pistol_mk2', 'pistol50', 'universal'];
const TYPES: SoundType[] = ['fire', 'suppressor', 'reload', 'mechanical', 'handling'];
const STYLES = ['Clean', 'Heavy', 'Deep', 'Punchy', 'Realistic', 'Competitive', 'Aggressive', 'Tactical', 'Bass', 'Modern', 'Metallic', 'Sharp', 'Short', 'Dry', 'Arcade', 'Soft', 'Cracky', 'Echo', 'Balanced', 'Dense', 'Bright', 'Street', 'Thunder', 'Snap', 'Loud', 'Boom', 'Crisp', 'Subsonic', 'Gambo', 'Gangwar', 'Hood'];
type Sort = 'name' | 'newest' | 'duration';

const NO_TAGS: string[] = [];
const CARD_H = 132, GAP = 12, MIN_W = 230;

function toggleIn<T>(set: T[], v: T) { return set.includes(v) ? set.filter((x) => x !== v) : [...set, v]; }

const SoundCard = memo(function SoundCard({ e, selected, fav, onSelect, onMenu, hover }: { e: LibraryEntry; selected: boolean; fav: boolean; onSelect: () => void; onMenu: (ev: React.MouseEvent) => void; hover: boolean }) {
  const meta = useEntryMeta(e);
  const playing = usePlayingKey() === e.id;
  const progress = useProgress(e.id, meta?.duration);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  return (
    <div
      className={`sound-card${selected ? ' sel' : ''}${playing ? ' is-playing' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => openInEditor(e.id)}
      onContextMenu={onMenu}
      onMouseEnter={() => { if (hover) hoverTimer.current = setTimeout(() => { if (engine.playingKey !== e.id) void previewEntry(e); }, 350); }}
      onMouseLeave={() => clearTimeout(hoverTimer.current)}
      draggable
      onDragStart={(ev) => { ev.dataTransfer.setData('application/x-sptool-sound', e.id); ev.dataTransfer.effectAllowed = 'copy'; }}
    >
      <div className="sc-top">
        <button className={`play-btn${playing ? ' playing' : ''}`} aria-label={playing ? `${e.name} stoppen` : `${e.name} abspielen`} onClick={(ev) => { ev.stopPropagation(); void previewEntry(e); }}>
          <Icon name={playing ? 'stop' : 'play'} size={13} />
        </button>
        <div className="sc-name" title={e.name}>{e.name}</div>
        <IconButton icon="heart" title={fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'} on={fav} size={15} onClick={(ev) => { ev.stopPropagation(); toggleFavorite(e.id); }} />
      </div>
      <div className="sc-wave">
        {meta ? <MiniWave peaks={meta.peaks} height={44} progress={progress} /> : <div className="wave-skeleton" />}
        {playing && <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>}
      </div>
      <div className="sc-meta">
        <span className="chip">{e.style}</span>
        <span>{WEAPON_LABEL[e.weapon]}</span>
        <span className="spacer" />
        <span className="num">{meta ? fmtDur(meta.duration) : '…'}</span>
      </div>
    </div>
  );
});

export function LibraryView() {
  const settings = useApp((s) => s.settings);
  const favorites = useApp((s) => s.favorites);
  const recent = useApp((s) => s.recent);
  const userEntries = useApp((s) => s.userEntries);
  const collections = useApp((s) => s.collections);
  const userTags = useApp((s) => s.userTags);
  const focus = useApp((s) => s.libraryFocus);
  const [section, setSection] = useState<Section>('all');
  const [weapons, setWeapons] = useState<Array<WeaponId | 'universal'>>([]);
  const [types, setTypes] = useState<SoundType[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [selId, setSelId] = useState<string | null>(focus);
  const [dragOver, setDragOver] = useState(false);
  const [packFiles, setPackFiles] = useState<File[] | null>(null);
  const [newCol, setNewCol] = useState<string | null>(null);
  const mobile = useIsMobile();
  const [showFilters, setShowFilters] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const menu = useContextMenu();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (focus) { setSelId(focus); setState({ libraryFocus: null }); } }, [focus]);

  const entries = useMemo(() => allEntries(), [userEntries]);
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const base = useMemo(() => {
    let list = entries;
    if (section === 'turbo') list = list.filter((e) => !!e.asset);
    else if (section === 'featured') list = list.filter((e) => e.featured);
    else if (section === 'imported') list = list.filter((e) => e.source === 'imported');
    else if (section === 'generated') list = list.filter((e) => e.source === 'generated');
    else if (section === 'edit') list = list.filter((e) => e.source === 'edit');
    else if (section === 'favorites') list = list.filter((e) => favSet.has(e.id));
    else if (section === 'recent') { const order = new Map(recent.map((r, i) => [r, i])); list = list.filter((e) => order.has(e.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!); }
    else if (section.startsWith('col:')) { const c = collections.find((x) => `col:${x.id}` === section); const ids = new Set(c?.ids ?? []); list = list.filter((e) => ids.has(e.id)); }
    return list;
  }, [entries, section, favSet, recent, collections]);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = base.filter((e) =>
      (!weapons.length || weapons.includes(e.weapon)) && (!types.length || types.includes(e.type)) && (!styles.length || styles.includes(e.style)) &&
      (!words.length || words.every((w) => `${e.name} ${e.tags.join(' ')} ${(userTags[e.id] ?? []).join(' ')} ${e.component ?? ''} ${e.component ? COMPONENT_LABEL[e.component] ?? '' : ''} ${TYPE_LABEL[e.type]} ${WEAPON_LABEL[e.weapon]}`.toLowerCase().includes(w))));
    if (section !== 'recent') {
      if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      else if (sort === 'newest') list = [...list].sort((a, b) => b.createdAt - a.createdAt);
      else list = [...list].sort((a, b) => a.estDuration - b.estDuration);
    }
    return list;
  }, [base, weapons, types, styles, q, sort, userTags, section]);

  const counts = useMemo(() => {
    const c = { w: {} as Record<string, number>, t: {} as Record<string, number>, s: {} as Record<string, number> };
    for (const e of base) { c.w[e.weapon] = (c.w[e.weapon] ?? 0) + 1; c.t[e.type] = (c.t[e.type] ?? 0) + 1; c.s[e.style] = (c.s[e.style] ?? 0) + 1; }
    return c;
  }, [base]);

  // ── Virtualized grid (spec §122/§153) ────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 800, h: 600, top: 0 });
  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setVp((v) => ({ ...v, w: el.clientWidth - (el.clientWidth < 500 ? 24 : 36), h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [section, weapons, types, styles, q, sort]);
  // The grid is virtualised: cards mount and unmount while scrolling. The cascade-in animation only plays once
  // when the list (re)appears; after that ("settled") cards that scroll in are simply there – no flicker, no holes.
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(false); const t = setTimeout(() => setSettled(true), 900); return () => clearTimeout(t); }, [section, weapons, types, styles, q, sort]);
  const cols = Math.max(1, Math.floor((vp.w + GAP) / (MIN_W + GAP)));
  const rows = Math.ceil(filtered.length / cols);
  const rowH = CARD_H + GAP;
  const first = Math.max(0, Math.floor(vp.top / rowH) - 2);
  const last = Math.min(rows, Math.ceil((vp.top + vp.h) / rowH) + 2);
  const visible = filtered.slice(first * cols, last * cols);

  const selected = selId ? entryById(selId) : undefined;

  const menuFor = (e: LibraryEntry): MenuItem[] => {
    const items: MenuItem[] = [
      { label: 'Vorhören', icon: 'play', onClick: () => void previewEntry(e) },
      { label: 'Bearbeiten', icon: 'edit', onClick: () => openInEditor(e.id) },
      { label: 'Duplizieren', icon: 'copy', onClick: () => { const d = duplicateEntry(e); setSelId(d.id); } },
      { label: favSet.has(e.id) ? 'Favorit entfernen' : 'Als Favorit markieren', icon: 'heart', onClick: () => toggleFavorite(e.id) },
      { label: 'WAV exportieren', icon: 'export', onClick: () => void exportEntryWav(e) },
      { label: 'Details', icon: 'info', onClick: () => setSelId(e.id) },
    ];
    for (const c of collections) {
      const inside = c.ids.includes(e.id);
      items.push({ label: inside ? `Aus „${c.name}“ entfernen` : `Zu „${c.name}“ hinzufügen`, icon: 'folder', divider: c === collections[0], onClick: () => setState((s) => ({ collections: s.collections.map((x) => x.id === c.id ? { ...x, ids: inside ? x.ids.filter((i) => i !== e.id) : [...x.ids, e.id] } : x) })) });
    }
    if (e.source !== 'builtin') items.push({ label: 'Löschen', icon: 'trash', divider: true, onClick: () => { if (e.blobKey) void deleteBlob(e.blobKey); removeUserEntry(e.id); if (selId === e.id) setSelId(null); toast('info', 'Gelöscht', e.name); } });
    return items;
  };

  // Space plays the selection
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' && selected && !(ev.target as HTMLElement).closest('input, textarea, select, button')) { ev.preventDefault(); void previewEntry(selected); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [selected]);

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragOver(false);
    const files = Array.from(ev.dataTransfer.files);
    const packs = files.filter((f) => /\.(rpf|zip|rar|7z)$/i.test(f.name));
    if (packs.length) { setPackFiles(packs); return; }
    if (files.length) { const ids = await importWavFiles(files); if (ids.length) setSection('imported'); }
  };

  const FilterOpt = ({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick: () => void }) => (
    <button className={`f-opt${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="box">{on && <Icon name="check" size={11} />}</span>{label}<span className="count">{count ?? 0}</span>
    </button>
  );

  const simpleLib = settings.simpleMode;
  const filterPanel = (
    <>
        <div className="f-group">
          <div className="f-title">Bibliothek</div>
          {SECTIONS.filter((s) => !simpleLib || ['all', 'imported', 'favorites'].includes(s.id)).map((s) => (
            <button key={s.id} className={`nav-item${section === s.id ? ' active' : ''}`} style={{ padding: '6px 10px' }} onClick={() => setSection(s.id)}>{simpleLib && s.id === 'imported' ? 'Meine importierten' : s.label}</button>
          ))}
        </div>
        {!simpleLib && <div className="f-group">
          <div className="f-title row" style={{ marginRight: 4 }}>Sammlungen<span className="spacer" /><IconButton icon="plus" title="Neue Sammlung" size={14} onClick={() => setNewCol('')} /></div>
          {collections.length === 0 && <div className="faint small" style={{ padding: '0 8px' }}>Fasse Sounds zusammen, die dir gefallen, z. B. „Meine MK2-Favoriten“.</div>}
          {collections.map((c) => (
            <button key={c.id} className={`nav-item${section === `col:${c.id}` ? ' active' : ''}`} style={{ padding: '6px 10px' }} onClick={() => setSection(`col:${c.id}`)}
              onContextMenu={(ev) => menu.open(ev, [{ label: 'Sammlung löschen', icon: 'trash', onClick: () => { setState((s) => ({ collections: s.collections.filter((x) => x.id !== c.id) })); setSection('all'); } }])}>
              <Icon name="folder" size={15} />{c.name}<span className="soon">{c.ids.length}</span>
            </button>
          ))}
        </div>}
        <div className="f-group"><div className="f-title">Waffe</div>{WEAPONS.map((w) => <FilterOpt key={w} on={weapons.includes(w)} label={WEAPON_LABEL[w]} count={counts.w[w]} onClick={() => setWeapons(toggleIn(weapons, w))} />)}</div>
        <div className="f-group"><div className="f-title">Typ</div>{TYPES.filter((t) => !simpleLib || t === 'fire' || t === 'reload').map((t) => <FilterOpt key={t} on={types.includes(t)} label={TYPE_LABEL[t]} count={counts.t[t]} onClick={() => setTypes(toggleIn(types, t))} />)}</div>
        {!simpleLib && <div className="f-group"><div className="f-title">Stil</div>{STYLES.filter((s) => counts.s[s]).map((s) => <FilterOpt key={s} on={styles.includes(s)} label={s} count={counts.s[s]} onClick={() => setStyles(toggleIn(styles, s))} />)}</div>}
    </>
  );
  const activeFilters = weapons.length + types.length + styles.length;

  return (
    <div className="lib">
      {!mobile && <aside className="lib-filters" aria-label="Filter">{filterPanel}</aside>}

      <section className="lib-center">
        <div className="lib-toolbar">
          <input className="input" placeholder="Name, Tag, Bauteil suchen…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Bibliothek durchsuchen" />
          <select className="select" style={{ width: 'auto', minWidth: 172 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sortierung" disabled={section === 'recent'}>
            <option value="name">Sortieren: Name</option><option value="newest">Sortieren: Neueste</option><option value="duration">Sortieren: Länge</option>
          </select>
          {mobile && <Button size="sm" icon="sliders" onClick={() => setShowFilters(true)}>Filter{activeFilters ? ` (${activeFilters})` : ''}</Button>}
          <span className="faint small num count">{filtered.length} {filtered.length === 1 ? 'Sound' : 'Sounds'}</span>
          <span className="spacer" />
          {(weapons.length || types.length || styles.length || q) ? <Button variant="ghost" size="sm" onClick={() => { setWeapons([]); setTypes([]); setStyles([]); setQ(''); }}>Filter zurücksetzen</Button> : null}
          {!mobile && <IconButton icon="volume" solid on={settings.hoverPreview} title={settings.hoverPreview ? 'Vorhören beim Überfahren an – klicken zum Ausschalten' : 'Vorhören beim Überfahren aus – Sounds abspielen, wenn die Maus über einer Karte ist'} onClick={() => updateSettings({ hoverPreview: !settings.hoverPreview })} />}
          {mobile ? <IconButton icon="upload" solid title="Sound importieren" onClick={() => fileRef.current?.click()} /> : <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>Sound importieren</Button>}
          {mobile ? <IconButton icon="box" solid title="Aus Soundpack holen" onClick={() => setPackFiles([])} /> : <Button size="sm" icon="box" onClick={() => setPackFiles([])}>Aus Soundpack holen</Button>}
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={async (e) => { const ids = await importWavFiles(Array.from(e.target.files ?? [])); e.target.value = ''; if (ids.length) setSection('imported'); }} />
        </div>
        <div
          className="lib-scroll" ref={scrollRef}
          onScroll={(e) => { if (!settled) setSettled(true); setVp((v) => ({ ...v, top: (e.target as HTMLDivElement).scrollTop })); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {dragOver && <div className="drop-overlay">WAV-Dateien hier ablegen zum Importieren</div>}
          {filtered.length === 0 ? (
            section === 'favorites' && !q ? <EmptyState icon="heart" title="Noch keine Favoriten" body="Markiere Sounds, die dir gefallen, mit dem Herz. Sie landen dann hier." />
              : section === 'imported' && !q ? <EmptyState icon="upload" title="Keine importierten Sounds" body="Zieh Audiodateien (MP3, WAV, OGG, M4A …) oder ein Soundpack hierher oder nutze „Sound importieren“. Deine Dateien werden kopiert, die Originale bleiben unverändert." action={<Button icon="upload" onClick={() => fileRef.current?.click()}>Sound importieren</Button>} />
              : section === 'generated' && !q ? <EmptyState icon="sparkles" title="Noch nichts erzeugt" body="Erstelle unter „Sound erstellen“ einen Sound und speichere ihn in deiner Bibliothek." action={<Button onClick={() => navigate('generator')}>Sound erstellen öffnen</Button>} />
              : section === 'edit' && !q ? <EmptyState icon="edit" title="Keine bearbeiteten Sounds" body="Öffne einen beliebigen Sound im Editor und speichere deine Änderungen als neuen Sound." />
              : !entries.length ? <EmptyState icon="library" title="Noch keine Sounds" body="Importier eigene Audiodateien (MP3, WAV, OGG, M4A …), hol dir Sounds aus einem Soundpack oder erstell unter „Sound erstellen“ einen neuen." action={<div className="row" style={{ gap: 8, justifyContent: 'center' }}><Button icon="upload" onClick={() => fileRef.current?.click()}>Sound importieren</Button><Button icon="box" onClick={() => setPackFiles([])}>Aus Soundpack holen</Button></div>} />
              : <EmptyState icon="search" title="Keine passenden Sounds" body="Versuch es mit weniger Filtern oder einer anderen Suche." />
          ) : (
            <div style={{ height: rows * rowH, position: 'relative' }}>
              <div className={settled ? 'sound-grid settled' : 'sound-grid'} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, position: 'absolute', top: first * rowH, left: 0, right: 0 }}>
                {visible.map((e) => (
                  <SoundCard key={e.id} e={e} selected={e.id === selId} fav={favSet.has(e.id)} hover={settings.hoverPreview} onSelect={() => { setSelId(e.id); if (mobile) setShowInspector(true); }} onMenu={(ev) => { setSelId(e.id); menu.open(ev, menuFor(e)); }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {!mobile && <Inspector e={selected} fav={selected ? favSet.has(selected.id) : false} />}
      {mobile && showFilters && <Sheet title={<div className="row"><strong style={{ flex: 1 }}>Filter</strong>{activeFilters > 0 && <Button size="sm" variant="ghost" onClick={() => { setWeapons([]); setTypes([]); setStyles([]); }}>Zurücksetzen</Button>}<Button size="sm" variant="primary" onClick={() => setShowFilters(false)}>{filtered.length} anzeigen</Button></div>} onClose={() => setShowFilters(false)}><div className="lib-filters">{filterPanel}</div></Sheet>}
      {mobile && showInspector && selected && <Sheet onClose={() => setShowInspector(false)}><Inspector e={selected} fav={favSet.has(selected.id)} /></Sheet>}
      {menu.node}
      {newCol !== null && (
        <Modal onClose={() => setNewCol(null)}>
          <form onSubmit={(ev) => { ev.preventDefault(); const name = newCol.trim(); if (!name) return; const id = newId('col'); setState((s) => ({ collections: [...s.collections, { id, name, ids: selId ? [selId] : [] }] })); setNewCol(null); setSection(`col:${id}`); }}>
            <h3>Neue Sammlung</h3>
            <p className="muted small" style={{ marginTop: 0 }}>{selId ? 'Der ausgewählte Sound wird gleich hinzugefügt.' : 'Füge Sounds über das Rechtsklick-Menü hinzu.'}</p>
            <input className="input" autoFocus placeholder="Meine MK2-Favoriten" value={newCol} maxLength={40} onChange={(e) => setNewCol(e.target.value)} />
            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><Button variant="ghost" onClick={() => setNewCol(null)}>Abbrechen</Button><Button variant="primary" type="submit" disabled={!newCol.trim()}>Sammlung erstellen</Button></div>
          </form>
        </Modal>
      )}
      <PackSoundsDialog open={packFiles !== null} initialFiles={packFiles ?? undefined} onClose={() => { setPackFiles(null); setSection('imported'); }} />
    </div>
  );
}

function Inspector({ e, fav }: { e: LibraryEntry | undefined; fav: boolean }) {
  const meta = useEntryMeta(e);
  const playing = usePlayingKey() === e?.id;
  const progress = useProgress(e?.id ?? null, meta?.duration);
  const tags = useApp((s) => (e ? s.userTags[e.id] ?? NO_TAGS : NO_TAGS));
  const devMode = useApp((s) => s.settings.devMode);
  const [tag, setTag] = useState('');
  if (!e) return <aside className="inspector"><EmptyState icon="info" title="Wähle einen Sound" body="Klick auf eine Karte, um hier ihre Details zu sehen. Doppelklick öffnet sie im Editor." /></aside>;
  const addTag = () => {
    const t = tag.trim().toLowerCase().slice(0, 24);
    if (!t) return;
    setState((s) => ({ userTags: { ...s.userTags, [e.id]: [...new Set([...(s.userTags[e.id] ?? []), t])] } }));
    setTag('');
  };
  return (
    <aside className="inspector" aria-label="Sound-Details">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <h3 style={{ flex: 1 }}>{e.name}</h3>
        <IconButton icon="heart" title={fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'} on={fav} onClick={() => toggleFavorite(e.id)} />
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <span className="chip accent">{e.style}</span><span className="chip">{TYPE_LABEL[e.type]}</span>{e.component && <span className="chip">{COMPONENT_LABEL[e.component] ?? e.component}</span>}
        {meta?.clipping && <span className="chip warn">Übersteuert</span>}
      </div>
      <div className="insp-wave">{meta ? <MiniWave peaks={meta.peaks} height={70} progress={progress} /> : <div className="wave-skeleton" style={{ height: 70 }} />}</div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button variant="primary" icon={playing ? 'stop' : 'play'} onClick={() => void previewEntry(e)}>{playing ? 'Stopp' : 'Abspielen'}</Button>
        <Button icon="edit" onClick={() => openInEditor(e.id)}>Bearbeiten</Button>
        <IconButton icon="export" title="WAV exportieren" solid onClick={() => void exportEntryWav(e)} />
      </div>
      <dl className="kv">
        <dt>Waffe</dt><dd>{WEAPON_LABEL[e.weapon]}</dd>
        <dt>Typ</dt><dd>{TYPE_LABEL[e.type]}</dd>
        <dt>Dauer</dt><dd>{meta ? fmtDur(meta.duration) : '…'}</dd>
        <dt>Lautstärke</dt><dd>{meta ? fmtLufs(meta.lufs) : '…'}</dd>
        <dt>Spitzenpegel</dt><dd>{meta ? fmtDb(meta.peakDb) : '…'}</dd>
        <dt>Ersteller</dt><dd>{e.creator}</dd>
        <dt>Lizenz</dt><dd>{e.license}</dd>
        <dt>Quelle</dt><dd>{e.sourceInfo}</dd>
        <dt>Version</dt><dd>{e.version}</dd>
        {devMode && <><dt>Interne ID</dt><dd style={{ userSelect: 'text' }}>{e.id}</dd></>}
      </dl>
      <div style={{ marginTop: 16 }}>
        <div className="faint small" style={{ marginBottom: 6 }}>Tags</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {e.tags.map((t) => <span key={t} className="chip">{t}</span>)}
          {tags.map((t) => (
            <span key={t} className="chip accent">{t}
              <button aria-label={`Tag ${t} entfernen`} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'grid' }} onClick={() => setState((s) => ({ userTags: { ...s.userTags, [e.id]: (s.userTags[e.id] ?? []).filter((x) => x !== t) } }))}><Icon name="x" size={11} /></button>
            </span>
          ))}
        </div>
        <form className="row" style={{ marginTop: 8 }} onSubmit={(ev) => { ev.preventDefault(); addTag(); }}>
          <input className="input" style={{ height: 30 }} placeholder="Eigenen Tag hinzufügen" value={tag} onChange={(ev) => setTag(ev.target.value)} />
          <Button size="sm" type="submit" disabled={!tag.trim()}>Hinzufügen</Button>
        </form>
      </div>
    </aside>
  );
}
