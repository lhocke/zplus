/**
 * V1/V2 — oracle corpus provenance headers (spec §10.1 / §8, L41).
 *
 * Every dfrotz-anchored corpus file must carry a `# generated-by: dfrotz-r119`
 * header on line 2 (0-indexed line[1]).  This locks the anchor: corpus files
 * without that header could silently be engine-referential, which the V2 audit
 * cannot detect.
 *
 * V1 covered the 12 Phase-3 cluster corpus files.
 * V2 extends coverage to the dam/river wave corpora (c-*.txt + supporting files)
 * and the BD7 chimney-ascent, BD1 lamp-burnout, CA3 match-timer, and other
 * dfrotz-anchored corpora that were backfilled with the generated-by header.
 *
 * Spec §8 provenance contract: "every corpus + golden file carries a first-line
 * header naming its generator — `# generated-by: dfrotz-r119 <date> <cmd>` —
 * and every consuming test ASSERTS the expected header before comparing a byte."
 *
 * NOT covered here: candle-lifecycle.txt and parser-integration.txt, which are
 * engine-anchored integration corpora (not dfrotz-provenance).  Also not covered:
 * v2-*.txt golden files in tests/golden/, which are engine-provenance (UPDATE_GOLDEN).
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
  // ── V1: Phase-3 cluster corpora ────────────────────────────────────────────
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
  // ── V2: dam/river wave corpora ───────────────────────────────────────────────
  'c-dam.txt',               // dam bolt cycle
  'c-leak.txt',              // blue-button leak / DROWNINGS
  'c-puncture.txt',          // boat puncture
  'c-rainbow.txt',           // rainbow crossing
  'c-river.txt',             // inflate boat + river drift
  'c-sand.txt',              // dig scarab at Sandy Beach
  // ── V2: other dfrotz-anchored corpora backfilled ──────────────────────────
  'chimney-ascent.txt',      // BD7 / chimney ascent (UP from Studio)
  'lamp-burnout.txt',        // BD1 / lamp fuel schedule
  'match-timer.txt',         // CA3 / match re-arm timer
  'opening-walkthrough.txt', // opening-sequence gate
  'thief-movement.txt',      // thief movement patterns
  'sword-glow.txt',          // I-SWORD glow divergence (BD2 context)
  // ── Already asserted by their own cluster tests ───────────────────────────
  // chimney-arrival.txt  (BD7 — asserted in bd7-chimney-arrival.test.ts)
  // lamp-off-dark.txt    (BD1 — asserted in bd1-lamp-off-dark.test.ts)
  // inventory-format.txt (BD3 — asserted in its own suite)
  // cb1-climb-rooms.txt  (CB1 — asserted in its own suite)
] as const;

describe('V1/V2 — §10.1/§8 corpus files carry dfrotz-r119 provenance header (L41)', () => {
  for (const file of FILES) {
    it(`${file} line 2 is "# generated-by: dfrotz-r119 ..."`, () => {
      expect(header(file)).toMatch(/^# generated-by: dfrotz-r119 /);
    });
  }
});

// ---------------------------------------------------------------------------
// V2: golden + dfrotz-transcript provenance headers
// ---------------------------------------------------------------------------

const GOLDEN_DIR = join(import.meta.dirname, '../golden');

describe('V2 — dfrotz-provenance golden + transcript headers (L41)', () => {
  it('walkthrough-master.txt line 1 is "# generated-by: dfrotz-r119 ..."', () => {
    const raw = readFileSync(join(GOLDEN_DIR, 'walkthrough-master.txt'), 'utf8');
    const firstLine = raw.split('\n')[0]!;
    expect(firstLine).toMatch(/^# generated-by: dfrotz-r119 /);
  });

  it('walkthrough-dfrotz.transcript.txt line 1 is "# generated-by: dfrotz-r119 ..."', () => {
    const raw = readFileSync(join(GOLDEN_DIR, 'walkthrough-dfrotz.transcript.txt'), 'utf8');
    const firstLine = raw.split('\n')[0]!;
    expect(firstLine).toMatch(/^# generated-by: dfrotz-r119 /);
  });

  it('walkthrough-dfrotz.transcript.txt contains Release 119 / Serial number 880429 banner', () => {
    const raw = readFileSync(join(GOLDEN_DIR, 'walkthrough-dfrotz.transcript.txt'), 'utf8');
    expect(raw).toContain('Release 119 / Serial number 880429');
  });
});
