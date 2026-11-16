// Foundry Breach — hand-in program (Node 22, standard library only).
//
// The game itself is the static site under game/ (ES modules, no build step).
// This program is what make.fun runs: it copies game/ and screenshots/ into
// the output directory and writes dossier.json there with the vendored
// buildDossier helper, exactly as the competition's hand-in contract asks.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });

// The playable game, byte for byte as it sits in the repository.
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });

// The screenshots the maker took of this build (first by name is the cover).
const shotsDir = join(root, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

// The dossier the judge reads: screenshots first, then the game's source.
// The caps mirror the scorer's own gate, so an entry the scorer would refuse
// for size is refused here first instead.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
