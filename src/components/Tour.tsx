// Welcome tour: explains the whole tool in five short cards. Opens once for every user
// and again from the help button in the top bar.
import { useEffect, useState } from 'react';
import { navigate, setState, updateSettings, useApp, type Route } from '../app/store';
import { Icon, type IconName } from './Icon';
import { Modal } from './ui';

interface Card { icon: IconName; kicker: string; title: string; body: string; points?: string[]; go?: { label: string; route: Route } }

const CARDS: Card[] = [
  {
    icon: 'sparkles', kicker: 'Willkommen', title: 'Deine eigenen Waffensounds für FiveM',
    body: 'Mit SP Tool baust du aus deinen Sounds ein Soundpack – ohne Vorwissen.',
    points: ['Pistol → MK2 → .50 → Nachladen → fertig', 'Eigene Sounds reinziehen (MP3, WAV, OGG …)', 'Oder Sounds aus einem fertigen SP nehmen'],
  },
  {
    icon: 'hammer', kicker: 'So geht’s', title: 'Ein Klick auf „Soundpack erstellen“',
    body: 'Für jede Pistole einen Sound reinziehen oder aus einem SP holen, beim Nachladen den ganzen Reload oder die Teile – oder „Reload & Rest“ von einem fertigen SP übernehmen. Am Ende liegen WEAPONS_PLAYER.rpf und RESIDENT.rpf in deinen Downloads.',
    go: { label: 'Soundpack erstellen', route: 'create' },
  },
  {
    icon: 'info', kicker: 'Gut zu wissen', title: 'Mehr Werkzeuge? „Experte“',
    body: 'Unten im Menü schaltest du auf „Experte“ – dann siehst du Sound-Editor, Generator, Pack-Analyse und mehr.',
  },
];

export function Tour() {
  const open = useApp((s) => s.tourOpen);
  const done = useApp((s) => s.settings.tourDone);
  const onboarded = useApp((s) => s.onboarded && !!s.session);
  const [i, setI] = useState(0);
  // first start: open once, shortly after the intro
  useEffect(() => {
    if (done || !onboarded) return;
    const t = setTimeout(() => setState({ tourOpen: true }), 900);
    return () => clearTimeout(t);
  }, [done, onboarded]);
  useEffect(() => { if (open) setI(0); }, [open]);
  if (!open) return null;
  const close = (route?: Route) => { setState({ tourOpen: false }); updateSettings({ tourDone: true }); if (route) navigate(route); };
  const c = CARDS[i];
  const last = i === CARDS.length - 1;
  return (
    <Modal onClose={() => close()}>
      <div className="tour" key={i}>
        <div className="tour-icon"><Icon name={c.icon} size={26} /></div>
        <div className="tour-kicker">{c.kicker}</div>
        <h3 className="tour-title">{c.title}</h3>
        <p className="tour-body">{c.body}</p>
        {c.points && <ul className="tour-points">{c.points.map((p) => <li key={p}><Icon name="check" size={14} />{p}</li>)}</ul>}
        <div className="tour-dots" aria-hidden="true">{CARDS.map((_, n) => <span key={n} className={n === i ? 'on' : ''} />)}</div>
        <div className="tour-actions">
          <button className="btn ghost" onClick={() => close()}>{last ? 'Schließen' : 'Überspringen'}</button>
          <span className="grow" />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Zurück</button>}
          {c.go && <button className="btn" onClick={() => close(c.go!.route)}>{c.go.label}</button>}
          <button className="btn primary" onClick={() => (last ? close('home') : setI(i + 1))}>{last ? 'Los geht’s' : 'Weiter'}</button>
        </div>
      </div>
    </Modal>
  );
}
