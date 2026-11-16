// AWC (Audio Wave Container) – GTA V audio container.
// Format verified against a working reference soundpack (WEAPONS_PLAYER.rpf, 23 containers,
// 638 streams): see docs/REFERENCE_ANALYSIS.md. Round-trip parse → write is byte-identical
// for every container in the reference (tests/awc.test.ts).
//
// Supported: version 1, flags 0xFF01 (chunk-index table, single-channel streams, no
// encryption), codec 0 (PCM 16-bit LE mono). Anything else is rejected with a clear error
// instead of being written incorrectly.
import type { AudioData } from '../dsp/types';

export const AWC_MAGIC = 0x54414441; // "ADAT"
export const CHUNK = { data: 0x55, format: 0xfa, peak: 0x36, markers: 0xbd } as const;
const KNOWN_FLAGS = 0xff01;
const PEAK_BLOCK = 4096;

export interface AwcFormat {
  samples: number;
  loopPoint: number;
  sampleRate: number;
  /** playback attenuation in 1/100 dB applied by the game (audio itself is normalised) */
  headroom: number;
  loopBegin: number;
  loopEnd: number;
  playEnd: number;
  playBegin: number;
  codec: number;
  /** peak of the first 4096-sample block ×2 (0 = not set); blocks 1..n live in the peak chunk */
  peak0: number;
  /** bytes 22–23, zero in every reference stream; preserved as-is */
  reserved: number;
}

/** A muted stream the way creators mute: a few milliseconds of silence (frees the bytes for other sounds). */
export function silentStream(orig: AwcStream): AwcStream {
  const sr = orig.format.sampleRate;
  return { ...replaceStreamAudio(orig, { sampleRate: sr, channels: [new Float32Array(Math.max(16, Math.round(sr * 0.02)))] }, { normalize: false }), };
}

export interface AwcStream {
  /** 29-bit stream id (hash of the stream name) */
  id: number;
  format: AwcFormat;
  /** raw PCM16 little-endian bytes */
  data: Uint8Array;
  /** per-4096-sample-block peaks for blocks 1..n (as stored) */
  peak: Uint8Array | null;
  markers: Uint8Array | null;
  /** chunk order as stored in the stream info (types) */
  chunkOrder: number[];
}

export interface AwcFile { version: number; flags: number; streams: AwcStream[] }

export class AwcError extends Error {}

const align16 = (n: number) => (n + 15) & ~15;

export function parseAwc(bytes: Uint8Array): AwcFile {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 16 || v.getUint32(0, true) !== AWC_MAGIC) throw new AwcError('Kein AWC-Container (ADAT-Kennung fehlt).');
  const version = v.getUint16(4, true);
  const flags = v.getUint16(6, true);
  const count = v.getInt32(8, true);
  if (version !== 1) throw new AwcError(`Nicht unterstützte AWC-Version ${version}.`);
  if (flags !== KNOWN_FLAGS) throw new AwcError(`Nicht unterstützte AWC-Flags 0x${flags.toString(16)} (mehrkanalige oder verschlüsselte Container werden noch nicht unterstützt).`);
  if (count < 0 || count > 100000) throw new AwcError('Beschädigte AWC-Stream-Anzahl.');
  let p = 16 + 2 * count; // skip chunk-index table (derived, rebuilt on write)
  const infos: Array<{ id: number; chunks: number }> = [];
  for (let i = 0; i < count; i++, p += 4) {
    const raw = v.getUint32(p, true);
    infos.push({ id: raw & 0x1fffffff, chunks: raw >>> 29 });
  }
  const streams: AwcStream[] = [];
  for (const info of infos) {
    const chunks: Array<{ type: number; size: number; off: number }> = [];
    for (let c = 0; c < info.chunks; c++, p += 8) {
      const lo = v.getUint32(p, true), hi = v.getUint32(p + 4, true);
      // 64-bit: type = bits 56..63, size = bits 28..55, offset = bits 0..27
      const type = hi >>> 24;
      const size = ((hi & 0x00ffffff) << 4) | (lo >>> 28);
      const off = lo & 0x0fffffff;
      if (off + size > bytes.byteLength) throw new AwcError('AWC-Chunk zeigt außerhalb der Datei.');
      chunks.push({ type, size, off });
    }
    const get = (t: number) => chunks.find((c) => c.type === t);
    const fc = get(CHUNK.format), dc = get(CHUNK.data);
    if (!fc || !dc) throw new AwcError(`Dem Stream 0x${info.id.toString(16)} fehlt ein Format- oder Daten-Chunk.`);
    if (fc.size !== 24) throw new AwcError('Unerwartete Größe des AWC-Format-Chunks.');
    const f = fc.off;
    const format: AwcFormat = {
      samples: v.getUint32(f, true), loopPoint: v.getInt32(f + 4, true), sampleRate: v.getUint16(f + 8, true),
      headroom: v.getInt16(f + 10, true), loopBegin: v.getUint16(f + 12, true), loopEnd: v.getUint16(f + 14, true),
      playEnd: v.getUint16(f + 16, true), playBegin: v.getUint8(f + 18), codec: v.getUint8(f + 19),
      peak0: v.getUint16(f + 20, true), reserved: v.getUint16(f + 22, true),
    };
    for (const c of chunks) if (![CHUNK.data, CHUNK.format, CHUNK.peak, CHUNK.markers].includes(c.type as never)) throw new AwcError(`Unbekannter AWC-Chunk-Typ 0x${c.type.toString(16)}.`);
    const slice = (c?: { off: number; size: number }) => (c ? bytes.slice(c.off, c.off + c.size) : null);
    streams.push({ id: info.id, format, data: slice(dc)!, peak: slice(get(CHUNK.peak)), markers: slice(get(CHUNK.markers)), chunkOrder: chunks.map((c) => c.type) });
  }
  return { version, flags, streams };
}

/**
 * Serialises an AWC using the exact layout found in the reference:
 * header | chunk-index table | stream infos | chunk infos | format chunks | peak chunks |
 * marker chunks | data chunks (each 16-byte aligned, zero padding).
 */
export function writeAwc(awc: AwcFile): Uint8Array {
  const streams = [...awc.streams].sort((a, b) => a.id - b.id);
  const n = streams.length;
  const totalChunks = streams.reduce((s, x) => s + x.chunkOrder.length, 0);
  const headerSize = 16 + 2 * n + 4 * n + 8 * totalChunks;
  const offsets = streams.map(() => new Map<number, number>());
  let p = headerSize;
  streams.forEach((_s, i) => { offsets[i].set(CHUNK.format, p); p += 24; });
  streams.forEach((s, i) => { if (s.peak) { offsets[i].set(CHUNK.peak, p); p += s.peak.length; } });
  streams.forEach((s, i) => { if (s.markers) { offsets[i].set(CHUNK.markers, p); p += s.markers.length; } });
  streams.forEach((s, i) => { p = align16(p); offsets[i].set(CHUNK.data, p); p += s.data.length; });
  const total = p;
  if (total > 0x0fffffff) throw new AwcError('AWC würde das Container-Limit von 256 MB überschreiten.');
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, AWC_MAGIC, true);
  v.setUint16(4, awc.version, true);
  v.setUint16(6, awc.flags, true);
  v.setInt32(8, n, true);
  v.setUint32(12, headerSize, true);
  let q = 16, run = 0;
  for (const s of streams) { v.setUint16(q, run, true); q += 2; run += s.chunkOrder.length; }
  for (const s of streams) { v.setUint32(q, ((s.chunkOrder.length << 29) | (s.id & 0x1fffffff)) >>> 0, true); q += 4; }
  streams.forEach((s, i) => {
    for (const t of s.chunkOrder) {
      const off = offsets[i].get(t)!;
      const size = t === CHUNK.format ? 24 : t === CHUNK.data ? s.data.length : t === CHUNK.peak ? s.peak!.length : s.markers!.length;
      v.setUint32(q, ((off & 0x0fffffff) | ((size & 0xf) << 28)) >>> 0, true);
      v.setUint32(q + 4, (((size >>> 4) & 0x00ffffff) | (t << 24)) >>> 0, true);
      q += 8;
    }
  });
  streams.forEach((s, i) => {
    const f = offsets[i].get(CHUNK.format)!, fm = s.format;
    v.setUint32(f, fm.samples, true); v.setInt32(f + 4, fm.loopPoint, true); v.setUint16(f + 8, fm.sampleRate, true);
    v.setInt16(f + 10, fm.headroom, true); v.setUint16(f + 12, fm.loopBegin, true); v.setUint16(f + 14, fm.loopEnd, true);
    v.setUint16(f + 16, fm.playEnd, true); v.setUint8(f + 18, fm.playBegin); v.setUint8(f + 19, fm.codec);
    v.setUint16(f + 20, fm.peak0, true); v.setUint16(f + 22, fm.reserved, true);
    if (s.markers) out.set(s.markers, offsets[i].get(CHUNK.markers)!);
    if (s.peak) out.set(s.peak, offsets[i].get(CHUNK.peak)!);
    out.set(s.data, offsets[i].get(CHUNK.data)!);
  });
  return out;
}

// ── Audio conversion ────────────────────────────────────────────────────────

export function streamToAudio(s: AwcStream): AudioData {
  if (s.format.codec !== 0) throw new AwcError(`Codec ${s.format.codec} wird nicht unterstützt (nur PCM).`);
  const n = s.data.length >> 1;
  const v = new DataView(s.data.buffer, s.data.byteOffset, s.data.byteLength);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = v.getInt16(i * 2, true) / 32768;
  return { sampleRate: s.format.sampleRate, channels: [ch] };
}

/** Peak chunk: max |sample| ×2 (clamped to 65535) for each 4096-sample block after the first. */
export function computePeakChunk(pcm: Int16Array): Uint8Array | null {
  const blocks = Math.floor(pcm.length / PEAK_BLOCK);
  if (blocks <= 1) return null;
  const out = new Uint8Array((blocks - 1) * 2);
  const v = new DataView(out.buffer);
  for (let b = 1; b < blocks; b++) {
    let m = 0;
    const end = Math.min(pcm.length, (b + 1) * PEAK_BLOCK);
    for (let i = b * PEAK_BLOCK; i < end; i++) { const a = Math.abs(pcm[i]); if (a > m) m = a; }
    v.setUint16((b - 1) * 2, Math.min(65535, m * 2), true);
  }
  return out;
}

/**
 * Builds a replacement stream from new audio, keeping the original stream id and game-side
 * settings. Audio is mixed to mono and resampled to the original rate (or opts.sampleRate). normalize: false keeps
 * the level of the sound as it is (only a sound above full scale is brought down, never clipped).
 */
export function replaceStreamAudio(orig: AwcStream, audio: AudioData, opts: { keepHeadroom?: boolean; sampleRate?: number; normalize?: boolean } = {}): AwcStream {
  // a lower rate than the original is allowed (GTA plays every stream at its own rate – creator packs mix 20–48 kHz)
  const sr = Math.round(opts.sampleRate ?? orig.format.sampleRate);
  if (sr < 8000 || sr > 65535) throw new AwcError(`Ungültige Abtastrate ${sr} Hz.`);
  const mono = mixToMono(audio);
  const res = audio.sampleRate === sr ? mono : resampleLinearHQ(mono, audio.sampleRate, sr);
  if (res.length > 0xffffffff / 2) throw new AwcError('Audio ist zu lang.');
  let peak = 0;
  for (let i = 0; i < res.length; i++) { const a = Math.abs(res[i]); if (a > peak) peak = a; }
  const g = opts.normalize === false ? (peak > 1 ? 1 / peak : 1) : peak > 1e-9 ? 1 / peak : 1;
  const pcm = new Int16Array(res.length);
  for (let i = 0; i < res.length; i++) { const x = res[i] * g; pcm[i] = x >= 1 ? 32767 : x <= -1 ? -32768 : Math.round(x * 32767); }
  const data = new Uint8Array(pcm.buffer.slice(0));
  const peakChunk = computePeakChunk(pcm);
  let p0 = 0;
  for (let i = 0; i < Math.min(pcm.length, PEAK_BLOCK); i++) { const a = Math.abs(pcm[i]); if (a > p0) p0 = a; }
  const order = orig.chunkOrder.filter((t) => t !== CHUNK.peak && t !== CHUNK.markers);
  const chunkOrder = peakChunk ? [CHUNK.peak, ...order] : order;
  return {
    id: orig.id,
    format: { ...orig.format, sampleRate: sr, samples: pcm.length, loopPoint: -1, loopBegin: 0, loopEnd: 0, playEnd: 0, playBegin: 0, peak0: Math.min(65535, p0 * 2), reserved: 0, headroom: opts.keepHeadroom === false ? 0 : orig.format.headroom },
    data, peak: peakChunk, markers: null, chunkOrder,
  };
}

const mixToMono = (a: AudioData) => monoMix(a).mono;

/**
 * The sound as the build writes it into a stream (replaceStreamAudio with normalize: false): mono mix-down, own
 * rate, own length, own level – only a sound above full scale is brought down. Used so previews match the game.
 */
export function gameAudio(a: AudioData): AudioData {
  const mono = mixToMono(a);
  let peak = 0;
  for (let i = 0; i < mono.length; i++) { const x = Math.abs(mono[i]); if (x > peak) peak = x; }
  if (peak <= 1) return { sampleRate: a.sampleRate, channels: [mono] };
  const out = new Float32Array(mono.length);
  for (let i = 0; i < mono.length; i++) out[i] = mono[i] / peak;
  return { sampleRate: a.sampleRate, channels: [out] };
}

/**
 * Mono for the game (GTA plays these streams in mono): the average of the channels – unless they cancel each other
 * out (more than 6 dB lost, e.g. a phase-inverted channel), then the loudest channel alone.
 * lossDb: level the written mono loses against the stereo sound (≤ 0).
 */
export function monoMix(a: AudioData): { mono: Float32Array; lossDb: number } {
  if (a.channels.length === 1) return { mono: a.channels[0], lossDb: 0 };
  const ms = (c: Float32Array) => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i] * c[i]; return s / Math.max(1, c.length); };
  const n = a.channels[0].length, avg = new Float32Array(n);
  for (const ch of a.channels) for (let i = 0; i < n; i++) avg[i] += ch[i] / a.channels.length;
  const stereo = a.channels.reduce((s, c) => s + ms(c), 0) / a.channels.length;
  const loss = (x: Float32Array) => (stereo > 1e-12 ? Math.min(0, 10 * Math.log10(Math.max(1e-12, ms(x)) / stereo)) : 0);
  // the plain mix-down (like any audio editor) – SP Tool picks nothing by itself; lossDb tells the user what mono costs
  return { mono: avg, lossDb: loss(avg) };
}

/** Windowed-sinc resampler (16 taps) – good enough for one-shot SFX, no external deps. */
export function resampleLinearHQ(x: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const n = Math.max(1, Math.round(x.length / ratio));
  const out = new Float32Array(n);
  const taps = 16;
  const cutoff = Math.min(1, 1 / ratio) * 0.95;
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    const k0 = Math.floor(c);
    let s = 0, w = 0;
    for (let k = k0 - taps + 1; k <= k0 + taps; k++) {
      if (k < 0 || k >= x.length) continue;
      const t = c - k;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t * cutoff) / (Math.PI * t * cutoff);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * t) / taps);
      const h = sinc * win;
      s += x[k] * h; w += h;
    }
    out[i] = w ? s / w : 0;
  }
  return out;
}

/**
 * Same-size replacement: the new audio is resampled to the original rate and fitted to the
 * original sample count (longer audio is shortened with a short fade-out, shorter audio is
 * padded with silence). Loop points, markers and headroom are kept, peaks are recomputed.
 * The resulting container has exactly the original byte length.
 */
export function fitStreamAudio(orig: AwcStream, audio: AudioData, opts: { normalize?: boolean } = {}): { stream: AwcStream; truncated: boolean; padded: boolean } {
  if (orig.format.codec !== 0) throw new AwcError(`Codec ${orig.format.codec} wird nicht unterstützt (nur PCM).`);
  const sr = orig.format.sampleRate;
  const n = orig.format.samples;
  const mono = mixToMono(audio);
  const res = audio.sampleRate === sr ? mono : resampleLinearHQ(mono, audio.sampleRate, sr);
  const truncated = res.length > n;
  const padded = res.length < n;
  const fitted = new Float32Array(n);
  fitted.set(res.subarray(0, n));
  if (truncated) {
    const fade = Math.min(n, Math.max(32, Math.round(sr * 0.012)));
    for (let i = 0; i < fade; i++) fitted[n - 1 - i] *= i / fade;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(fitted[i]); if (a > peak) peak = a; }
  // own sounds are brought to full level; sounds copied over from another pack keep their level
  const g = opts.normalize === false ? (peak > 1 ? 1 / peak : 1) : peak > 1e-9 ? 1 / peak : 1;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const x = fitted[i] * g; pcm[i] = x >= 1 ? 32767 : x <= -1 ? -32768 : Math.round(x * 32767); }
  let p0 = 0;
  for (let i = 0; i < Math.min(n, PEAK_BLOCK); i++) { const a = Math.abs(pcm[i]); if (a > p0) p0 = a; }
  let peakChunk: Uint8Array | null = null;
  if (orig.peak) {
    const computed = computePeakChunk(pcm);
    peakChunk = new Uint8Array(orig.peak.length); // keep the exact original chunk size
    if (computed) peakChunk.set(computed.subarray(0, peakChunk.length));
  }
  return {
    stream: {
      ...orig,
      format: { ...orig.format, peak0: orig.format.peak0 === 0 ? 0 : Math.min(65535, p0 * 2) },
      data: new Uint8Array(pcm.buffer.slice(0)),
      peak: peakChunk,
    },
    truncated,
    padded,
  };
}
