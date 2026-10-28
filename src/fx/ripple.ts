// Click ripple: a soft circle spreads from the pointer on buttons, menu items and cards.
// One delegated listener for the whole app; skipped with reduced motion.
import { motionAllowed } from './effects';

const TARGETS = '.btn, .nav-item, .step-card, .quick button, .help-btn, .tut-ch-head, .view-switch button, .tut-tabs button, .more-item, .bottom-nav button, .sp-slot, .sound-card, .recent-item';

export function installRipple() {
  if (typeof document === 'undefined') return;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !motionAllowed()) return;
    const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
    if (!el || (el as HTMLButtonElement).disabled) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    const r = el.getBoundingClientRect();
    const size = Math.hypot(Math.max(e.clientX - r.left, r.right - e.clientX), Math.max(e.clientY - r.top, r.bottom - e.clientY)) * 2;
    // a clipping layer inside the element – the element itself keeps its own overflow
    const clip = document.createElement('span');
    clip.className = 'ripple-clip';
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `left:${e.clientX - r.left - el.clientLeft}px;top:${e.clientY - r.top - el.clientTop}px;width:${size}px;height:${size}px`;
    clip.appendChild(dot);
    el.appendChild(clip);
    window.setTimeout(() => clip.remove(), 700);
  }, { passive: true });
}
