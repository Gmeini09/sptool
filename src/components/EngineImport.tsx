// "Ohne GTA erstellen": einmal Rockstars Original-Dateien und eine GTA5.exe (Legacy) auswählen. Die Engine prüft die
// Original-Dateien an ihrer Prüfsumme (nur unveränderte werden angenommen) und merkt sich aus der GTA5.exe den
// Schlüssel. Alles bleibt auf diesem PC; danach baut SP Tool ohne installiertes GTA – immer aus den Originalen.
import { useRef, useState } from 'react';
import { toast } from '../app/store';
import { engineImport, resetEngineCache, type EngineStatus } from '../services/spEngine';
import { Icon } from './Icon';
import { Button } from './ui';

export function EngineImport({ status, onChange }: { status: EngineStatus; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);

  const run = async (files: File[]) => {
    if (!files.length) return;
    const found: string[] = [];
    try {
      for (const f of files) {
        setBusy(`${f.name} wird geprüft…`);
        const r = await engineImport(f);
        found.push(...r.imported);
        for (const n of r.notes) toast('info', f.name, n);
      }
      resetEngineCache();
      if (found.length) toast('success', 'Importiert', [...new Set(found)].join(', '));
    } catch (e) {
      toast('error', 'Import fehlgeschlagen', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      onChange();
    }
  };

  const item = (ok: boolean, text: string) => (
    <div className="row small" style={{ gap: 6 }}>
      <Icon name={ok ? 'checkCircle' : 'alert'} size={14} />
      <span className={ok ? '' : 'muted'}>{text}</span>
    </div>
  );

  return (
    <div
      className={`callout${over ? ' accent' : ''}`}
      style={{ marginBottom: 12, alignItems: 'flex-start' }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}
    >
      <Icon name="key" size={18} />
      <div className="grow">
        <b>Ohne GTA erstellen – einmal einrichten</b>
        <div className="small muted" style={{ margin: '4px 0 8px' }}>
          Auf diesem PC ist kein GTA V. SP Tool baut trotzdem immer aus Rockstars Original-Dateien – dafür einmal hier
          hineinziehen oder auswählen: die <b>Original-Dateien</b> (WEAPONS_PLAYER.rpf + RESIDENT.rpf, auch als ZIP, z. B.
          „Original GTA V Soundpack“) und eine <b>GTA5.exe</b> von GTA V Legacy (z. B. vom USB-Stick oder einem anderen PC).
          Nur unveränderte Rockstar-Dateien werden angenommen; aus der GTA5.exe merkt sich SP Tool nur den Schlüssel. Alles bleibt auf diesem PC.
        </div>
        {item(status.haveOriginals, status.haveOriginals ? 'Original-Dateien geprüft und gespeichert' : 'Original-Dateien fehlen')}
        {item(status.haveKeys, status.haveKeys ? 'Schlüssel aus der GTA5.exe gespeichert' : 'GTA5.exe (Legacy) fehlt')}
        {busy && <div className="small" style={{ marginTop: 6 }}>{busy}</div>}
      </div>
      <Button size="sm" icon="upload" disabled={!!busy} onClick={() => input.current?.click()}>Dateien wählen</Button>
      <input ref={input} type="file" multiple accept=".rpf,.zip,.exe" style={{ display: 'none' }}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void run(f); }} />
    </div>
  );
}
