// "Klingt im Spiel anders?": a short text report of what a build wrote for every sound – template, length and rate
// before / in the game, cut, mono – so a user can paste it to the SP Tool team (Discord) and the cause is clear at once.
import type { AudioData } from '../dsp/types';
import type { Pack } from '../formats/pack';
import { inGameAudio, SILENCE, type BuildPlan, type LayoutOptions } from './build';
import type { SlotAssignment } from './project';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const sec = (x: number) => `${x.toFixed(2).replace('.', ',')} s`;
const khz = (x: number) => `${(x / 1000).toFixed(1).replace('.', ',')} kHz`;

export async function soundReport(
  plan: BuildPlan, pack: Pack, render: (a: SlotAssignment) => Promise<AudioData>,
  meta: { name: string; template: string; soundName: (id: string) => string; layout?: LayoutOptions },
): Promise<string> {
  const lines = [
    `SP Tool ${APP_VERSION} · Soundpack „${meta.name}“ · ${new Date().toLocaleString('de-AT')}`,
    `Vorlage: ${meta.template}${meta.layout?.matchLevel ? ' · Lautstärke wie das Original' : ''}`,
    '',
  ];
  for (const it of plan.items) {
    if (it.assignment.entryId === SILENCE) continue;
    const head = `${it.weaponLabel} · ${it.slotLabel}: ${meta.soundName(it.assignment.entryId)}`;
    if (it.status !== 'ready') { lines.push(`${head} – nicht ins Spiel geschrieben (${it.status === 'unmapped' ? 'Platz im Spiel unbekannt' : 'fehlt in der Vorlage'})`); continue; }
    const src = await render(it.assignment);
    const g = await inGameAudio(plan, pack, it, async () => src, meta.layout);
    if (!g) continue;
    const notes = [g.truncated && 'GEKÜRZT', g.lowered && 'Rate gesenkt', g.monoLossDb < -6 && `Mono ${g.monoLossDb.toFixed(0)} dB`].filter(Boolean);
    lines.push(`${head}`);
    lines.push(`  Datei ${sec(g.sourceSeconds)} · ${khz(src.sampleRate)} · ${src.channels.length === 1 ? 'mono' : 'stereo'}  →  Spiel ${sec(g.gameSeconds)} · ${khz(g.audio.sampleRate)} · mono${notes.length ? `  [${notes.join(', ')}]` : ''}`);
  }
  return lines.join('\n');
}
