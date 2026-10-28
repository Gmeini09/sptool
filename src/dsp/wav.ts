// RIFF/WAVE encode + decode (PCM 8/16/24/32, IEEE float 32/64, WAVE_FORMAT_EXTENSIBLE).
import type { AudioData } from './types';

export type WavBitDepth = 16 | 24 | 32;

export function encodeWav(a: AudioData, bitDepth: WavBitDepth = 16, float = false): Uint8Array {
  const numCh = a.channels.length;
  const n = a.channels[0]?.length ?? 0;
  const bps = bitDepth / 8;
  const dataSize = n * numCh * bps;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  const isFloat = float && bitDepth === 32;
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, isFloat ? 3 : 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, a.sampleRate, true);
  v.setUint32(28, a.sampleRate * numCh * bps, true);
  v.setUint16(32, numCh * bps, true);
  v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = a.channels[c][i];
      if (!Number.isFinite(s)) s = 0;
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      if (isFloat) { v.setFloat32(o, s, true); }
      else if (bitDepth === 16) { v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true); }
      else if (bitDepth === 24) {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff);
      } else { v.setInt32(o, Math.round(s < 0 ? s * 0x80000000 : s * 0x7fffffff), true); }
      o += bps;
    }
  }
  return new Uint8Array(buf);
}

export class WavError extends Error {}

export function decodeWav(bytes: Uint8Array): AudioData {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new WavError('Not a RIFF/WAVE file.');
  let o = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let dataOff = -1, dataLen = 0;
  while (o + 8 <= bytes.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // extensible → sub-format GUID first 2 bytes
      fmt = {
        format,
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        blockAlign: v.getUint16(body + 12, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, bytes.byteLength - body);
      break;
    }
    o = body + size + (size & 1);
  }
  if (!fmt) throw new WavError('WAV file has no fmt chunk.');
  if (dataOff < 0) throw new WavError('WAV file has no data chunk.');
  if (fmt.format !== 1 && fmt.format !== 3) throw new WavError(`Unsupported WAV encoding (format tag ${fmt.format}). Use PCM or float WAV.`);
  if (fmt.channels < 1 || fmt.channels > 8) throw new WavError('Unsupported channel count.');
  const bps = fmt.bits / 8;
  const frames = Math.floor(dataLen / fmt.blockAlign);
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOff + i * fmt.blockAlign + c * bps;
      let s: number;
      if (fmt.format === 3) s = fmt.bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
      else if (fmt.bits === 8) s = (v.getUint8(p) - 128) / 128;
      else if (fmt.bits === 16) s = v.getInt16(p, true) / 0x8000;
      else if (fmt.bits === 24) { let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (x & 0x800000) x |= ~0xffffff; s = x / 0x800000; }
      else if (fmt.bits === 32) s = v.getInt32(p, true) / 0x80000000;
      else throw new WavError(`Unsupported bit depth ${fmt.bits}.`);
      channels[c][i] = s;
    }
  }
  return { sampleRate: fmt.sampleRate, channels };
}
