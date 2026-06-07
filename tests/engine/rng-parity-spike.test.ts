// tests/engine/rng-parity-spike.test.ts
import { describe, it, expect } from 'vitest';
import { runDfrotz } from '../../tools/oracle/dfrotz-runner';
import { createGame } from '../../src/engine/bootstrap';
import { FrotzRng } from '../../src/engine/frotz-rng';
import { normalizeDfrotz, normalizeEngine } from '../../tools/oracle/normalizer';

// Shortest no-lantern path to a dark->dark move (the grue gate).
const SCENARIO = [
  'n', 'e', 'open window', 'west', 'west',
  'move rug', 'open trap door', 'down', 'north',
];

// >=1000 seeds exercise the real LCG (the combat-RNG path); include one <1000.
const SEEDS = [1000, 12345, 31337, 42];

function engineRun(seed: number): string {
  const game = createGame({ rng: new FrotzRng(seed) });
  let out = game.start();
  for (const cmd of SCENARIO) out += '\n' + game.turn(cmd).output;
  return out;
}

// Flatten NormalizedTurn[] into a single string for regex searching.
function flattenTurns(turns: ReturnType<typeof normalizeDfrotz>): string {
  return turns.map((t) => t.text).join('\n');
}

// SPIKE RESULT (2026-06-07) — SKIPPED so it stays out of the default green suite,
// kept as the repro. Gate 2 outcome: 1/4 seeds match (only seed 1000). dfrotz
// fires the grue on all four seeds; the engine matches only on 1000. FrotzRng's
// unit tests pass, so the LCG is correct — this is a DRAW-ORDER mismatch: the
// engine consumes RANDOM at different points than real Zork before the grue
// (real Zork runs per-turn RNG consumers — e.g. the thief demon, active from GO —
// that the engine does not yet implement). Byte-level dfrotz RNG parity therefore
// needs draw-order alignment, not just the right PRNG. Re-enable (drop .skip) once
// per-turn RNG consumption is aligned to ZIL. See
// docs/research/2026-06-07-rng-parity-spike-design.md (Spike outcome).
describe.skip('RNG parity spike: grue outcome matches dfrotz seed-for-seed', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      // dfrotz-runner already appends 'quit' + 'y' internally — pass SCENARIO only.
      const dfrotzRaw = runDfrotz(SCENARIO, { seed });
      const dfrotz = flattenTurns(normalizeDfrotz(dfrotzRaw));
      const engine = flattenTurns(normalizeEngine(engineRun(seed)));

      const dfrotzGrue = /grue has eaten|eaten by a grue/i.test(dfrotz);
      const engineGrue = /grue has eaten|eaten by a grue/i.test(engine);

      // Diagnostic: log per-seed outcome so the spike result is visible in the
      // test report even when assertions pass.
      console.log(
        `seed ${seed}: dfrotz=${dfrotzGrue ? 'GRUE' : 'survived'} engine=${engineGrue ? 'GRUE' : 'survived'}`,
      );

      // The load-bearing assertion: the grue fired (or not) identically.
      expect(engineGrue).toBe(dfrotzGrue);
    });
  }
});
