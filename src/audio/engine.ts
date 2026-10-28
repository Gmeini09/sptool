// AudioService playback engine (Web Audio). One preview voice at a time,
// position tracking for playheads and an analyser for peak meters.
import type { AudioData } from '../dsp/types';
import { logger } from '../services/logger';

export interface PlayOptions {
  /** id shown as "playing" in the UI */
  key: string;
  offset?: number;
  loop?: { start: number; end: number } | null;
  onEnded?: () => void;
}

type Listener = () => void;

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private duration = 0;
  private loop: { start: number; end: number } | null = null;
  private volume = 0.85;
  private listeners = new Set<Listener>();
  playingKey: string | null = null;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.ctx.onstatechange = () => this.emit();
      logger.audio(`Audio engine started (${this.ctx.sampleRate} Hz)`);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /**
   * Browsers only allow audio that was started inside a user gesture. Call this synchronously
   * in click/key handlers (before any await) so the context is running when the sound is ready.
   */
  unlock() {
    const ctx = this.ensure();
    if (ctx.state !== 'running') {
      // A silent one-sample buffer "primes" the output on Safari/WebView too.
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
      void ctx.resume();
    }
  }

  get state(): 'idle' | 'running' | 'suspended' {
    if (!this.ctx) return 'idle';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  play(audio: AudioData, opts: PlayOptions) {
    const ctx = this.ensure();
    this.stop(false);
    const n = audio.channels[0]?.length ?? 0;
    if (!n) return;
    const buf = ctx.createBuffer(audio.channels.length, n, audio.sampleRate);
    audio.channels.forEach((c, i) => buf.getChannelData(i).set(c));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master!);
    this.duration = buf.duration;
    this.loop = opts.loop && opts.loop.end > opts.loop.start ? opts.loop : null;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    const offset = Math.max(0, Math.min(opts.offset ?? this.loop?.start ?? 0, buf.duration - 0.001));
    src.onended = () => {
      if (this.src !== src) return;
      this.src = null;
      this.playingKey = null;
      opts.onEnded?.();
      this.emit();
    };
    if (ctx.state !== 'running') void ctx.resume();
    src.start(0, offset);
    this.src = src;
    this.startedAt = ctx.currentTime;
    this.offset = offset;
    this.playingKey = opts.key;
    this.emit();
  }

  stop(emit = true) {
    if (this.src) {
      const s = this.src;
      this.src = null;
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.playingKey = null;
    if (emit) this.emit();
  }

  /** Current position in seconds within the playing buffer, or null. */
  position(): number | null {
    if (!this.src || !this.ctx) return null;
    let p = this.offset + (this.ctx.currentTime - this.startedAt);
    if (this.loop) {
      const len = this.loop.end - this.loop.start;
      if (p > this.loop.end) p = this.loop.start + ((p - this.loop.start) % len);
    }
    return Math.min(p, this.duration);
  }

  /** Current output peak (0..1) for meters. */
  peak(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let p = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
    return p;
  }

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit() { this.listeners.forEach((l) => l()); }
}

export const engine = new Engine();
