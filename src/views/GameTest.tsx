// Zuordnungstest im Spiel (Developer/Admin): speichert ein Testpack als ZIP, in dem jeder Kandidat unterschiedlich oft
// piept. Einmal mit jeder Pistole schießen, anklicken wie oft es gepiept hat – SP Tool speichert die Zuordnung
// und ein Admin schickt sie mit einem Klick an alle Nutzer.
import { useEffect, useState } from 'react';
import { isAdmin, useAccount } from '../account/account';
import { navigate, setState, toast, useApp } from '../app/store';
import { BasePicker, useBase } from '../components/BasePicker';
import { Icon } from '../components/Icon';
import { Button, DoneMark, Modal } from '../components/ui';
import { loadMapping, saveMapping } from '../formats/mapping';
import { applyGameTest, applyReloadTest, buildGameTest, RELOAD_TEST_GROUPS, TEST_GROUPS, type TestAnswers } from '../projects/gameTest';
import { publishMapping } from '../services/mappingSync';
import { saveToDownloads, showDownloads } from '../services/downloads';
import { logger } from '../services/logger';
import { WEAPON_PROFILES } from '../weapons/profiles';
import { SearchTest } from './SearchTest';

export function openGameTest() { setState({ gameTestOpen: true }); }

type Step = 'prepare' | 'listen' | 'saved';
const QUESTIONS = WEAPON_PROFILES.map((w) => ({ key: `${w.id}:fire`, label: w.displayName }));

export function GameTest() {
  const open = useApp((s) => s.gameTestOpen);
  const admin = useAccount(isAdmin);
  const base = useBase();
  const [step, setStep] = useState<Step>('prepare');
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<number[]>([]);
  const [foundReload, setFoundReload] = useState<number[]>([]);
  const [answers, setAnswers] = useState<TestAnswers>({});
  // low beep patterns heard while reloading, in the order they came (per weapon); [] = sounded normal
  const [reloads, setReloads] = useState<Record<string, number[]>>({});
  const [result, setResult] = useState<{ added: number; shared: string[]; published: number | null } | null>(null);
  const [mode, setMode] = useState<'search' | 'quick'>('search');
  useEffect(() => { if (open) { setStep('prepare'); setAnswers({}); setReloads({}); setResult(null); } }, [open]);
  if (!open) return null;
  const close = () => { if (!busy) setState({ gameTestOpen: false }); };

  const prepare = async () => {
    if (!base) return;
    setBusy('Testpack wird gebaut…');
    try {
      const t = buildGameTest(base.pack);
      setFound(t.groups.filter((g) => g.found > 0 && !g.freq).map((g) => g.beeps));
      setFoundReload(t.groups.filter((g) => g.found > 0 && g.freq).map((g) => g.beeps));
      // never installed automatically: always one ZIP the tester unpacks into the mods folder himself
      const saved = await saveToDownloads('Zuordnungstest', t.outputs);
      toast('info', 'Testpack gespeichert', `${saved.zip} ${saved.dir ? 'liegt in Downloads › SP Tool' : 'liegt in deinem Download-Ordner'} – entpacken, die Dateien in GTA V\\x64\\audio\\sfx kopieren und FiveM starten.`);
      if (saved.dir) void showDownloads();
      logger.info(`Zuordnungstest gebaut: ${t.groups.map((g) => `${g.beeps}×=${g.found}`).join(', ')}`);
      setStep('listen');
    } catch (e) {
      toast('error', 'Testpack fehlgeschlagen', e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const save = async (publish: boolean) => {
    const ordered: TestAnswers = {};
    for (const q of QUESTIONS) if (answers[q.key] !== undefined) ordered[q.key] = answers[q.key];
    const r = applyGameTest(loadMapping(), ordered);
    // reload: a beep pattern belongs to the first pistol that heard it (the game shares sounds between pistols)
    let mapping = r.mapping, reloadAdded = 0;
    const taken = new Set<number>();
    const reloadShared: string[] = [];
    for (const w of WEAPON_PROFILES) {
      const heard = reloads[w.id];
      if (!heard?.length) continue;
      const mine = heard.filter((b) => !taken.has(b));
      if (mine.length < heard.length) reloadShared.push(`${w.displayName} lädt (teilweise) mit denselben Sounds nach wie eine andere Pistole.`);
      if (!mine.length) continue;
      mine.forEach((b) => taken.add(b));
      const rr = applyReloadTest(mapping, w.id, mine);
      mapping = rr.mapping; reloadAdded += rr.added;
    }
    saveMapping(mapping);
    let published: number | null = null;
    if (publish) {
      setBusy('Wird veröffentlicht…');
      try { published = await publishMapping(mapping); }
      catch (e) { toast('error', 'Veröffentlichen fehlgeschlagen', e instanceof Error ? e.message : String(e)); }
      finally { setBusy(null); }
    }
    const nameOf = (k: string) => QUESTIONS.find((q) => q.key === k)?.label ?? k;
    setResult({ added: r.added + reloadAdded, shared: [...r.shared.map((s) => `${nameOf(s.key)} benutzt im Spiel denselben Schuss wie ${nameOf(s.with)}.`), ...reloadShared], published });
    logger.info(`Zuordnungstest gespeichert: ${JSON.stringify(ordered)} · Nachladen ${JSON.stringify(reloads)}${published !== null ? `, veröffentlicht (${published})` : ''}`);
    setStep('saved');
  };

  const answered = QUESTIONS.filter((q) => answers[q.key] !== undefined).length + Object.values(reloads).filter((x) => x.length).length;
  const toggleReload = (w: string, b: number) => setReloads((r) => { const cur = r[w] ?? []; return { ...r, [w]: cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b] }; });
  const choices = [0, ...TEST_GROUPS.map((g) => g.beeps)];

  return (
    <Modal onClose={close}>
      <div className="game-test">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <div className="qp-badge"><Icon name="target" size={18} /></div>
          <h3 className="grow" style={{ margin: 0 }}>Test im Spiel</h3>
          {!busy && <button className="icon-btn" onClick={close} aria-label="Schließen"><Icon name="x" size={17} /></button>}
        </div>
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={mode === 'search' ? 'on' : ''} disabled={!!busy} onClick={() => setMode('search')}>Suchtest (empfohlen)</button>
          <button className={mode === 'quick' ? 'on' : ''} disabled={!!busy} onClick={() => setMode('quick')}>Schnelltest (3 Kandidaten)</button>
        </div>
        {mode === 'search' && <SearchTest busy={busy} setBusy={setBusy} />}

        {mode === 'quick' && step === 'prepare' && <>
          <p className="muted" style={{ marginTop: 0 }}>
            SP Tool baut aus deinem Basis-Pack ein Testpack: Jeder unbekannte Pistolen-Schuss wird durch <b>hohe</b> Pieptöne ersetzt (1×, 2× oder 3×),
            die Nachlade-Sounds durch <b>tiefe</b>. Du bekommst es als ZIP, ziehst die Dateien in deinen sfx-Ordner (GTA V › x64 › audio › sfx), schießt und lädst einmal mit jeder Pistole und klickst an, was du gehört hast.
          </p>
          <div className="qp-label">Basis</div>
          <BasePicker />
          <div className="row" style={{ marginTop: 16, gap: 10 }}>
            <span className="grow small muted">{busy ?? 'Kommt als ZIP in deine Downloads.'}</span>
            <Button variant="primary" size="lg" icon="download" disabled={!base || !!busy} onClick={() => void prepare()}>Testpack erstellen</Button>
          </div>
        </>}

        {mode === 'quick' && step === 'listen' && <>
          <ol className="gt-steps muted">
            <li>FiveM starten (oder neu verbinden, damit das Testpack geladen wird).</li>
            <li>Mit jeder Pistole <b>einen</b> Schuss abgeben – ohne Schalldämpfer – und anklicken, wie oft es <b>hoch</b> gepiept hat. Klang es normal, wähl „Normal“.</li>
            <li>Dann jede Pistole einmal <b>nachladen</b> (R) und die <b>tiefen</b> Pieptöne <b>in der Reihenfolge</b> anklicken, in der sie kamen (z. B. erst 2×, dann 1×).</li>
          </ol>
          <div className="gt-questions">
            {QUESTIONS.map((q) => (
              <div key={q.key} className="gt-q">
                <b className="grow">{q.label}</b>
                <div className="seg" role="radiogroup" aria-label={q.label}>
                  {choices.map((c) => (
                    <button key={c} role="radio" aria-checked={answers[q.key] === c} className={answers[q.key] === c ? 'on' : ''} disabled={c > 0 && !found.includes(c)}
                      onClick={() => setAnswers((a) => ({ ...a, [q.key]: c }))}>{c === 0 ? 'Normal' : `${c}× Piep`}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="qp-label" style={{ marginTop: 14 }}>Nachladen – tiefe Pieptöne in Reihenfolge</div>
          <div className="gt-questions">
            {WEAPON_PROFILES.map((w) => {
              const heard = reloads[w.id] ?? [];
              return (
                <div key={w.id} className="gt-q">
                  <b className="grow">{w.displayName}{heard.length > 0 && <span className="small muted"> · {heard.map((b) => `${b}×`).join(' → ')}</span>}</b>
                  <div className="seg" role="group" aria-label={`${w.displayName} nachladen`}>
                    <button className={!heard.length ? 'on' : ''} onClick={() => setReloads((r) => ({ ...r, [w.id]: [] }))}>Normal</button>
                    {RELOAD_TEST_GROUPS.map((g) => (
                      <button key={g.beeps} aria-pressed={heard.includes(g.beeps)} className={heard.includes(g.beeps) ? 'on' : ''} disabled={!foundReload.includes(g.beeps)}
                        onClick={() => toggleReload(w.id, g.beeps)}>{heard.includes(g.beeps) ? `${heard.indexOf(g.beeps) + 1}. ` : ''}{g.beeps}× tief</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => setStep('prepare')}>Zurück</Button>
            <span className="grow small muted">{busy ?? `${answered} von ${QUESTIONS.length * 2} beantwortet`}</span>
            <Button disabled={!answered || !!busy} onClick={() => void save(false)}>Nur hier speichern</Button>
            {admin && <Button variant="primary" icon="upload" disabled={!answered || !!busy} onClick={() => void save(true)}>Speichern & an alle senden</Button>}
          </div>
        </>}

        {mode === 'quick' && step === 'saved' && result && (
          <div className="qp-done">
            <DoneMark />
            <h3 style={{ margin: '8px 0 2px' }}>Zuordnung gespeichert</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {result.added} Sounds zugeordnet{result.published !== null ? ` und an alle SP-Tool-Nutzer geschickt (${result.published} insgesamt).` : '.'}
            </p>
            {result.shared.map((s) => <p key={s} className="small muted" style={{ margin: '0 0 4px' }}><Icon name="info" size={13} /> {s}</p>)}
            <p className="small faint">Leg danach wieder deine eigenen Dateien in den sfx-Ordner und bau jetzt dein Soundpack.</p>
            <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => { setState({ gameTestOpen: false }); navigate('create'); }}>Soundpack erstellen</Button>
              <Button variant="ghost" onClick={close}>Schließen</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
