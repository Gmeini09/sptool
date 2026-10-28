// Start-up intro – the one big motion moment of SP Tool.
//
//   0.00s  a single light line ignites across the dark
//   0.25s  the turbine housing fades in, the rotor spools up while the boost gauge fills
//   1.60s  full boost: flash, pressure ring, light streaks – the wordmark slams in with a steel sheen
//   2.55s  the intro opens like a lens from the centre and the app slides in behind it
//
// Runs on every app start (once per window session). Click or any key skips straight to the reveal.
// Not shown with "Reduce motion" or the OS reduced-motion setting.
import { useEffect, useRef, useState } from 'react';
import { motionAllowed } from '../fx/effects';

const KEY = 'sptool:intro-shown';
const T_REVEAL = 2550;
const T_DONE = 3250;

type Phase = 'run' | 'reveal' | 'done';
const setRootPhase = (p: Phase | null) => {
  const r = document.documentElement;
  if (p) r.dataset.intro = p; else delete r.dataset.intro;
};

export function introWillRun(): boolean {
  try { if (sessionStorage.getItem(KEY)) return false; } catch { /* ignore */ }
  return motionAllowed();
}

export function BootIntro() {
  const [phase, setPhase] = useState<Phase>(() => (introWillRun() ? 'run' : 'done'));
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (phase === 'done') { setRootPhase(null); return; }
    if (phase === 'reveal') {
      // own timer for the end of the reveal: the one started in reveal() is cleared by the cleanup of the 'run' effect,
      // which left the intro (and data-intro="reveal" on <html>) in place forever and replayed entrance animations
      setRootPhase('reveal');
      const t = window.setTimeout(() => { setPhase('done'); setRootPhase(null); }, T_DONE - T_REVEAL);
      return () => clearTimeout(t);
    }
    try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    setRootPhase('run');
    const reveal = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase('reveal');
      setRootPhase('reveal');
    };
    timers.current = [window.setTimeout(reveal, T_REVEAL)];
    const skip = () => reveal();
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      timers.current.forEach(clearTimeout);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [phase]);

  if (phase === 'done') return null;
  const ticks = Array.from({ length: 48 }, (_, i) => i);
  const blades = Array.from({ length: 11 }, (_, i) => i * (360 / 11));
  return (
    <div className={`intro intro-${phase}`} aria-hidden="true">
      <div className="intro-line" />
      <div className="intro-stage">
        <svg className="intro-turbine" viewBox="-120 -120 240 240">
          <defs>
            <linearGradient id="it-steel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f4f7fb" /><stop offset=".46" stopColor="#9aa6b8" />
              <stop offset=".54" stopColor="#525d6e" /><stop offset="1" stopColor="#dbe2ec" />
            </linearGradient>
            <linearGradient id="it-blade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#1b2230" /><stop offset=".62" stopColor="#8494aa" /><stop offset="1" stopColor="#6ab4ff" />
            </linearGradient>
            <radialGradient id="it-core" r=".5">
              <stop offset="0" stopColor="#6ab4ff" stopOpacity=".55" /><stop offset="1" stopColor="#2b83ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* boost gauge: ticks light up as the rotor spools */}
          <g className="intro-ticks">
            {ticks.map((i) => (
              <line key={i} x1="0" y1="-112" x2="0" y2={i % 4 === 0 ? -100 : -105} transform={`rotate(${-135 + i * (270 / 47)})`} style={{ animationDelay: `${300 + i * 26}ms` }} />
            ))}
          </g>
          <circle className="intro-gauge" r="92" pathLength="100" />
          <circle r="80" fill="#04070c" stroke="url(#it-steel)" strokeWidth="7" />
          <circle r="73" fill="none" stroke="#2b83ff" strokeWidth="1" opacity=".7" />
          <circle className="intro-core" r="70" fill="url(#it-core)" />
          <g className="intro-rotor">
            <g className="intro-rotor-spin">
              {blades.map((a) => (
                <path key={a} transform={`rotate(${a})`} d="M 12 -3.5 C 28 -11, 50 -18, 68 -11 C 61 -2, 40 5, 14 5 Z" fill="url(#it-blade)" stroke="#05080e" strokeWidth="1" />
              ))}
              <circle r="16" fill="url(#it-steel)" />
              <circle r="7" fill="#05080e" stroke="#6ab4ff" strokeWidth="1.5" />
            </g>
          </g>
        </svg>
        <div className="intro-blur" />
        <div className="intro-ring" />
        <div className="intro-flash" />
        <div className="intro-streaks"><i /><i /><i /><i /></div>
        <div className="intro-word">
          <div className="intro-title" data-text="SP TOOL">SP TOOL</div>
          <div className="intro-by"><img src="assets/brand/emblem.jpg" alt="" /><span>von Turbo Design</span></div>
        </div>
      </div>
      <div className="intro-skip">Klicken zum Überspringen</div>
    </div>
  );
}
