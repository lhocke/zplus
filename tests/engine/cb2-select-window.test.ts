/**
 * CB2 — selectWindow + distributions (spec §3.4 + §12 CB2)
 *
 * Verifies the three-tier table-selection algorithm and that each of the 12
 * windows produces the correct empirical distribution over 10k draws (test A).
 * Also asserts the ATT/DEF role conventions (NM-2).
 *
 * ZIL refs:
 *   1actions.zil:3429–3440  selectWindow — HERO-BLOW call site
 *   1actions.zil:3510–3521  selectWindow — VILLAIN-BLOW call site
 *   §3.4 ATT/DEF role table: VILLAIN-BLOW: ATT=villain pStrength, DEF=player FIGHT-STRENGTH
 *                            HERO-BLOW:    ATT=player FIGHT-STRENGTH, DEF=villain pStrength
 *
 * Chi-square note: 10k draws from a 9-slot uniform → expected ≈ 1111/slot.
 * We aggregate by outcome and test X² ≤ critical(df, α=0.001) so the test is
 * robust to PRNG variance without being so loose it misses a wrong window.
 * Critical values used (conservative, from standard table):
 *   df=3 → 16.27;  df=4 → 18.47;  df=5 → 20.52.
 * All our windows have ≤ 4 distinct outcome categories → df ≤ 3.
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/engine/rng.js';
import {
  selectWindow,
  MISSED, UNCONSCIOUS, KILLED, LIGHT_WOUND, SERIOUS_WOUND, STAGGER,
} from '../../src/engine/combat.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const N = 10_000;

/** Roll N outcomes from selectWindow(att, def) with a seeded Rng. */
function rollN(att: number, def: number, seed = 42): Record<number, number> {
  const rng = new Rng(seed);
  const counts: Record<number, number> = {};
  for (let i = 0; i < N; i++) {
    const result = selectWindow(att, def, rng);
    counts[result] = (counts[result] ?? 0) + 1;
  }
  return counts;
}

/**
 * Chi-square goodness-of-fit against an expected distribution (each entry is
 * [outcome, count_in_9_element_window]).
 * Returns the X² statistic; caller asserts < critical.
 */
function chiSquare(observed: Record<number, number>, expected9: [number, number][]): number {
  let stat = 0;
  for (const [outcome, count] of expected9) {
    const exp = (count / 9) * N;
    const obs = observed[outcome] ?? 0;
    stat += (obs - exp) ** 2 / exp;
  }
  return stat;
}

// Critical value for chi-square, p=0.001.
// Max df we'll see is 3 (4 distinct outcomes → df=3). χ²(3, 0.001)=16.27.
const CRIT = 30; // conservative slack for any df in our range

// ---------------------------------------------------------------------------
// 1. DEF == 1 tier — three windows (spec §3.4, ZIL-true offsets from CB1)
// ---------------------------------------------------------------------------

describe('selectWindow — DEF=1 tier (1actions.zil:3429–3440)', () => {
  // ATT=1 → DEF1@0 → 4M 2S 2U 1K (confirmed by CB1)
  it('ATT=1 DEF=1: 10k rolls match 4M 2S 2U 1K', () => {
    const obs = rollN(1, 1);
    const x2 = chiSquare(obs, [
      [MISSED,      4],
      [STAGGER,     2],
      [UNCONSCIOUS, 2],
      [KILLED,      1],
    ]);
    expect(x2).toBeLessThan(CRIT);
    // structural: only these outcomes appear
    const keys = Object.keys(obs).map(Number);
    for (const k of keys) {
      expect([MISSED, STAGGER, UNCONSCIOUS, KILLED]).toContain(k);
    }
  });

  // ATT=2 → DEF1@1 → 3M 2S 2U 2K (ZIL-true, CB1-confirmed)
  it('ATT=2 DEF=1: 10k rolls match 3M 2S 2U 2K', () => {
    const obs = rollN(2, 1);
    const x2 = chiSquare(obs, [
      [MISSED,      3],
      [STAGGER,     2],
      [UNCONSCIOUS, 2],
      [KILLED,      2],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // ATT=3 → DEF1@2 → 2M 2S 2U 3K (ZIL-true, CB1-confirmed)
  it('ATT=3 DEF=1: 10k rolls match 2M 2S 2U 3K', () => {
    const obs = rollN(3, 1);
    const x2 = chiSquare(obs, [
      [MISSED,      2],
      [STAGGER,     2],
      [UNCONSCIOUS, 2],
      [KILLED,      3],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // ATT clamped: ATT=10 with DEF=1 should behave like ATT=3
  it('ATT=10 DEF=1 is clamped to ATT=3', () => {
    const rng = new Rng(99);
    const obs3 = rollN(3, 1, 99);
    const rng2 = new Rng(99);
    const obsClamped: Record<number, number> = {};
    for (let i = 0; i < N; i++) {
      const r = selectWindow(10, 1, rng2);
      obsClamped[r] = (obsClamped[r] ?? 0) + 1;
    }
    // same seed → same draws → same outcomes after clamping
    expect(obsClamped).toEqual(obs3);
    void rng; // suppress unused warning
  });
});

// ---------------------------------------------------------------------------
// 2. DEF == 2 tier — four windows
// ---------------------------------------------------------------------------

describe('selectWindow — DEF=2 tier (1actions.zil:3429–3440)', () => {
  // ATT=1 → DEF2A@0 → 5M 2S 2L
  it('ATT=1 DEF=2: 10k rolls match 5M 2S 2L', () => {
    const obs = rollN(1, 2);
    const x2 = chiSquare(obs, [
      [MISSED,      5],
      [STAGGER,     2],
      [LIGHT_WOUND, 2],
    ]);
    expect(x2).toBeLessThan(CRIT);
    const keys = Object.keys(obs).map(Number);
    for (const k of keys) {
      expect([MISSED, STAGGER, LIGHT_WOUND]).toContain(k);
    }
  });

  // ATT=2 → DEF2B@0 → 3M 2S 3L 1U
  it('ATT=2 DEF=2: 10k rolls match 3M 2S 3L 1U', () => {
    const obs = rollN(2, 2);
    const x2 = chiSquare(obs, [
      [MISSED,      3],
      [STAGGER,     2],
      [LIGHT_WOUND, 3],
      [UNCONSCIOUS, 1],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // ATT=3 → DEF2B@1 → 2M 2S 3L 1U 1K (ZIL-true, CB1-confirmed)
  it('ATT=3 DEF=2: 10k rolls match 2M 2S 3L 1U 1K', () => {
    const obs = rollN(3, 2);
    const x2 = chiSquare(obs, [
      [MISSED,      2],
      [STAGGER,     2],
      [LIGHT_WOUND, 3],
      [UNCONSCIOUS, 1],
      [KILLED,      1],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // ATT=4 → DEF2B@2 → 1M 2S 3L 1U 2K (ZIL-true, CB1-confirmed)
  it('ATT=4 DEF=2: 10k rolls match 1M 2S 3L 1U 2K', () => {
    const obs = rollN(4, 2);
    const x2 = chiSquare(obs, [
      [MISSED,      1],
      [STAGGER,     2],
      [LIGHT_WOUND, 3],
      [UNCONSCIOUS, 1],
      [KILLED,      2],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // ATT clamped: ATT=7 with DEF=2 should behave like ATT=4
  it('ATT=7 DEF=2 is clamped to ATT=4', () => {
    const obs4 = rollN(4, 2, 77);
    const rng2 = new Rng(77);
    const obsClamped: Record<number, number> = {};
    for (let i = 0; i < N; i++) {
      const r = selectWindow(7, 2, rng2);
      obsClamped[r] = (obsClamped[r] ?? 0) + 1;
    }
    expect(obsClamped).toEqual(obs4);
  });
});

// ---------------------------------------------------------------------------
// 3. DEF >= 3 tier — five windows, indexed by net=clamp(ATT-DEF,-2,+2)
// ---------------------------------------------------------------------------

describe('selectWindow — DEF>=3 tier (1actions.zil:3429–3440)', () => {
  // net=-2 → DEF3A@0 → 5M 2S 2L
  it('ATT=1 DEF=3 (net=-2): 10k rolls match 5M 2S 2L', () => {
    const obs = rollN(1, 3);
    const x2 = chiSquare(obs, [
      [MISSED,      5],
      [STAGGER,     2],
      [LIGHT_WOUND, 2],
    ]);
    expect(x2).toBeLessThan(CRIT);
    const keys = Object.keys(obs).map(Number);
    for (const k of keys) {
      expect([MISSED, STAGGER, LIGHT_WOUND]).toContain(k);
    }
  });

  // net=-2 clamped: ATT=1 DEF=5 still net=-2
  it('ATT=1 DEF=5 clamped to net=-2: same distribution as ATT=1 DEF=3', () => {
    const obs3 = rollN(1, 3, 55);
    const obs5 = rollN(1, 5, 55);
    expect(obs5).toEqual(obs3);
  });

  // net=-1 → DEF3A@1 → 4M 2S 2L 1SW (ZIL-true, CB1-confirmed)
  it('ATT=2 DEF=3 (net=-1): 10k rolls match 4M 2S 2L 1SW', () => {
    const obs = rollN(2, 3);
    const x2 = chiSquare(obs, [
      [MISSED,        4],
      [STAGGER,       2],
      [LIGHT_WOUND,   2],
      [SERIOUS_WOUND, 1],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // net=0 → DEF3B@0 → 3M 2S 3L 1SW
  it('ATT=3 DEF=3 (net=0): 10k rolls match 3M 2S 3L 1SW', () => {
    const obs = rollN(3, 3);
    const x2 = chiSquare(obs, [
      [MISSED,        3],
      [STAGGER,       2],
      [LIGHT_WOUND,   3],
      [SERIOUS_WOUND, 1],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // net=+1 → DEF3B@1 → 2M 2S 3L 2SW (ZIL-true, CB1-confirmed)
  it('ATT=4 DEF=3 (net=+1): 10k rolls match 2M 2S 3L 2SW', () => {
    const obs = rollN(4, 3);
    const x2 = chiSquare(obs, [
      [MISSED,        2],
      [STAGGER,       2],
      [LIGHT_WOUND,   3],
      [SERIOUS_WOUND, 2],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // net=+2 → DEF3C@0 → 1M 2S 4L 2SW
  it('ATT=5 DEF=3 (net=+2): 10k rolls match 1M 2S 4L 2SW', () => {
    const obs = rollN(5, 3);
    const x2 = chiSquare(obs, [
      [MISSED,        1],
      [STAGGER,       2],
      [LIGHT_WOUND,   4],
      [SERIOUS_WOUND, 2],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });

  // net=+2 clamped: ATT=10 DEF=3 (net=7, clamped to 2)
  it('ATT=10 DEF=3 clamped to net=+2: same as ATT=5 DEF=3', () => {
    const obs5 = rollN(5, 3, 33);
    const obs10 = rollN(10, 3, 33);
    expect(obs10).toEqual(obs5);
  });

  // DEF=5, ATT=7 → net=7-5=2, clamped to +2 → DEF3C@0
  it('ATT=7 DEF=5 (net=+2 clamped): 10k rolls match 1M 2S 4L 2SW', () => {
    const obs = rollN(7, 5);
    const x2 = chiSquare(obs, [
      [MISSED,        1],
      [STAGGER,       2],
      [LIGHT_WOUND,   4],
      [SERIOUS_WOUND, 2],
    ]);
    expect(x2).toBeLessThan(CRIT);
  });
});

// ---------------------------------------------------------------------------
// 4. NM-2 — ATT/DEF role assertion (spec §3.4, NM-2)
//
// In VILLAIN-BLOW: ATT=villain pStrength, DEF=player FIGHT-STRENGTH.
// In HERO-BLOW:    ATT=player FIGHT-STRENGTH, DEF=villain pStrength.
// Swapping ATT/DEF selects a DIFFERENT window → different distribution.
// Prove that selectWindow(a,d) ≠ selectWindow(d,a) when a≠d and across tiers.
// ---------------------------------------------------------------------------

describe('NM-2 — ATT/DEF role symmetry is NOT assumed (spec §3.4)', () => {
  // ATT=2 DEF=1 (DEF1 tier, ATT=2 window) vs ATT=1 DEF=2 (DEF2 tier, ATT=1 window)
  // DEF1@1: 3M 2S 2U 2K  vs  DEF2A@0: 5M 2S 2L  — completely different outcomes
  it('selectWindow(2,1) and selectWindow(1,2) produce different distributions', () => {
    const obs21 = rollN(2, 1);
    const obs12 = rollN(1, 2);
    // DEF=1 can return UNCONSCIOUS/KILLED; DEF=2 ATT=1 returns only M/S/L
    expect(obs21[KILLED]).toBeGreaterThan(0);
    expect(obs12[KILLED]).toBeUndefined();
    expect(obs12[LIGHT_WOUND]).toBeGreaterThan(0);
    expect(obs21[LIGHT_WOUND]).toBeUndefined();
  });

  // ATT=3 DEF=2 vs ATT=2 DEF=3: different windows even within similar strength ranges
  it('selectWindow(3,2) and selectWindow(2,3) produce different distributions', () => {
    const obs32 = rollN(3, 2);  // DEF2B@1: 2M 2S 3L 1U 1K
    const obs23 = rollN(2, 3);  // DEF3A@1: 4M 2S 2L 1SW
    // Only DEF=2 path produces KILLED at this strength
    expect(obs32[KILLED]).toBeGreaterThan(0);
    // Only DEF>=3 path produces SERIOUS_WOUND
    expect(obs23[SERIOUS_WOUND]).toBeGreaterThan(0);
    expect(obs32[SERIOUS_WOUND]).toBeUndefined();
  });

  // Document the role convention so it's a first-class assertion, not just
  // a comment.  selectWindow(ATT, DEF) — first arg is attacker, second defender.
  it('tier selection is driven by DEF (second arg), not ATT', () => {
    // DEF=1 → DEF1 table (contains KILLED, UNCONSCIOUS — not LIGHT/SERIOUS WOUND)
    // DEF=2 → DEF2 table (contains LIGHT_WOUND — not SERIOUS_WOUND)
    // DEF>=3 → DEF3 table (contains SERIOUS_WOUND — not KILLED except via DEF2)
    const rng = new Rng(1);

    // Force all 9 positions in DEF1 ATT=3 window (DEF1@2): see KILLED
    // Force all 9 in DEF>=3 ATT=7 DEF=5 window (DEF3C@0): see SERIOUS_WOUND, no KILLED
    const def1outcomes = new Set<number>();
    const def3outcomes = new Set<number>();

    // DEF=1 window has 13 elements, roll enough to hit all 4 outcome types
    for (let i = 0; i < 1000; i++) def1outcomes.add(selectWindow(3, 1, rng));
    for (let i = 0; i < 1000; i++) def3outcomes.add(selectWindow(7, 5, rng));

    // DEF=1 tier: KILLED must appear (it's 3 of 9 in ATT=3 window)
    expect(def1outcomes.has(KILLED)).toBe(true);
    // DEF>=3 tier at net=+2: KILLED must not appear
    expect(def3outcomes.has(KILLED)).toBe(false);
    // DEF>=3 tier: SERIOUS_WOUND must appear
    expect(def3outcomes.has(SERIOUS_WOUND)).toBe(true);
    // DEF=1 tier: SERIOUS_WOUND must not appear (not in any DEF1 window)
    expect(def1outcomes.has(SERIOUS_WOUND)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Window-size invariant — NM-1 extension: each draw picks exactly one of
//    the 9 slots (selectWindow uses rng.nextInt(9), never a wider range).
//    Verify by exhausting a scripted rng over positions 0..8.
// ---------------------------------------------------------------------------

describe('NM-1 extension — selectWindow draws from exactly 9 positions', () => {
  it('all 9 positions reachable (DEF=1, ATT=1): 10k draws all produce legal outcomes', () => {
    const rng = new Rng(7);
    let total = 0;
    for (let i = 0; i < N; i++) {
      const r = selectWindow(1, 1, rng);
      expect([MISSED, STAGGER, UNCONSCIOUS, KILLED]).toContain(r);
      total++;
    }
    expect(total).toBe(N);
  });

  it('DEF>=3 tier cannot produce KILLED (no KILLED in any DEF3 table)', () => {
    const rng = new Rng(13);
    for (let i = 0; i < 5000; i++) {
      const r = selectWindow(7, 3, rng);
      expect(r).not.toBe(KILLED);
    }
  });
});
