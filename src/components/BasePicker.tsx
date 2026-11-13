// Chooses the base pack (WEAPONS_PLAYER.rpf + RESIDENT.rpf of any working weapon soundpack) – once.
// Finds it on the PC by itself, takes ZIPs and .rpf files by drag & drop, and remembers it for every later build.
import { useEffect, useRef, useState } from 'react';
import { toast } from '../app/store';
import { adoptBase, adoptOriginal, baseFromUserFiles, baseInfo, forgetBase, isOriginalPack, ORIGINAL_LABEL, originalFromGta, restoreBase, ensureBase, searchCandidates } from '../projects/basePack';
import { getBasePack, onBasePack } from '../projects/build';
import { readBaseCandidate, type BaseCandidate } from '../services/install';
import { nativeInfo } from '../services/native';
import { Icon } from './Icon';
import { Button } from './ui';

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const ago = (s: number) => { const d = Math.round((Date.now() / 1000 - s) / 86400); return d < 1 ? 'heute' : d === 1 ? 'gestern' : `vor ${d} Tagen`; };

export function useBase() {
  const [base, setBase] = useState(getBasePack());
  useEffect(() => { void restoreBase(); return onBasePack(() => setBase(getBasePack())); }, []);
  return base;
}

export function BasePicker({ autoSearch = true }: { autoSearch?: boolean }) {
  const base = useBase();
  const info = base ? baseInfo() : null;
  const [native, setNative] = useState<boolean | null>(null);
  const [found, setFound] = useState<BaseCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void nativeInfo().then((n) => setNative(!!n)).catch(() => setNative(false)); }, []);
  const search = async (maxAge = 0) => {
    setBusy('Dein PC wird nach Soundpacks durchsucht…');
    try { setFound(await searchCandidates(maxAge)); } catch (e) { setFound([]); toast('error', 'Suche fehlgeschlagen', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  // nothing set up yet: take the best soundpack on this PC automatically (no clicking); show the list only if that fails
  const auto = useRef(false);
  useEffect(() => {
    if (!native || !autoSearch || base || found !== null || auto.current) return;
    auto.current = true;
    void (async () => {
      setBusy('Vorlage wird automatisch eingerichtet…');
      const p = await ensureBase((st) => setBusy(st)).catch(() => null);
      setBusy(null);
      if (p) toast('success', 'Vorlage automatisch eingerichtet', `${baseInfo()?.label ?? 'Soundpack'} – wird ab jetzt immer verwendet.`);
      else await search(30_000);
    })();
  }, [native, base]);

  const adoptCandidate = async (c: BaseCandidate) => {
    setBusy(`${c.label} wird übernommen…`);
    try {
      const files = await readBaseCandidate(c);
      await adoptBase(files, c.source, c.label);
      toast('success', 'Basis-Pack eingerichtet', `${c.label} – wird ab jetzt immer automatisch verwendet.`);
    } catch (e) { toast('error', 'Das hat nicht geklappt', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const adoptFiles = async (list: File[]) => {
    if (!list.length) return;
    setBusy('Dateien werden geprüft…');
    try {
      const { files, label } = await baseFromUserFiles(list);
      if (isOriginalPack(files)) {
        await adoptOriginal(files, list);
        toast('success', 'Original-GTA-Soundpack ist die Vorlage', '„Original behalten“ klingt jetzt wie in GTA V – alles, was du nicht änderst, bleibt original.');
        return;
      }
      await adoptBase(files, 'Deine Datei', label);
      toast('success', 'Basis-Pack eingerichtet', `${label} – wird ab jetzt immer automatisch verwendet.`);
    } catch (e) { toast('error', 'Diese Dateien passen nicht', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  // the original GTA V soundpack (Rockstar's files) as template – from the GTA V folder or dropped here
  const useOriginal = async () => {
    setBusy('Original-Soundpack wird aus dem GTA-V-Ordner gelesen…');
    try {
      await adoptOriginal(await originalFromGta());
      toast('success', 'Original-GTA-Soundpack ist die Vorlage', '„Original behalten“ klingt jetzt wie in GTA V – alles, was du nicht änderst, bleibt original.');
    } catch (e) { toast('error', 'Original ging nicht', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const originalCard = (
    <div className="base-original" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="Original-Dateien (und ggf. GTA5.exe) auswählen" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) fileRef.current?.click(); }}>
      <Icon name="shield" size={18} />
      <div className="grow" style={{ minWidth: 0 }}>
        <b>Original-GTA-Soundpack als Vorlage</b>
        <div className="small muted">Zieh die Original-Dateien von GTA V hier rein (WEAPONS_PLAYER.rpf + RESIDENT.rpf, auch als ZIP){native ? ' oder nimm sie direkt aus deinem GTA-V-Ordner' : ' – dazu einmal deine GTA5.exe'}. Dann klingt „Original behalten“ wie im Spiel.</div>
      </div>
      {native && <Button size="sm" icon="download" disabled={!!busy} onClick={() => void useOriginal()}>Aus GTA-Ordner</Button>}
    </div>
  );

  const drop = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); void adoptFiles(Array.from(e.dataTransfer.files)); },
  };
  const picker = <input ref={fileRef} type="file" accept=".rpf,.zip,.rar,.7z,.exe" multiple hidden onChange={(e) => { void adoptFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />;

  if (base) {
    return (
      <div className={`base-ok${over ? ' over' : ''}`} {...drop}>
        <div className="base-ok-icon"><Icon name="check" size={18} /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <b>Basis-Pack eingerichtet{info?.label ? `: ${info.label}` : ''}</b>
          <div className="small muted">{base.names.join(' + ')}{info ? ` · ${info.source} · ${info.containers} Sound-Container` : ''} · wird bei jedem Bauen automatisch verwendet</div>
        </div>
        {info?.label !== ORIGINAL_LABEL && native && <Button size="sm" variant="ghost" icon="shield" disabled={!!busy} title="Rockstars Original-Soundpack aus deinem GTA-V-Ordner als Vorlage nehmen" onClick={() => void useOriginal()}>{busy ?? 'Original GTA nehmen'}</Button>}
        <Button size="sm" variant="ghost" icon="refresh" disabled={!!busy} onClick={() => { void forgetBase(); setFound(null); }}>Anderes wählen</Button>
        {picker}
      </div>
    );
  }

  const list = found ?? [];
  const shown = showAll ? list : list.slice(0, 3);
  return (
    <div className={`base-pick${over ? ' over' : ''}`} {...drop}>
      {picker}
      <div className="base-drop" role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}>
        <Icon name="upload" size={22} />
        <div><b>Soundpack hierher ziehen</b><div className="small muted">Die ZIP eines beliebigen Waffen-Soundpacks – oder WEAPONS_PLAYER.rpf und RESIDENT.rpf. Nur einmal nötig, danach merkt sich SP Tool das.</div></div>
      </div>
      {originalCard}
      {native && (
        <div className="base-found">
          <div className="row" style={{ gap: 8 }}>
            <b className="grow">{busy && !found ? busy : list.length ? `Auf deinem PC gefunden (${list.length})` : found ? 'Auf deinem PC wurde noch kein Waffen-Soundpack gefunden' : 'Auf deinem PC suchen'}</b>
            <Button size="sm" variant="ghost" icon="search" disabled={!!busy} onClick={() => void search()}>{found ? 'Erneut suchen' : 'Suchen'}</Button>
          </div>
          {shown.map((c, i) => (
            <div key={c.id} className="base-cand">
              <Icon name={c.kind === 'zip' ? 'archive' : 'folder'} size={16} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis"><b>{c.label}</b>{i === 0 && <span className="chip accent" style={{ marginLeft: 6 }}>Neuestes</span>}</div>
                <div className="small muted ellipsis" title={c.path}>{c.source} · {c.files.map((f) => `${f.name} ${mb(f.size)}`).join(' + ')}{c.modified ? ` · ${ago(c.modified)}` : ''}</div>
              </div>
              <Button size="sm" variant={i === 0 ? 'primary' : undefined} icon="check" disabled={!!busy} onClick={() => void adoptCandidate(c)}>Verwenden</Button>
            </div>
          ))}
          {list.length > 3 && !showAll && <button className="link-like small" onClick={() => setShowAll(true)}>Alle {list.length} anzeigen</button>}
          {found && !list.length && <div className="small muted">Gesucht in: FiveM-mods-Ordner, OpenIV-mods-Ordner von GTA V, Downloads, Desktop, Dokumente (auch OneDrive, auch in ZIP-Dateien). Liegt dein Pack als <b>.rar</b> oder <b>.7z</b> da? Dann erst entpacken (Rechtsklick → „Alle extrahieren“ bzw. WinRAR) und „Erneut suchen“ klicken – oder die entpackten .rpf-Dateien einfach hier reinziehen.</div>}
          {list.some((c) => c.files.length < 2) && <div className="small faint">Ohne RESIDENT.rpf funktioniert es auch – Sounds aus dieser Datei bleiben dann original.</div>}
        </div>
      )}
      {busy && <div className="small muted"><span className="spinner" /> {busy}</div>}
    </div>
  );
}
