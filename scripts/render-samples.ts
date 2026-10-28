// Renders before/after WAVs of the built-in fire sounds for listening tests.
//   npx tsx scripts/render-samples.ts <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtinCatalog } from '../src/library/catalog';
import { synthesize } from '../src/synth/synth';
import { encodeWav } from '../src/dsp/wav';

const out = process.argv[2] || 'samples';
mkdirSync(join(out, 'neu'), { recursive: true });
mkdirSync(join(out, 'alt'), { recursive: true });
const cat = builtinCatalog();
const pick = ['clean', 'cracky', 'punchy', 'heavy', 'realistic', 'echo', 'competitive', 'deep'];
for (const w of ['pistol', 'pistol_mk2', 'pistol50']) {
  for (const st of pick) {
    const e = cat.find((x) => x.id === `bi-fire-${w}-${st}-1`);
    if (!e?.synth) continue;
    writeFileSync(join(out, 'neu', `${w}_${st}.wav`), encodeWav(synthesize(e.synth), 16));
    writeFileSync(join(out, 'alt', `${w}_${st}.wav`), encodeWav(synthesize({ ...e.synth, engine: 1 }), 16));
  }
}
for (const st of ['clean', 'realistic']) {
  const e = cat.find((x) => x.id === `bi-supp-pistol_mk2-${st}-1`)!;
  writeFileSync(join(out, 'neu', `suppressor_${st}.wav`), encodeWav(synthesize(e.synth!), 16));
  writeFileSync(join(out, 'alt', `suppressor_${st}.wav`), encodeWav(synthesize({ ...e.synth!, engine: 1 }), 16));
}
console.log('done', out);
