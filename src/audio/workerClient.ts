// Promise-based client for audio.worker.js
import type { AudioAnalysis } from '../dsp/analysis';
import type { EditState } from '../dsp/chain';
import type { AudioData } from '../dsp/types';
import type { WavBitDepth } from '../dsp/wav';
import type { SynthParams } from '../synth/synth';

export interface Rendered { audio: AudioData; analysis: AudioAnalysis; peaks: Float32Array }

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker('audio.worker.js', { type: 'module' });
  worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error));
  };
  worker.onerror = (ev) => {
    const err = new Error(`Die Audio-Verarbeitung ist abgestürzt: ${ev.message}`);
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker?.terminate();
    worker = null; // restarted on next request
  };
  return worker;
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id });
  });
}

export const audioWorker = {
  synth: (params: SynthParams) => call<Rendered>({ op: 'synth', params }),
  render: (source: AudioData, edit: EditState) => call<Rendered>({ op: 'render', source, edit }),
  decode: (bytes: Uint8Array) => call<Rendered>({ op: 'decode', bytes }),
  /** analysis + card peaks for audio decoded elsewhere (bundled Turbo sounds) */
  package: (audio: AudioData) => call<Rendered>({ op: 'package', audio }),
  encode: (audio: AudioData, bits: WavBitDepth = 16) => call<Uint8Array>({ op: 'encode', audio, bits }),
};
