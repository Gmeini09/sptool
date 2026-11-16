// Library preview playback helpers.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getState, markRecent, toast } from '../app/store';
import type { LibraryEntry } from '../models/types';
import { getAudio } from '../library/assets';
import { gameAudio } from '../formats/awc';
import { engine } from './engine';

/** inGame: plays the sound exactly as the build writes it into the game file (mono, 1 : 1). */
export async function previewEntry(e: LibraryEntry, opts: { inGame?: boolean } = {}) {
  if (engine.playingKey === e.id) { engine.stop(); return; }
  engine.unlock(); // still inside the click – before the async render
  try {
    engine.setVolume(getState().settings.volume);
    const audio = await getAudio(e);
    engine.play(opts.inGame ? gameAudio(audio) : audio, { key: e.id });
    markRecent(e.id);
  } catch (err) {
    toast('error', `„${e.name}“ konnte nicht abgespielt werden`, err instanceof Error ? err.message : String(err));
  }
}

export function usePlayingKey(): string | null {
  return useSyncExternalStore((l) => engine.subscribe(l), () => engine.playingKey);
}

/** Animation-frame playhead progress (0..1) for the given key; null when not playing. */
export function useProgress(key: string | null, duration: number | undefined): number | null {
  const playing = usePlayingKey();
  const [p, setP] = useState<number | null>(null);
  useEffect(() => {
    if (!key || playing !== key || !duration) { setP(null); return; }
    let raf = 0;
    const tick = () => {
      const pos = engine.position();
      setP(pos == null ? null : pos / duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, playing, duration]);
  return p;
}
