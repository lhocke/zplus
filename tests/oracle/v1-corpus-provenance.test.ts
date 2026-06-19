/**
 * V1 — per-cluster oracle corpus provenance headers (spec §10.1, L41).
 *
 * Every §10.1 corpus file must carry a `# generated-by: dfrotz-r119` header
 * on line 2 (0-indexed line[1]).  This locks the anchor: corpus files without
 * that header could silently be engine-referential, which the V2 audit cannot
 * detect.  This suite covers the 12 corpus files whose cluster tests do not
 * already assert the header (BD1/BD3/BD7 each have their own).
 *
 * Spec §8 provenance contract: "every corpus + golden file carries a first-line
 * header naming its generator — `# generated-by: dfrotz-r119 <date> <cmd>` —
 * and every consuming test ASSERTS the expected header before comparing a byte."
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORPUS = join(import.meta.dirname, '../../tools/oracle/corpus');

function header(file: string): string {
  const lines = readFileSync(join(CORPUS, file), 'utf8').split('\n');
  return lines[1] ?? '';
}

const FILES = [
  'clock-blocked-move.txt',  // CA1
  'wait.txt',                // CA2
  'verb-defaults.txt',       // CB1+CB2
  'hades-exorcism.txt',      // CC1
  'dome-rope.txt',           // CC2
  'coal-machine.txt',        // CC3
  'bat-garlic.txt',          // CC4
  'mirror.txt',              // CC6
  'bottle-water.txt',        // CC7
  'boom-room.txt',           // CC10
  'cave2-candle.txt',        // CC10
  'south-temple-coffin.txt', // CC10
] as const;

describe('V1 — §10.1 corpus files carry dfrotz-r119 provenance header (L41)', () => {
  for (const file of FILES) {
    it(`${file} line 2 is "# generated-by: dfrotz-r119 ..."`, () => {
      expect(header(file)).toMatch(/^# generated-by: dfrotz-r119 /);
    });
  }
});
