// Build: the open project's slots are rendered into a base pack using the stream mapping, then handed
// to Install (or saved). Unmapped slots are reported clearly – SP Tool never guesses a target.
import { useEffect, useMemo, useState } from 'react';
import { navigate, notify, toast, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { applyArchiveFix, findArchiveFix } from '../services/archiveFix';
import { Button, DoneMark, EmptyState, Progress } from '../components/ui';
import { loadMapping } from '../formats/mapping';
import { planBuild, runBuild, type BuildResult, type SlotStatus } from '../projects/build';
import { BasePicker, useBase } from '../components/BasePicker';
import { renderAssignment } from '../projects/actions';
import { saveToDownloads, showDownloads } from '../services/downloads';
import { logger } from '../services/logger';
import { ensureNgKeys } from '../services/ngKeys';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { openGameTest } from './GameTest';
import { useCan } from '../account/perms';

const STATUS: Record<SlotStatus, { label: string; icon: 'check' | 'alert' | 'lock'; cls: string }> = {
  ready: { label: 'Bereit', icon: 'check', cls: 'ok' },
  unmapped: { label: 'Noch nicht zugeordnet – behält den Originalsound', icon: 'lock', cls: 'muted' },
  'not-in-base': { label: 'Das Basis-Pack enthält diesen Sound nicht – wähle ein anderes Basis-Pack', icon: 'alert', cls: 'warn' },
};
const fmtSize = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export function BuildView() {
  const projects = useApp((s) => s.projects);
  const currentId = useApp((s) => s.currentProjectId);
  const project = projects.find((p) => p.id === currentId);
  const base = useBase();
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<number | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  useEffect(() => setResult(null), [base]);

  const gameTest = useApp((s) => s.gameTestOpen);
  const canMap = useCan('devMode');
  const mapping = useMemo(() => loadMapping(), [gameTest]);
  const plan = useMemo(() => (project ? planBuild(project, WEAPON_PROFILES, mapping, base?.pack ?? null) : null), [project, mapping, base]);

  if (!project) {
    return <div className="page"><EmptyState icon="hammer" title="Öffne zuerst ein Soundpack" body="Beim Bauen werden die Sounds in den Waffen-Slots deines Soundpacks zu einem fertigen Soundpack. Oder erstell eins Schritt für Schritt." action={<div className="row" style={{ gap: 8, justifyContent: 'center' }}><Button variant="primary" icon="hammer" onClick={() => navigate('create')}>Soundpack erstellen</Button><Button icon="folder" onClick={() => navigate('projects')}>Meine Soundpacks öffnen</Button></div>} /></div>;
  }

  const build = async () => {
    if (!plan || !base) return;
    setBusy('Sounds werden berechnet…'); setProg(0); setResult(null);
    try {
      // the OpenIV + ArchiveFix way when ArchiveFix.exe is on the PC; otherwise SP Tool's own NG encryption (needs keys)
      const afx = await findArchiveFix();
      if (!afx?.hasKeys) await ensureNgKeys().catch(() => { /* only needed for sounds longer than the template – runBuild says so */ });
      const built = await runBuild(plan, base.pack, renderAssignment, (d, t, label) => { setBusy(d < t ? `Sound ${d + 1}/${t} wird berechnet · ${label}` : 'Archive werden geschrieben…'); setProg(d < t ? d / t : null); }, { allArchives: true });
      const af = await applyArchiveFix(built.outputs, (s) => setBusy(s));
      if (af.error) toast('warning', 'ArchiveFix hat nicht geklappt', `${af.error} – zieh die Dateien nach dem Kopieren selbst auf ArchiveFix.exe.`);
      const r = { ...built, outputs: af.outputs, archiveFix: af.outputs.some((o) => o.open) };
      setResult(r);
      logger.info(`Build ${project.name}: ${r.replacedStreams} streams → ${r.outputs.map((o) => o.name).join(', ')}`);
      notify('Soundpack gebaut', `${project.name}: ${r.outputs.map((o) => o.name).join(' + ')}`);
    } catch (e) {
      toast('error', 'Bauen fehlgeschlagen', e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProg(null); }
  };

  const items = plan?.items ?? [];
  const byWeapon = WEAPON_PROFILES.map((w) => ({ w, items: items.filter((i) => i.weapon === w.id) })).filter((x) => x.items.length);

  return (
    <div className="page install-page">
      <div className="panel">
        <div className="panel-head row"><h3 className="grow">1 · Dein Soundpack</h3><Button size="sm" variant="ghost" icon="layers" onClick={() => navigate('soundpack')}>Slots bearbeiten</Button></div>
        <div className="panel-body row">
          <Icon name="folder" size={18} />
          <div className="grow"><b>{project.name}</b> <span className="faint small">v{project.version}</span><div className="small muted">{items.length} befüllte{items.length === 1 ? 'r' : ''} Slot{items.length === 1 ? '' : 's'} für {byWeapon.length} Waffe{byWeapon.length === 1 ? '' : 'n'}</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head row"><h3 className="grow">2 · Basis-Pack</h3><span className="small muted">einmal einrichten – danach automatisch</span></div>
        <div className="panel-body"><BasePicker /></div>
      </div>

      <div className="panel">
        <div className="panel-head row"><h3 className="grow">3 · Prüfen und bauen</h3>{plan && <span className="small muted">{plan.ready} bereit · {plan.blocked} bleiben original</span>}</div>
        <div className="panel-body">
          {!items.length ? <div className="small muted">Noch kein Slot befüllt. Zieh Sounds unter „Soundpack befüllen“ auf die Waffen-Slots.</div> : (
            <div className="build-list">
              {byWeapon.map(({ w, items: list }) => (
                <div key={w.id} className="build-weapon">
                  <div className="build-wname">{w.displayName}</div>
                  {list.map((i) => {
                    const st = base ? STATUS[i.status] : { label: 'Wartet auf ein Basis-Pack', icon: 'lock' as const, cls: 'muted' };
                    return (
                      <div key={i.slot} className={`build-row ${st.cls}`}>
                        <Icon name={st.icon} size={15} />
                        <span className="build-slot">{i.slotLabel}</span>
                        <span className="grow small">{st.label}{i.status === 'ready' && base ? ` · ${i.targets.length} Sound${i.targets.length === 1 ? '' : 's'} in ${i.files.join(', ')}` : ''}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {plan && base && plan.ready === 0 && items.length > 0 && (
            <div className="callout info small" style={{ marginTop: 12 }}><Icon name="info" size={16} /><div>Keiner deiner befüllten Slots ist bisher einem Spielsound zugeordnet. Die Zuordnung erstellt das SP-Tool-Team einmalig in der Pack-Analyse, danach wird sie mit der App ausgeliefert.</div></div>
          )}
          {canMap && plan && base && plan.items.some((i) => i.status === 'unmapped') && (
            <div className="callout small" style={{ marginTop: 12 }}><Icon name="gamepad" size={16} /><div className="grow">Für einige Slots fehlt noch die Zuordnung. Mit dem Test im Spiel findest du sie in zwei Minuten heraus.</div><Button size="sm" onClick={openGameTest}>Im Spiel testen</Button></div>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="primary" size="lg" icon="hammer" disabled={!!busy || !base || !plan?.ready} onClick={() => void build()}>{busy ?? 'Soundpack bauen'}</Button>
            {busy && <span className="spinner" />}
          </div>
          {busy && <Progress value={prog} label={busy} />}
        </div>
      </div>

      {result && (
        <div className="panel inst-done">
          <div className="panel-body">
            <div className="row"><DoneMark /><div className="grow"><b>Gebaut: {result.outputs.map((o) => o.name).join(' + ')}</b><div className="small muted">{result.replacedStreams} Spielsounds ersetzt · {result.outputs.map((o) => `${o.name} ${fmtSize(o.bytes.byteLength)}`).join(' · ')}</div></div></div>
            {result.archiveFix && <div className="callout small" style={{ marginTop: 10 }}><Icon name="info" size={16} /><div><b>Danach ArchiveFix:</b> {result.outputs.filter((o) => o.open).map((o) => o.name).join(' und ')} {result.outputs.filter((o) => o.open).length > 1 ? 'sind' : 'ist'} wie mit OpenIV neu gebaut, aber ArchiveFix lief nicht. Nach dem Kopieren in den sfx-Ordner jede davon auf <span className="mono">ArchiveFix.exe</span> ziehen (Pfad für das automatische Ausführen unter Einstellungen › Erweitert) – sonst startet GTA mit „Invalid encryption type“.</div></div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <Button variant="primary" icon="download" onClick={async () => { try { const s = await saveToDownloads(project.name, result.outputs.map((o) => ({ name: o.name, bytes: o.bytes }))); toast('success', 'Als ZIP gespeichert', `${s.zip} ${s.dir ? 'liegt in Downloads › SP Tool' : 'liegt in deinem Download-Ordner'} – die Dateien darin direkt in GTA V › x64 › audio › sfx ziehen (kein Unterordner), dann FiveM neu starten.`); if (s.dir) void showDownloads(); } catch (e) { toast('error', 'Speichern fehlgeschlagen', e instanceof Error ? e.message : String(e)); } }}>Als ZIP speichern</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
