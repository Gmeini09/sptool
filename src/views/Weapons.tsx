import { useMemo } from 'react';
import { allEntries } from '../library/assets';
import { slotMatches } from '../projects/project';
import { navigate, setState, useApp } from '../app/store';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { TYPE_LABEL } from '../models/types';
import { WEAPON_PROFILES } from '../weapons/profiles';

export function WeaponsView() {
  const dev = useApp((s) => s.settings.devMode);
  const userEntries = useApp((s) => s.userEntries);
  const cat = useMemo(() => allEntries(), [userEntries]);
  return (
    <div className="page">
      <h2 style={{ margin: 0, font: '600 20px var(--font-display)' }}>Waffenprofile</h2>
      <p className="muted" style={{ margin: '4px 0 18px', maxWidth: '70ch' }}>Jede Waffe wird durch eine Profildatei in <code>weapon_profiles/</code> beschrieben. Eine neue Waffe braucht später nur eine neue Datei – ohne Änderungen am Editor.</p>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {WEAPON_PROFILES.map((w) => {
          const count = cat.filter((e) => w.slots.some((s) => slotMatches(e, w.id, s.id))).length;
          return (
            <section key={w.id} className="panel weapon-card">
              <div className="row">
                <div className="p-icon" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-2)' }}><Icon name="target" size={20} /></div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, font: '600 16px var(--font-display)' }}>{w.displayName}</h3>
                  <div className="faint small">{w.internalName}</div>
                </div>
                <span className="chip">{count} {count === 1 ? 'Sound' : 'Sounds'}</span>
              </div>
              <div className="slot-list">
                {w.slots.map((s) => (
                  <div key={s.id}><span style={{ flex: 1 }}>{s.label}</span><span className="faint small">{TYPE_LABEL[s.type]}</span>{s.required && <span className="chip">Pflicht</span>}</div>
                ))}
              </div>
              <div className="faint small">Aufsätze</div>
              <div className="slot-list">
                {w.attachments.map((a) => (
                  <div key={a.component} title={a.note}>
                    <span style={{ flex: 1 }}>{a.label}{dev && <span className="faint small"> · {a.component}</span>}</span>
                    {a.soundSlots.length ? <span className="chip accent" style={{ whiteSpace: 'normal', textAlign: 'right', maxWidth: '62%', lineHeight: 1.3, height: 'auto', padding: '3px 8px' }}>eigener Sound: {a.soundSlots.map((id) => w.slots.find((x) => x.id === id)?.label ?? id).join(', ')}</span> : <span className="faint small">Basis-Sounds</span>}
                  </div>
                ))}
              </div>
              <div className="faint small">Ein Pack, das diese Waffe ändert, muss auch den Schalldämpfer-Sound enthalten – sonst läuft mit Schalldämpfer der Original-Sound. Ein fehlender Schalldämpfer-Sound kann aus dem Schuss-Sound abgeleitet werden.</div>
              <div className="callout small" style={{ marginTop: 0 }}>
                <Icon name="lock" size={16} />
                <div>Audioformat geprüft (AWC, PCM 16-Bit). Welcher Container und Stream zu dieser Waffe gehören und wo installiert wird, ist noch nicht bestätigt – das wird nie geraten.</div>
              </div>
              {dev && <pre className="faint small" style={{ margin: 0, whiteSpace: 'pre-wrap', userSelect: 'text' }}>{JSON.stringify({ audioContainer: w.audioContainer, installMapping: w.installMapping, formatStatus: w.formatStatus }, null, 2)}</pre>}
              <Button icon="library" onClick={() => { setState({ libraryFocus: null }); navigate('library'); }}>{w.displayName}-Sounds ansehen</Button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
