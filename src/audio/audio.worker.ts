/// <reference lib="webworker" />
// Audio worker: all heavy DSP (synthesis, edit rendering, WAV I/O, analysis)
// runs here so the UI thread never freezes (spec §122).
import { analyze, computePeaks } from '../dsp/analysis';
import { renderEdit, type EditState } from '../dsp/chain';
import type { AudioData } from '../dsp/types';
import { decodeWav, encodeWav, type WavBitDepth } from '../dsp/wav';
import { synthesize, type SynthParams } from '../synth/synth';

export type WorkerRequest =
  | { id: number; op: 'synth'; params: SynthParams }
  | { id: number; op: 'render'; source: AudioData; edit: EditState }
  | { id: number; op: 'decode'; bytes: Uint8Array }
  | { id: number; op: 'package'; audio: AudioData }
  | { id: number; op: 'encode'; audio: AudioData; bits: WavBitDepth };

export const CARD_PEAKS = 96;

function package_(audio: AudioData) {
  const analysis = analyze(audio);
  const peaks = computePeaks(audio, CARD_PEAKS);
  return { audio, analysis, peaks };
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    let result: unknown;
    const transfer: Transferable[] = [];
    switch (req.op) {
      case 'synth': {
        const r = package_(synthesize(req.params));
        r.audio.channels.forEach((c) => transfer.push(c.buffer));
        result = r;
        break;
      }
      case 'render': {
        const r = package_(renderEdit(req.source, req.edit));
        r.audio.channels.forEach((c) => transfer.push(c.buffer));
        result = r;
        break;
      }
      case 'package': {
        const r = package_(req.audio);
        r.audio.channels.forEach((c) => transfer.push(c.buffer));
        result = r;
        break;
      }
      case 'decode': {
        const r = package_(decodeWav(req.bytes));
        r.audio.channels.forEach((c) => transfer.push(c.buffer));
        result = r;
        break;
      }
      case 'encode': {
        const bytes = encodeWav(req.audio, req.bits, req.bits === 32);
        transfer.push(bytes.buffer);
        result = bytes;
        break;
      }
    }
    ctx.postMessage({ id: req.id, ok: true, result }, transfer);
  } catch (e) {
    ctx.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
