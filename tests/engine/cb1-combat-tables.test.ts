/**
 * CB1 — Raw DEF tables + resolution windows (spec §3.2/§3.3 + §12 CB1).
 *
 * Build-time mandate (OQ-5): re-derive window offsets directly from
 * 1dungeon.zil:2644–2649 and 1actions.zil:3301–3317.  The ZIL REST(table, N)
 * byte offsets convert to element indices as N/2 (2 bytes per word).
 *
 * ZIL-true offsets (element indices, not byte offsets):
 *   DEF1-RES:  DEF1@0, DEF1@1, DEF1@2          (ATT=1/2/3)
 *   DEF2-RES:  DEF2A@0, DEF2B@0, DEF2B@1, DEF2B@2  (ATT=1/2/3/4)
 *   DEF3-RES:  DEF3A@0, DEF3A@1, DEF3B@0, DEF3B@1, DEF3C@0  (net=-2/-1/0/+1/+2)
 *
 * Near-miss guard (NM-1): each window has exactly 9 accessible elements.
 */

import { describe, it, expect } from 'vitest';
import {
  DEF1, DEF2A, DEF2B, DEF3A, DEF3B, DEF3C,
  DEF1_RES, DEF2_RES, DEF3_RES,
  MISSED, UNCONSCIOUS, KILLED, LIGHT_WOUND, SERIOUS_WOUND, STAGGER,
} from '../../src/engine/combat.js';

// ---------------------------------------------------------------------------
// Helper: count distribution in a 9-element window
// ---------------------------------------------------------------------------
function dist(win: { table: readonly number[]; offset: number }): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let i = 0; i < 9; i++) {
    const v = win.table[win.offset + i]!;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 1. Raw table element-by-element verification vs 1actions.zil:3258–3299
// ---------------------------------------------------------------------------

describe('DEF1 (1actions.zil:3258–3263) — 13 elements', () => {
  it('length is 13', () => {
    expect(DEF1.length).toBe(13);
  });

  it('elements match ZIL: 4×MISSED 2×STAGGER 2×UNCONSCIOUS 5×KILLED', () => {
    expect(DEF1).toEqual([
      MISSED, MISSED, MISSED, MISSED,
      STAGGER, STAGGER,
      UNCONSCIOUS, UNCONSCIOUS,
      KILLED, KILLED, KILLED, KILLED, KILLED,
    ]);
  });
});

describe('DEF2A (1actions.zil:3265–3270) — 10 elements', () => {
  it('length is 10', () => {
    expect(DEF2A.length).toBe(10);
  });

  it('elements match ZIL: 5×MISSED 2×STAGGER 2×LIGHT_WOUND 1×UNCONSCIOUS', () => {
    expect(DEF2A).toEqual([
      MISSED, MISSED, MISSED, MISSED, MISSED,
      STAGGER, STAGGER,
      LIGHT_WOUND, LIGHT_WOUND,
      UNCONSCIOUS,
    ]);
  });
});

describe('DEF2B (1actions.zil:3272–3278) — 12 elements', () => {
  it('length is 12', () => {
    expect(DEF2B.length).toBe(12);
  });

  it('elements match ZIL: 3×MISSED 2×STAGGER 3×LIGHT_WOUND 1×UNCONSCIOUS 3×KILLED', () => {
    expect(DEF2B).toEqual([
      MISSED, MISSED, MISSED,
      STAGGER, STAGGER,
      LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND,
      UNCONSCIOUS,
      KILLED, KILLED, KILLED,
    ]);
  });
});

describe('DEF3A (1actions.zil:3280–3285) — 11 elements', () => {
  it('length is 11', () => {
    expect(DEF3A.length).toBe(11);
  });

  it('elements match ZIL: 5×MISSED 2×STAGGER 2×LIGHT_WOUND 2×SERIOUS_WOUND', () => {
    expect(DEF3A).toEqual([
      MISSED, MISSED, MISSED, MISSED, MISSED,
      STAGGER, STAGGER,
      LIGHT_WOUND, LIGHT_WOUND,
      SERIOUS_WOUND, SERIOUS_WOUND,
    ]);
  });
});

describe('DEF3B (1actions.zil:3287–3292) — 11 elements', () => {
  it('length is 11', () => {
    expect(DEF3B.length).toBe(11);
  });

  it('elements match ZIL: 3×MISSED 2×STAGGER 3×LIGHT_WOUND 3×SERIOUS_WOUND', () => {
    expect(DEF3B).toEqual([
      MISSED, MISSED, MISSED,
      STAGGER, STAGGER,
      LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND,
      SERIOUS_WOUND, SERIOUS_WOUND, SERIOUS_WOUND,
    ]);
  });
});

describe('DEF3C (1actions.zil:3294–3299) — 10 elements', () => {
  it('length is 10', () => {
    expect(DEF3C.length).toBe(10);
  });

  it('elements match ZIL: 1×MISSED 2×STAGGER 4×LIGHT_WOUND 3×SERIOUS_WOUND', () => {
    expect(DEF3C).toEqual([
      MISSED,
      STAGGER, STAGGER,
      LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND, LIGHT_WOUND,
      SERIOUS_WOUND, SERIOUS_WOUND, SERIOUS_WOUND,
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Resolution windows — NM-1: each window is exactly 9 accessible elements.
//    ZIL-true offsets derived from 1dungeon.zil:2644–2649 (REST byte offsets ÷ 2).
// ---------------------------------------------------------------------------

describe('DEF1_RES — 3 windows (ATT=1/2/3)', () => {
  it('has exactly 3 entries', () => {
    expect(DEF1_RES.length).toBe(3);
  });

  it('ATT=1: DEF1@0 — window length 9 accessible (NM-1)', () => {
    // offset=0, needs elements 0..8 → DEF1 has 13 — ok
    const w = DEF1_RES[0]!;
    expect(w.table).toBe(DEF1);
    expect(w.offset).toBe(0);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=2: DEF1@1 — ZIL REST(DEF1,2): byte 2 = element 1', () => {
    // 1dungeon.zil:2644: PUT DEF1-RES 1 REST(DEF1, 2)
    const w = DEF1_RES[1]!;
    expect(w.table).toBe(DEF1);
    expect(w.offset).toBe(1);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=3: DEF1@2 — ZIL REST(DEF1,4): byte 4 = element 2', () => {
    // 1dungeon.zil:2645: PUT DEF1-RES 2 REST(DEF1, 4)
    const w = DEF1_RES[2]!;
    expect(w.table).toBe(DEF1);
    expect(w.offset).toBe(2);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=1 distribution: 4M 2S 2U 1K (window DEF1[0..8])', () => {
    const d = dist(DEF1_RES[0]!);
    expect(d[MISSED]).toBe(4);
    expect(d[STAGGER]).toBe(2);
    expect(d[UNCONSCIOUS]).toBe(2);
    expect(d[KILLED]).toBe(1);
  });

  it('ATT=2 distribution: 3M 2S 2U 2K (window DEF1[1..9])', () => {
    const d = dist(DEF1_RES[1]!);
    expect(d[MISSED]).toBe(3);
    expect(d[STAGGER]).toBe(2);
    expect(d[UNCONSCIOUS]).toBe(2);
    expect(d[KILLED]).toBe(2);
  });

  it('ATT=3 distribution: 2M 2S 2U 3K (window DEF1[2..10])', () => {
    const d = dist(DEF1_RES[2]!);
    expect(d[MISSED]).toBe(2);
    expect(d[STAGGER]).toBe(2);
    expect(d[UNCONSCIOUS]).toBe(2);
    expect(d[KILLED]).toBe(3);
  });
});

describe('DEF2_RES — 4 windows (ATT=1/2/3/4)', () => {
  it('has exactly 4 entries', () => {
    expect(DEF2_RES.length).toBe(4);
  });

  it('ATT=1: DEF2A@0', () => {
    const w = DEF2_RES[0]!;
    expect(w.table).toBe(DEF2A);
    expect(w.offset).toBe(0);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=2: DEF2B@0 — initial value in 1actions.zil:3308', () => {
    const w = DEF2_RES[1]!;
    expect(w.table).toBe(DEF2B);
    expect(w.offset).toBe(0);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=3: DEF2B@1 — ZIL REST(DEF2B,2): byte 2 = element 1', () => {
    // 1dungeon.zil:2646: PUT DEF2-RES 2 REST(DEF2B, 2)
    const w = DEF2_RES[2]!;
    expect(w.table).toBe(DEF2B);
    expect(w.offset).toBe(1);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=4: DEF2B@2 — ZIL REST(DEF2B,4): byte 4 = element 2', () => {
    // 1dungeon.zil:2647: PUT DEF2-RES 3 REST(DEF2B, 4)
    const w = DEF2_RES[3]!;
    expect(w.table).toBe(DEF2B);
    expect(w.offset).toBe(2);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('ATT=1 distribution: 5M 2S 2L (DEF2A[0..8])', () => {
    const d = dist(DEF2_RES[0]!);
    expect(d[MISSED]).toBe(5);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(2);
  });

  it('ATT=2 distribution: 3M 2S 3L 1U (DEF2B[0..8])', () => {
    const d = dist(DEF2_RES[1]!);
    expect(d[MISSED]).toBe(3);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(3);
    expect(d[UNCONSCIOUS]).toBe(1);
  });

  it('ATT=3 distribution: 2M 2S 3L 1U 1K (DEF2B[1..9])', () => {
    const d = dist(DEF2_RES[2]!);
    expect(d[MISSED]).toBe(2);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(3);
    expect(d[UNCONSCIOUS]).toBe(1);
    expect(d[KILLED]).toBe(1);
  });

  it('ATT=4 distribution: 1M 2S 3L 1U 2K (DEF2B[2..10])', () => {
    const d = dist(DEF2_RES[3]!);
    expect(d[MISSED]).toBe(1);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(3);
    expect(d[UNCONSCIOUS]).toBe(1);
    expect(d[KILLED]).toBe(2);
  });
});

describe('DEF3_RES — 5 windows (net=-2/-1/0/+1/+2)', () => {
  it('has exactly 5 entries', () => {
    expect(DEF3_RES.length).toBe(5);
  });

  it('net=-2: DEF3A@0 — initial value in 1actions.zil:3313', () => {
    const w = DEF3_RES[0]!;
    expect(w.table).toBe(DEF3A);
    expect(w.offset).toBe(0);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('net=-1: DEF3A@1 — ZIL REST(DEF3A,2): byte 2 = element 1', () => {
    // 1dungeon.zil:2648: PUT DEF3-RES 1 REST(DEF3A, 2)
    const w = DEF3_RES[1]!;
    expect(w.table).toBe(DEF3A);
    expect(w.offset).toBe(1);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('net=0: DEF3B@0 — initial value in 1actions.zil:3315', () => {
    const w = DEF3_RES[2]!;
    expect(w.table).toBe(DEF3B);
    expect(w.offset).toBe(0);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('net=+1: DEF3B@1 — ZIL REST(DEF3B,2): byte 2 = element 1', () => {
    // 1dungeon.zil:2649: PUT DEF3-RES 3 REST(DEF3B, 2)
    const w = DEF3_RES[3]!;
    expect(w.table).toBe(DEF3B);
    expect(w.offset).toBe(1);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('net=+2: DEF3C@0 — initial value in 1actions.zil:3317', () => {
    const w = DEF3_RES[4]!;
    expect(w.table).toBe(DEF3C);
    expect(w.offset).toBe(0);
    expect(w.table.length - w.offset).toBeGreaterThanOrEqual(9);
  });

  it('net=-2 distribution: 5M 2S 2L (DEF3A[0..8])', () => {
    const d = dist(DEF3_RES[0]!);
    expect(d[MISSED]).toBe(5);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(2);
  });

  it('net=-1 distribution: 4M 2S 2L 1SW (DEF3A[1..9])', () => {
    const d = dist(DEF3_RES[1]!);
    expect(d[MISSED]).toBe(4);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(2);
    expect(d[SERIOUS_WOUND]).toBe(1);
  });

  it('net=0 distribution: 3M 2S 3L 1SW (DEF3B[0..8])', () => {
    const d = dist(DEF3_RES[2]!);
    expect(d[MISSED]).toBe(3);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(3);
    expect(d[SERIOUS_WOUND]).toBe(1);
  });

  it('net=+1 distribution: 2M 2S 3L 2SW (DEF3B[1..9])', () => {
    const d = dist(DEF3_RES[3]!);
    expect(d[MISSED]).toBe(2);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(3);
    expect(d[SERIOUS_WOUND]).toBe(2);
  });

  it('net=+2 distribution: 1M 2S 4L 2SW (DEF3C[0..8])', () => {
    const d = dist(DEF3_RES[4]!);
    expect(d[MISSED]).toBe(1);
    expect(d[STAGGER]).toBe(2);
    expect(d[LIGHT_WOUND]).toBe(4);
    expect(d[SERIOUS_WOUND]).toBe(2);
  });
});
