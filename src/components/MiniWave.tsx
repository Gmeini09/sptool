import { useEffect, useRef } from 'react';

/** Symmetric bar waveform from normalised peaks (0..1). Re-reads accent colour from CSS. */
export function MiniWave({ peaks, height, progress, className }: { peaks: number[] | Float32Array | undefined; height?: number; progress?: number | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 200;
    const h = c.clientHeight || height || 44;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(c);
    const accent = cs.getPropertyValue('--accent-2').trim() || '#7289ff';
    const dim = cs.getPropertyValue('--text-3').trim() || '#636b78';
    const n = peaks.length;
    const bar = Math.max(1.5, w / n - 1);
    const step = w / n;
    const mid = h / 2;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, Math.abs(peaks[i]) ** 0.75);
      const bh = Math.max(1, v * (h - 2));
      const x = i * step;
      g.fillStyle = progress != null && x / w > progress ? dim : accent;
      g.globalAlpha = progress != null && x / w > progress ? 0.55 : 0.92;
      g.fillRect(x, mid - bh / 2, bar, bh);
    }
  }, [peaks, height, progress]);
  return <canvas ref={ref} className={className ?? 'mini-wave'} style={height ? { height } : undefined} aria-hidden="true" />;
}

/** Decorative waveform for hero areas – drawn from a deterministic shape, not audio. */
export function DecorWave({ className, bars = 90, seed = 3 }: { className?: string; bars?: number; seed?: number }) {
  const peaks = Array.from({ length: bars }, (_, i) => {
    const t = i / bars;
    const env = Math.exp(-t * 4.2) * 0.95 + 0.05;
    const wob = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + seed) * Math.cos(i * 0.37 + seed));
    return env * wob;
  });
  return <MiniWave peaks={peaks} className={className} />;
}
