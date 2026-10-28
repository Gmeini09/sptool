// Motion helpers: reduced-motion check and the audio level (--level) used by the playing indicator.
import { engine } from '../audio/engine';
import { getState } from '../app/store';

export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (getState().settings.reducedMotion) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}


let last = { x: innerWidth / 2, y: innerHeight / 2 };
export const lastPointer = () => last;

// Success moments are shown by the UI itself (toast, slot lock-in). These stay as no-ops so callers
// don't need to change; the old particle bursts, card tilt and click ripples were removed for a calmer UI.
export function burst(_x?: number, _y?: number, _count?: number, _power?: number) { /* intentionally quiet */ }
export function burstAt(_el: Element | null, _count?: number, _power?: number) { /* intentionally quiet */ }
export function shockwave(_x: number, _y: number) { /* intentionally quiet */ }

const track = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };

// Audio-reactive glow: --level (0..1) on the root while something plays.
let levelRaf = 0;
function levelLoop() {
  const root = document.documentElement;
  if (!engine.playingKey) { root.style.setProperty('--level', '0'); root.classList.remove('is-playing'); levelRaf = 0; return; }
  const pk = engine.peak();
  const v = Math.min(1, Math.max(0, (20 * Math.log10(pk + 1e-6) + 48) / 48));
  root.style.setProperty('--level', v.toFixed(3));
  root.classList.add('is-playing');
  levelRaf = requestAnimationFrame(levelLoop);
}

let started = false;
export function initFx() {
  if (started) return;
  started = true;
  addEventListener('pointerdown', track, { passive: true });
  engine.subscribe(() => { if (engine.playingKey && !levelRaf && motionAllowed()) levelRaf = requestAnimationFrame(levelLoop); });
}
