// Anleitungs-Panel links neben dem Menü: erklärt die aktuelle Seite ausführlich, zeigt den Fortschritt
// und alle Kapitel. Lässt sich ein- und ausklappen (Einstellung `tutorialOpen`).
import { useEffect, useState } from 'react';
import { navigate, setState, updateSettings, useApp } from '../app/store';
import { navLabel } from '../app/nav';
import { CHAPTERS, PAGE_GUIDE } from '../app/tutorial';
import { FirstPackSteps } from '../views/Home';
import { Icon } from './Icon';

type Tab = 'page' | 'all';

export const toggleTutorial = (open?: boolean) => setState((s) => ({ settings: { ...s.settings, tutorialOpen: open ?? !s.settings.tutorialOpen } }));

export function TutorialPanel({ inSheet }: { inSheet?: boolean }) {
  const route = useApp((s) => s.route);
  const [tab, setTab] = useState<Tab>('page');
  const [openCh, setOpenCh] = useState<string | null>('start');
  const g = PAGE_GUIDE[route];
  useEffect(() => { setTab('page'); }, [route]);

  return (
    <aside className={`tut${inSheet ? ' in-sheet' : ''}`} aria-label="Anleitung">
      {!inSheet && (
        <div className="tut-head">
          <Icon name="book" size={17} />
          <span className="grow">Anleitung</span>
          <button className="icon-btn" title="Anleitung einklappen" aria-label="Anleitung einklappen" onClick={() => toggleTutorial(false)}><Icon name="x" size={15} /></button>
        </div>
      )}
      <div className="tut-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'page'} className={tab === 'page' ? 'on' : ''} onClick={() => setTab('page')}>Diese Seite</button>
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Alle Themen</button>
        <span className="tut-tab-pill" style={{ transform: `translateX(${tab === 'page' ? 0 : 100}%)` }} aria-hidden="true" />
      </div>

      <div className="tut-body" key={`${tab}-${route}`}>
        {tab === 'page' ? (
          <>
            <div className="tut-kicker">Du bist hier</div>
            <h3 className="tut-title">{g?.title ?? navLabel(route)}</h3>
            {g ? <p className="tut-p">{g.intro}</p> : <p className="tut-p">Zu dieser Seite gibt es noch keine Anleitung. Unter „Alle Themen“ findest du den ganzen Ablauf.</p>}
            {g?.steps && (
              <section className="tut-sec">
                <h4>So geht’s</h4>
                <ol className="tut-steps">{g.steps.map((x) => <li key={x}>{x}</li>)}</ol>
              </section>
            )}
            {g?.tips && (
              <section className="tut-sec">
                <h4>Tipps</h4>
                <ul className="tut-tips">{g.tips.map((x) => <li key={x}><Icon name="sparkles" size={13} />{x}</li>)}</ul>
              </section>
            )}
            {g?.problems && (
              <section className="tut-sec">
                <h4>Wenn etwas nicht klappt</h4>
                {g.problems.map((p) => <details key={p.q} className="tut-faq"><summary>{p.q}</summary><p>{p.a}</p></details>)}
              </section>
            )}
            {g?.next && <button className="btn primary tut-next" onClick={() => navigate(g.next!.route)}>{g.next.label}<Icon name="chevron" size={14} /></button>}
            <section className="tut-sec">
              <h4>Dein Fortschritt</h4>
              <div className="tut-progress"><FirstPackSteps /></div>
            </section>
          </>
        ) : (
          <>
            <div className="tut-kicker">Komplette Anleitung</div>
            <h3 className="tut-title">Vom leeren Pack zum Sound in FiveM</h3>
            <div className="tut-chapters">
              {CHAPTERS.map((c, n) => {
                const open = openCh === c.id;
                return (
                  <div key={c.id} className={`tut-ch${open ? ' open' : ''}`} style={{ ['--i' as string]: n }}>
                    <button className="tut-ch-head" aria-expanded={open} onClick={() => setOpenCh(open ? null : c.id)}>
                      <span className="tut-ch-icon"><Icon name={c.icon} size={15} /></span>
                      <span className="grow">{c.title}</span>
                      <Icon name="chevronDown" size={15} />
                    </button>
                    <div className="tut-ch-body"><div>
                      {c.body.map((b) => <p key={b}>{b}</p>)}
                      {c.route && <button className="btn sm" onClick={() => navigate(c.route!)}>{c.cta ?? navLabel(c.route)}<Icon name="chevron" size={13} /></button>}
                    </div></div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="tut-foot">
        <button className="btn ghost sm" onClick={() => setState({ tourOpen: true })}><Icon name="play" size={13} />Tour ansehen</button>
        <button className="btn ghost sm" onClick={() => updateSettings({ hintsSeen: [] })} title="Die kurzen Hinweise oben auf jeder Seite wieder einblenden">Hinweise zurücksetzen</button>
      </div>
    </aside>
  );
}
