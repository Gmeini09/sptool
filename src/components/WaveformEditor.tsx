// Large interactive waveform: original timeline (editable) + rendered output lane.
import { useCallback, useEffect, useRef } from 'react';
import { computePeaks } from '../dsp/analysis';
import type { Region } from '../dsp/chain';
import { type AudioData, durationOf } from '../dsp/types';
import { engine } from '../audio/engine';

export interface WaveView { start: number; end: number }

interface Props {
  source: AudioData;
  output: AudioData | null;
  outputLabel: string;
  view: WaveView;
  onView: (v: WaveView) => void;
  selection: Region | null;
  onSelection: (r: Region | null) => void;
  cursor: number;
  onCursor: (t: number) => void;
  trimStart: number;
  trimEnd: number | null;
  onTrim: (start: number, end: number | null) => void;
  cuts: Region[];
  markers: number[];
  /** which lane the engine is playing: 'source' | 'output' */
  playingLane: 'source' | 'output' | null;
  playKey: string;
  meterRef: React.RefObject<HTMLDivElement>;
}

const SRC_H = 0.64; // fraction of canvas height for source lane
const LANE_GAP = 22;

function cssVar(el: Element, name: string, fb: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fb;
}

export function WaveformEditor(p: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<null | { kind: 'select' | 'trimStart' | 'trimEnd' | 'scroll'; anchor: number; x0: number; view0: WaveView }>(null);
  const total = durationOf(p.source);
  const sizeRef = useRef({ w: 0, h: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  // React wheel listeners are passive; block page scroll while zooming the waveform.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const xToT = useCallback((x: number) => p.view.start + (x / Math.max(1, sizeRef.current.w)) * (p.view.end - p.view.start), [p.view]);
  const tToX = useCallback((t: number) => ((t - p.view.start) / (p.view.end - p.view.start)) * sizeRef.current.w, [p.view]);

  // ── Base layer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = baseRef.current, r = rulerRef.current;
    if (!c || !r) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      sizeRef.current = { w, h };
      for (const [cv, ch] of [[c, h], [r, r.clientHeight], [overRef.current!, h]] as const) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(ch * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const accent = cssVar(c, '--accent-2', '#7289ff');
      const accentSolid = cssVar(c, '--accent', '#5865f2');
      const dim = cssVar(c, '--text-3', '#636b78');
      const border = cssVar(c, '--border', '#242a34');
      const warn = cssVar(c, '--warning', '#d99a3e');
      const srcH = Math.round(h * SRC_H);
      const sr = p.source.sampleRate;
      const s0 = Math.max(0, Math.floor(p.view.start * sr)), s1 = Math.min(p.source.channels[0].length, Math.ceil(p.view.end * sr));
      const cols = Math.max(1, Math.floor(w));
      const peaks = computePeaks(p.source, cols, s0, s1);
      // grid line
      g.fillStyle = border; g.fillRect(0, srcH / 2, w, 1);
      // regions outside trim
      const te = p.trimEnd ?? total;
      const inKeep = (t: number) => t >= p.trimStart && t <= te && !p.cuts.some((cu) => t >= Math.min(cu.start, cu.end) && t <= Math.max(cu.start, cu.end));
      const mid = srcH / 2, amp = srcH / 2 - 6;
      for (let x = 0; x < cols; x++) {
        const t = xToT(x + 0.5);
        const mn = peaks[x * 2], mx = peaks[x * 2 + 1];
        g.fillStyle = inKeep(t) ? accent : dim;
        g.globalAlpha = inKeep(t) ? 0.95 : 0.35;
        const y0 = mid - mx * amp, y1 = mid - mn * amp;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
      g.globalAlpha = 1;
      // trimmed-out shading
      g.fillStyle = 'rgba(0,0,0,0.38)';
      if (p.trimStart > p.view.start) g.fillRect(0, 0, Math.max(0, tToX(p.trimStart)), srcH);
      if (te < p.view.end) g.fillRect(tToX(te), 0, w - tToX(te), srcH);
      // cuts: hatched
      for (const cu of p.cuts) {
        const a = tToX(Math.min(cu.start, cu.end)), b = tToX(Math.max(cu.start, cu.end));
        if (b < 0 || a > w) continue;
        g.save(); g.beginPath(); g.rect(a, 0, b - a, srcH); g.clip();
        g.strokeStyle = 'rgba(217,83,79,0.55)'; g.lineWidth = 1;
        for (let k = -srcH; k < b - a + srcH; k += 7) { g.beginPath(); g.moveTo(a + k, srcH); g.lineTo(a + k + srcH, 0); g.stroke(); }
        g.restore();
      }
      // trim handles
      for (const [t, label] of [[p.trimStart, 'start'], [te, 'end']] as const) {
        const x = tToX(t);
        if (x < -2 || x > w + 2) continue;
        g.fillStyle = warn; g.fillRect(x - 1, 0, 2, srcH);
        g.beginPath();
        if (label === 'start') { g.moveTo(x, 0); g.lineTo(x + 9, 0); g.lineTo(x, 10); } else { g.moveTo(x, 0); g.lineTo(x - 9, 0); g.lineTo(x, 10); }
        g.fill();
      }
      // selection
      if (p.selection) {
        const a = tToX(Math.min(p.selection.start, p.selection.end)), b = tToX(Math.max(p.selection.start, p.selection.end));
        g.fillStyle = accentSolid; g.globalAlpha = 0.18; g.fillRect(a, 0, b - a, srcH); g.globalAlpha = 0.8;
        g.fillRect(a, 0, 1, srcH); g.fillRect(b - 1, 0, 1, srcH); g.globalAlpha = 1;
      }
      // markers
      g.fillStyle = cssVar(c, '--text', '#f5f7fa');
      p.markers.forEach((m, i) => {
        const x = tToX(m);
        if (x < 0 || x > w) return;
        g.globalAlpha = 0.6; g.fillRect(x, 0, 1, srcH); g.globalAlpha = 1;
        g.beginPath(); g.moveTo(x, srcH); g.lineTo(x + 6, srcH - 6); g.lineTo(x, srcH - 12); g.fill();
        g.font = '10px system-ui'; g.fillText(String(i + 1), x + 3, 11);
      });
      // labels + output lane
      g.font = '11px "Segoe UI", system-ui, sans-serif';
      g.fillStyle = dim;
      g.fillText('Original (A)', 8, srcH + 15);
      const outTop = srcH + LANE_GAP, outH = h - outTop - 4;
      g.fillStyle = border; g.fillRect(0, srcH, w, 1);
      g.fillStyle = dim; g.fillText(p.outputLabel, 8 + g.measureText('Original (A)').width + 18, srcH + 15);
      if (p.output && p.output.channels[0].length) {
        const op = computePeaks(p.output, cols);
        const om = outTop + outH / 2, oa = outH / 2 - 2;
        g.fillStyle = cssVar(c, '--text-2', '#9098a7');
        for (let x = 0; x < cols; x++) {
          const y0 = om - op[x * 2 + 1] * oa, y1 = om - op[x * 2] * oa;
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      }
      // ruler
      const rg = r.getContext('2d')!;
      rg.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rh = r.clientHeight;
      rg.clearRect(0, 0, w, rh);
      const span = p.view.end - p.view.start;
      const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2];
      const step = steps.find((s) => (s / span) * w > 70) ?? 2;
      rg.fillStyle = dim; rg.font = '10.5px "Segoe UI", system-ui, sans-serif';
      for (let t = Math.ceil(p.view.start / step) * step; t <= p.view.end; t += step) {
        const x = tToX(t);
        rg.fillRect(x, rh - 6, 1, 6);
        rg.fillText(step < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(1)} s`, x + 3, rh - 9);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [p.source, p.output, p.view, p.selection, p.trimStart, p.trimEnd, p.cuts, p.markers, p.outputLabel, total, xToT, tToX]);

  // ── Overlay: playhead, cursor, meter (rAF) ───────────────────────────────
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const o = overRef.current;
      if (o) {
        const dpr = window.devicePixelRatio || 1;
        const { w, h } = sizeRef.current;
        const g = o.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const srcH = Math.round(h * SRC_H);
        // edit cursor
        const cx = tToX(p.cursor);
        if (cx >= 0 && cx <= w) { g.fillStyle = 'rgba(245,247,250,0.45)'; g.fillRect(cx, 0, 1, srcH); }
        const pos = engine.playingKey === p.playKey ? engine.position() : null;
        if (pos != null && p.playingLane) {
          g.fillStyle = '#ffffff';
          if (p.playingLane === 'source') {
            const x = tToX(pos);
            g.fillRect(x, 0, 1.5, srcH);
          } else if (p.output) {
            const x = (pos / durationOf(p.output)) * w;
            g.fillRect(x, srcH + LANE_GAP, 1.5, h - srcH - LANE_GAP);
          }
        }
        if (p.meterRef.current) {
          const pk = engine.playingKey ? engine.peak() : 0;
          const db = pk > 0 ? 20 * Math.log10(pk) : -60;
          (p.meterRef.current.firstChild as HTMLDivElement).style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60))})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.cursor, p.playingLane, p.output, p.playKey, tToX, p.meterRef]);

  // ── Interaction ───────────────────────────────────────────────────────────
  const localX = (e: { clientX: number }) => e.clientX - baseRef.current!.getBoundingClientRect().left;
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const x = localX(e);
    const y = e.clientY - baseRef.current!.getBoundingClientRect().top;
    if (y > sizeRef.current.h * SRC_H) return; // output lane is read-only
    const t = xToT(x);
    const te = p.trimEnd ?? total;
    const grab = e.pointerType === 'touch' ? 20 : 6; // finger-sized handles on touch
    const near = (tt: number) => Math.abs(tToX(tt) - x) < grab;
    const kind = near(p.trimStart) ? 'trimStart' : near(te) ? 'trimEnd' : 'select';
    drag.current = { kind, anchor: t, x0: x, view0: p.view };
    if (kind === 'select') { p.onCursor(Math.max(0, Math.min(total, t))); p.onSelection(null); }
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const tt = Math.max(0, Math.min(total, xToT(localX(ev))));
      if (d.kind === 'select') { if (Math.abs(localX(ev) - d.x0) > 3) p.onSelection({ start: d.anchor, end: tt }); }
      else if (d.kind === 'trimStart') p.onTrim(Math.min(tt, (p.trimEnd ?? total) - 0.005), p.trimEnd);
      else if (d.kind === 'trimEnd') p.onTrim(p.trimStart, Math.max(tt, p.trimStart + 0.005) >= total - 0.0005 ? null : Math.max(tt, p.trimStart + 0.005));
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onWheel = (e: React.WheelEvent) => {
    const span = p.view.end - p.view.start;
    if (!e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      // zoom around mouse
      const t = xToT(localX(e));
      const f = e.deltaY > 0 ? 1.25 : 0.8;
      const ns = Math.max(0.005, Math.min(total, span * f));
      const k = (t - p.view.start) / span;
      let start = t - k * ns;
      start = Math.max(0, Math.min(total - ns, start));
      p.onView({ start, end: start + ns });
    } else {
      const d = ((e.deltaX || e.deltaY) / sizeRef.current.w) * span;
      const start = Math.max(0, Math.min(total - span, p.view.start + d));
      p.onView({ start, end: start + span });
    }
  };
  const onCursorStyle = (e: React.PointerEvent) => {
    const x = localX(e);
    const near = Math.abs(tToX(p.trimStart) - x) < 6 || Math.abs(tToX(p.trimEnd ?? total) - x) < 6;
    baseRef.current!.parentElement!.style.cursor = near ? 'ew-resize' : 'crosshair';
  };

  // scrollbar thumb
  const thumbL = (p.view.start / total) * 100, thumbW = ((p.view.end - p.view.start) / total) * 100;
  const onThumb = (e: React.PointerEvent) => {
    const bar = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
    const x0 = e.clientX, v0 = p.view, span = v0.end - v0.start;
    const move = (ev: PointerEvent) => {
      const dt = ((ev.clientX - x0) / bar.width) * total;
      const start = Math.max(0, Math.min(total - span, v0.start + dt));
      p.onView({ start, end: start + span });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <div className="wave-wrap">
      <canvas ref={rulerRef} className="ruler" />
      <div ref={areaRef} style={{ position: 'relative' }} onPointerDown={onDown} onWheel={onWheel} onPointerMove={onCursorStyle}>
        <canvas ref={baseRef} className="wave-canvas" style={{ height: 300 }} />
        <canvas ref={overRef} className="wave-canvas" style={{ height: 300, position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      </div>
      <div className="wave-scroll">
        {thumbW < 99.9 && <div className="thumb" style={{ left: `${thumbL}%`, width: `${Math.max(2, thumbW)}%` }} onPointerDown={onThumb} />}
      </div>
    </div>
  );
}
