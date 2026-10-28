// "Falsch erkannt": when a user corrects SP Tool's shot/reload decision, the measured sound features (numbers only –
// never the audio) and the right answer go to the licence server. Admins download them to improve the detection.
// Corrections wait in this browser until the user is signed in and online.
import { api, getAccount } from '../account/account';
import { classifierInputs, classifySound, type SoundKind } from '../dsp/classify';
import type { AudioData } from '../dsp/types';
import { logger } from './logger';

declare const __APP_VERSION__: string;
const KEY = 'sptool:detection-feedback';
const MAX_QUEUE = 200;

export interface FeedbackItem { label: SoundKind; predicted: SoundKind; score: number; inputs: Record<string, number>; app: string; source: string }

function read(): FeedbackItem[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } }
function write(q: FeedbackItem[]) { try { localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* storage full/blocked */ } }

/** Records a correction. `source`: where it happened (import, pack, reload). */
export function reportDetection(audio: AudioData, label: SoundKind, source: string) {
  const inputs = classifierInputs(audio);
  const c = classifySound(audio);
  const item: FeedbackItem = { label, predicted: c.kind, score: c.score, inputs, app: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '', source };
  write([...read(), item]);
  logger.info(`Erkennung korrigiert (${source}): ${c.kind} → ${label}`);
  void flushDetectionFeedback();
}

let sending = false;
/** Sends waiting corrections (signed in only). */
export async function flushDetectionFeedback(): Promise<number> {
  if (sending) return 0;
  const q = read();
  if (!q.length || getAccount().phase !== 'ready') return 0;
  sending = true;
  try {
    let sent = 0;
    for (let i = 0; i < q.length; i += 50) {
      await api('POST', '/sptool-app/feedback', { version: 1, items: q.slice(i, i + 50) }, { keepSession: true });
      sent = i + Math.min(50, q.length - i);
    }
    write(read().slice(q.length)); // keep what was added while sending
    return sent;
  } catch { return 0; } finally { sending = false; }
}

/** Admin: all corrections collected on the server, as a JSON file for the detection training. */
export async function downloadDetectionFeedback(): Promise<{ count: number; blob: Blob }> {
  const r = await api<{ items: unknown[] }>('GET', '/sptool-app/feedback', undefined, { keepSession: true });
  return { count: r.items.length, blob: new Blob([JSON.stringify(r, null, 1)], { type: 'application/json' }) };
}
