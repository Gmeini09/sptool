import { useEffect, useRef, useState } from 'react';
import { burstAt } from '../fx/effects';
import { engine } from '../audio/engine';
import { audioWorker, type Rendered } from '../audio/workerClient';
import { addUserEntry, notify, openInEditor, toast, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { MiniWave } from '../components/MiniWave';
import { Button, Segmented, Slider, fmtDb, fmtDur, fmtLufs } from '../components/ui';
import { FIRE_STYLES, SUPPRESSOR_STYLES, WEAPONS } from '../library/catalog';
import { newId } from '../library/actions';
import type { SoundType, Style, WeaponId } from '../models/types';
import { WEAPON_LABEL } from '../models/types';
import { saveBytes } from '../services/tauri';
import { DEFAULT_SYNTH, mulberry32, smartRandomize, SYNTH_VERSION, type SynthKind, type SynthParams } from '../synth/synth';

const MECH_KINDS: Array<{ kind: SynthKind; label: string; type: SoundType }> = [
  { kind: 'mag_out', label: 'Magazin raus', type: 'reload' }, { kind: 'mag_in', label: 'Magazin rein', type: 'reload' },
  { kind: 'mag_drop', label: 'Magazin fallen lassen', type: 'reload' }, { kind: 'slide_pull', label: 'Schlitten ziehen', type: 'mechanical' },
  { kind: 'slide_release', label: 'Schlitten loslassen', type: 'mechanical' }, { kind: 'chamber', label: 'Durchladen', type: 'mechanical' },
  { kind: 'reload_fast', label: 'Schnelles Nachladen', type: 'reload' }, { kind: 'reload_clean', label: 'Komplettes Nachladen', type: 'reload' },
  { kind: 'dry_fire', label: 'Leerschuss', type: 'handling' }, { kind: 'draw', label: 'Waffe ziehen', type: 'handling' },
  { kind: 'holster', label: 'Waffe wegstecken', type: 'handling' }, { kind: 'safety', label: 'Sicherung klicken', type: 'handling' },
];

type Mode = 'fire' | 'suppressed' | 'mech';
interface Gen { params: SynthParams; r: Rendered; at: number }

export function GeneratorView() {
  const defaultStyle = useApp((s) => s.settings.defaultStyle);
  const [mode, setMode] = useState<Mode>('fire');
  const [weapon, setWeapon] = useState<WeaponId>('pistol_mk2');
  const [mechKind, setMechKind] = useState<SynthKind>('slide_release');
  const [style, setStyle] = useState<string>(FIRE_STYLES[defaultStyle] ? defaultStyle : 'Clean');
  const [p, setP] = useState<SynthParams>(() => ({ ...DEFAULT_SYNTH, ...FIRE_STYLES[style], kind: 'fire', caliber: 0.55, seed: 1001 }));
  const [cur, setCur] = useState<Gen | null>(null);
  const [history, setHistory] = useState<Gen[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const seq = useRef(0);
  const playKey = 'generator';

  const styles = mode === 'suppressed' ? SUPPRESSOR_STYLES : FIRE_STYLES;
  const kind: SynthKind = mode === 'fire' ? 'fire' : mode === 'suppressed' ? 'suppressed' : mechKind;
  const w = WEAPONS.find((x) => x.id === weapon)!;

  // Re-render whenever parameters change (debounced), keeping the seed.
  useEffect(() => {
    const id = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const params = { ...p, kind, caliber: w.caliber };
      try {
        const r = await audioWorker.synth(params);
        if (id !== seq.current) return;
        setCur({ params, r, at: Date.now() });
      } catch (e) {
        toast('error', 'Erzeugen fehlgeschlagen', String(e));
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [p, kind, w.caliber]);

  const play = (g = cur) => { if (!g) return; if (engine.playingKey === playKey) { engine.stop(); return; } engine.play(g.r.audio, { key: playKey }); };
  const pushHistory = () => { if (cur) setHistory((h) => [cur, ...h.filter((x) => x.params.seed !== cur.params.seed)].slice(0, 12)); };
  const generate = () => { pushHistory(); setP((x) => ({ ...x, seed: Math.floor(Math.random() * 1e9) })); burstAt(document.querySelector('.gen-big'), 70, 1.2); const el = document.querySelector('.gen-big'); el?.classList.remove('charged'); void (el as HTMLElement | null)?.offsetWidth; el?.classList.add('charged'); };
  const applyStyle = (s: string) => { setStyle(s); setP((x) => ({ ...x, ...DEFAULT_SYNTH, ...styles[s], seed: x.seed })); };
  const randomizeAll = () => {
    pushHistory();
    const r = mulberry32(Date.now());
    setP((x) => ({ ...x, seed: Math.floor(r() * 1e9), punch: r(), bass: r(), transient: r(), metal: r(), tail: r(), room: r() * 0.7, noise: r(), dynamics: r(), pitch: Math.round((r() * 12 - 6) * 10) / 10, length: 0.6 + r() * 0.8 }));
  };
  const smart = () => { pushHistory(); setP((x) => smartRandomize(x, 0.18)); };

  // auto-play newly generated sound once (spec: "Danach: neue Soundvariation – Play")
  const lastSeed = useRef(p.seed);
  useEffect(() => {
    if (cur && cur.params.seed !== lastSeed.current) { lastSeed.current = cur.params.seed; engine.play(cur.r.audio, { key: playKey }); }
  }, [cur]);

  const defaultName = () => {
    const label = mode === 'mech' ? MECH_KINDS.find((m) => m.kind === mechKind)!.label : `${style}${mode === 'suppressed' ? ' Schalldämpfer' : ''} ${w.short}`;
    return `Erzeugt ${label} ${String(p.seed % 1000).padStart(3, '0')}`;
  };
  const save = (thenEdit = false) => {
    if (!cur) return;
    const id = newId('gen');
    const type: SoundType = mode === 'fire' ? 'fire' : mode === 'suppressed' ? 'suppressor' : MECH_KINDS.find((m) => m.kind === mechKind)!.type;
    const nm = name.trim() || defaultName();
    addUserEntry({
      id, name: nm, creator: 'Du', license: 'Dein eigener – erzeugt mit SP Tool', sourceInfo: `procedural:v${SYNTH_VERSION} seed ${cur.params.seed}`,
      source: 'generated', weapon: mode === 'mech' ? 'universal' : weapon, type, style: (mode === 'mech' ? 'Clean' : style) as Style,
      tags: ['generated', style.toLowerCase()], version: '1.0.0', createdAt: Date.now(), synth: cur.params, estDuration: cur.r.analysis.duration,
    });
    setName('');
    toast('success', 'In Bibliothek gespeichert', nm);
    notify('Erzeugter Sound gespeichert', nm);
    if (thenEdit) openInEditor(id);
  };
  const exportWav = async () => {
    if (!cur) return;
    const bytes = await audioWorker.encode(cur.r.audio, 16);
    const path = await saveBytes(`${(name.trim() || defaultName()).replace(/[^\w .-]+/g, '').replace(/\s+/g, '_')}.wav`, bytes, { name: 'WAV-Audio', extensions: ['wav'] });
    if (path) toast('success', 'WAV exportiert', path);
  };

  const slider = (key: keyof SynthParams, label: string) => (
    <Slider key={key} label={label} value={p[key] as number} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setP((x) => ({ ...x, [key]: v }))} />
  );
  const a = cur?.r.analysis;

  return (
    <div className="gen">
      <section className="gen-stage">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Segmented value={mode} onChange={(m) => { setMode(m); if (m !== 'mech') { const st = (m === 'suppressed' ? SUPPRESSOR_STYLES : FIRE_STYLES)[style] ? style : 'Clean'; setStyle(st); setP((x) => ({ ...x, ...DEFAULT_SYNTH, ...(m === 'suppressed' ? SUPPRESSOR_STYLES : FIRE_STYLES)[st], seed: x.seed })); } }}
            options={[{ value: 'fire', label: 'Schuss' }, { value: 'suppressed', label: 'Mit Schalldämpfer' }, { value: 'mech', label: 'Nachladen & Handhabung' }]} />
          {mode !== 'mech' && <Segmented value={weapon} onChange={setWeapon} options={WEAPONS.map((x) => ({ value: x.id, label: WEAPON_LABEL[x.id] }))} />}
        </div>
        <div className="gen-big">
          <div className="row" style={{ marginBottom: 10 }}>
            <strong>{defaultName()}</strong>
            {busy && <span className="faint small">wird berechnet…</span>}
            <span className="spacer" />
            <span className="faint small num">Seed {p.seed}</span>
          </div>
          {cur ? <MiniWave peaks={cur.r.peaks.filter((_, i) => i % 2 === 1)} height={180} /> : <div className="wave-skeleton" style={{ height: 180 }} />}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="mega-cta"><Button variant="primary" size="lg" icon="sparkles" onClick={generate}>Sound erzeugen</Button></span>
          <Button size="lg" icon="play" onClick={() => play()} disabled={!cur}>Abspielen</Button>
          <Button icon="dice" onClick={smart} title="Kleine, kontrollierte Änderungen an Tonhöhe, Transient, Bass, Ausklang und Ebenen-Mix">Sanft variieren</Button>
          <Button icon="dice" variant="ghost" onClick={randomizeAll} title="Alle Parameter zufällig setzen">Zufällig</Button>
        </div>
        {a && (
          <div className="analysis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[['Dauer', fmtDur(a.duration)], ['Spitzenpegel', fmtDb(a.peakDb)], ['Lautstärke', fmtLufs(a.lufs)], ['Dynamikumfang', `${a.dynamicRangeDb.toFixed(1)} dB`]].map(([k, v]) => (
              <div className="a-cell" key={k}><div className="a-k">{k}</div><div className="a-v">{v}</div></div>
            ))}
          </div>
        )}
        <section className="panel">
          <div className="panel-body row" style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder={defaultName()} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={60} />
            <Button icon="plus" onClick={() => save(false)} disabled={!cur}>In Bibliothek speichern</Button>
            <Button icon="edit" onClick={() => save(true)} disabled={!cur}>Speichern und bearbeiten</Button>
            <Button icon="export" variant="ghost" onClick={() => void exportWav()} disabled={!cur}>WAV exportieren</Button>
          </div>
        </section>
        {history.length > 0 && (
          <div>
            <div className="section-title" style={{ marginTop: 6 }}><h2>Frühere Varianten</h2><span className="faint small">Klicken zum Wiederherstellen</span></div>
            <div className="gen-history">
              {history.map((g) => (
                <button key={g.at} className="sound-card" style={{ height: 'auto', textAlign: 'left', color: 'inherit' }} onClick={() => { pushHistory(); setP(g.params); }}>
                  <div className="sc-meta"><Icon name="sparkles" size={13} /><span className="num">Seed {g.params.seed}</span><span className="spacer" />{fmtDur(g.r.analysis.duration)}</div>
                  <MiniWave peaks={g.r.peaks.filter((_, i) => i % 2 === 1)} height={36} />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="gen-controls" aria-label="Parameter zum Erzeugen">
        {mode === 'mech' ? (
          <label className="field">Sound
            <select className="select" value={mechKind} onChange={(e) => setMechKind(e.target.value as SynthKind)}>
              {MECH_KINDS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
            </select>
          </label>
        ) : (
          <label className="field">Stil
            <select className="select" value={style} onChange={(e) => applyStyle(e.target.value)}>
              {Object.keys(styles).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {slider('punch', 'Punch')}
        {slider('bass', 'Bass')}
        {slider('transient', 'Transient')}
        {slider('metal', 'Metall')}
        {slider('tail', 'Ausklang')}
        {slider('room', 'Raum')}
        {slider('noise', 'Rauschen')}
        {slider('dynamics', 'Dynamik')}
        <Slider label="Tonhöhe" value={p.pitch} min={-12} max={12} step={0.1} def={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} HT`} onChange={(v) => setP((x) => ({ ...x, pitch: v }))} />
        <Slider label="Länge" value={p.length} min={0.4} max={2} step={0.01} def={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setP((x) => ({ ...x, length: v }))} />
        <div className="faint small">Jeder Sound wird aus diesen Parametern und einem Seed berechnet – ohne Aufnahmen. Alles, was du erzeugst, darfst du frei verwenden.</div>
      </aside>
    </div>
  );
}
