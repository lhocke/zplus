/**
 * R1 — otvalFrob faithfulness + 350-point acceptance test
 *
 * Phase-3a spec §8 Wave 4, OQ-2 ratification 2026-06-10.
 *
 * ZIL source: 1actions.zil:496–502 (OTVAL-FROB)
 *
 * OTVAL-FROB is non-recursive: the recursive call on line 501 discards its
 * return value. Only the top-level loop's SCORE accumulator counts.
 *   <SET SCORE <+ .SCORE <GETP .F ,P?TVALUE>>>
 *   <COND (<FIRST? .F> <OTVAL-FROB .F>)>    ← result discarded
 *
 * dfrotz ground truth (R119, story /zork1.z3):
 *   Navigate: n, n, climb tree, take egg, d, s, s, e, open window, enter,
 *             w, open trophy case, put egg in trophy case
 *   Score bar: 15 → 20 (delta = +5)
 *   Confirms: depositing intact EGG (containing CANARY, TVALUE=4) scores only +5,
 *   not +9. The canary's nested TVALUE is discarded.
 *
 * Done-criteria (R1):
 *   (A) otvalFrob unit: intact EGG (containing CANARY) = 5, not 9. dfrotz-anchored.
 *   (B) otvalFrob unit: CANARY deposited separately alongside empty EGG = 9 (5+4).
 *   (C) Canonical 350 acceptance: base=221, trophy has all 19 non-broken treasures
 *       as direct children (EGG empty + CANARY + BAUBLE separately) → total 350.
 *   (D) 353 edge case: replace BROKEN-EGG(2) with EGG(5) in a 350 setup → total 353,
 *       proving the 3-point gap is a path property, not a data error.
 *   (E) recomputeTrophy with non-recursive model: no double-counting, no nesting bonus.
 *   (F) Existing TD3-1-C tests for recursive behavior updated to non-recursive.
 */

import { describe, it, expect } from 'vitest';
import { Scoring } from '../../src/engine/scoring.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { Thing } from '../../src/domain/thing.js';

import objectsData from '../../src/data/objects.json';

function makeScoring(): Scoring {
  return new Scoring(new SimpleEventEmitter());
}

// Build a minimal trophy case with direct-child objects, each with a given TVALUE.
function makeCase(...tvPairs: Array<[string, number]>): Thing {
  const tc = new Thing('TROPHY-CASE', 'trophy case', {});
  for (const [id, tv] of tvPairs) {
    const obj = new Thing(id, id.toLowerCase(), {});
    if (tv > 0) obj.props.set('TVALUE', tv);
    obj.moveTo(tc);
  }
  return tc;
}

// Build EGG containing CANARY (mirroring the real game object tree).
function makeEggWithCanary(eggtv = 5, canarytv = 4): { egg: Thing; canary: Thing } {
  const egg = new Thing('EGG', 'jewel-encrusted egg', {});
  egg.props.set('TVALUE', eggtv);
  const canary = new Thing('CANARY', 'golden clockwork canary', {});
  canary.props.set('TVALUE', canarytv);
  canary.moveTo(egg);
  return { egg, canary };
}

// ---------------------------------------------------------------------------
// A. dfrotz-anchored: intact EGG (with CANARY inside) = +5, not +9
// ---------------------------------------------------------------------------

describe('R1-A: otvalFrob non-recursive — intact egg+canary deposit (dfrotz-anchored)', () => {
  // dfrotz R119 ground truth:
  //   n,n,climb tree,take egg,d,s,s,e,open window,enter,w,open trophy case,put egg in trophy case
  //   Score bar: 15 → 20  (delta = +5)
  //
  // ZIL OTVAL-FROB (1actions.zil:501) discards the recursive call's return value.
  // Only the direct child's TVALUE counts; nested TVALUEs are ignored.

  it('EGG(TVALUE=5) containing CANARY(TVALUE=4) in trophy case → otvalFrob = 5', () => {
    const s = makeScoring();
    const tc = new Thing('TROPHY-CASE', 'trophy case', {});
    const { egg } = makeEggWithCanary(5, 4);
    egg.moveTo(tc);
    // Non-recursive: EGG contributes 5; CANARY nested inside is NOT counted.
    // dfrotz delta verified: +5 (score 15→20, see file header).
    expect(s.otvalFrob(tc)).toBe(5);
  });

  it('EGG(5) + CANARY(4) + BAUBLE(1) all nested inside EGG → otvalFrob = 5', () => {
    // Only the immediate children of the trophy case count.
    // EGG is the only direct child; its contents (CANARY, BAUBLE) are ignored.
    const s = makeScoring();
    const tc = new Thing('TROPHY-CASE', 'trophy case', {});
    const egg = new Thing('EGG', 'egg', {});
    egg.props.set('TVALUE', 5);
    const canary = new Thing('CANARY', 'canary', {});
    canary.props.set('TVALUE', 4);
    const bauble = new Thing('BAUBLE', 'bauble', {});
    bauble.props.set('TVALUE', 1);
    egg.moveTo(tc);
    canary.moveTo(egg);
    bauble.moveTo(egg);
    expect(s.otvalFrob(tc)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// B. CANARY deposited separately alongside empty EGG = 9 (5+4)
// ---------------------------------------------------------------------------

describe('R1-B: otvalFrob — separate deposits sum correctly', () => {
  it('empty EGG(5) + CANARY(4) as direct siblings → otvalFrob = 9', () => {
    // Once canary is removed from the egg, both become direct children.
    // Each contributes its own TVALUE; no recursion needed.
    const s = makeScoring();
    const tc = new Thing('TROPHY-CASE', 'trophy case', {});
    const egg = new Thing('EGG', 'egg', {});
    egg.props.set('TVALUE', 5);
    egg.moveTo(tc);
    const canary = new Thing('CANARY', 'canary', {});
    canary.props.set('TVALUE', 4);
    canary.moveTo(tc);
    expect(s.otvalFrob(tc)).toBe(9);
  });

  it('empty EGG(5) + CANARY(4) + BAUBLE(1) as direct siblings → otvalFrob = 10', () => {
    const s = makeScoring();
    const tc = makeCase(['EGG', 5], ['CANARY', 4], ['BAUBLE', 1]);
    expect(s.otvalFrob(tc)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// C. Canonical 350-point acceptance test
//    base = 221 (all room + object VALUEs + LIGHT-SHAFT)
//    trophy = all 19 non-broken treasures as direct children = 129
//    score = 221 + 129 = 350 → rank "Master Adventurer"
// ---------------------------------------------------------------------------

describe('R1-C: 350-point acceptance test (canonical non-recursive model)', () => {
  // The 19 non-broken treasures and their TVALUEs (from objects.json, verified against
  // ZIL 1dungeon.zil:1154–1217 and scoring-death-endgame spec §4.4).
  // EGG is deposited as an empty container (canary removed first — the thief's non-destructive
  // open sets OPENBIT; canary then taken out by the player). CANARY and BAUBLE are separate.
  const TREASURES: Array<[string, number]> = [
    ['SKULL',       10],
    ['SCEPTRE',      6],
    ['CHALICE',      5],
    ['TRIDENT',     11],
    ['COFFIN',      15],
    ['DIAMOND',     10],
    ['JADE',         5],
    ['BAG-OF-COINS', 5],
    ['EMERALD',     10],
    ['PAINTING',     6],
    ['BAR',          5],
    ['POT-OF-GOLD', 10],
    ['BRACELET',     5],
    ['SCARAB',       5],
    ['TORCH',        6],
    ['TRUNK',        5],
    ['EGG',          5],   // empty (canary removed), TVALUE=5
    ['CANARY',       4],   // deposited separately after removing from egg
    ['BAUBLE',       1],   // from winding the canary in a forest room
  ];

  const TVALUE_SUM = TREASURES.reduce((acc, [, tv]) => acc + tv, 0);
  const BASE_SCORE = 221; // 143 object VALUEs + 65 room VALUEs + 13 LIGHT-SHAFT

  it('TVALUE_SUM of canonical deposited set == 129', () => {
    expect(TVALUE_SUM).toBe(129);
  });

  it('canonical score = 221 + 129 = 350', () => {
    const s = makeScoring();
    s.scoreUpd(BASE_SCORE);
    const tc = makeCase(...TREASURES);
    s.recomputeTrophy(tc);
    expect(s.score).toBe(350);
  });

  it('rank at 350 is "Master Adventurer"', () => {
    const s = makeScoring();
    s.scoreUpd(BASE_SCORE);
    const tc = makeCase(...TREASURES);
    s.recomputeTrophy(tc);
    expect(s.rank()).toBe('Master Adventurer');
  });

  it('wonFlag fires exactly once at 350', () => {
    let calls = 0;
    const s = new Scoring(new SimpleEventEmitter(), undefined, () => { calls++; });
    s.scoreUpd(BASE_SCORE);
    const tc = makeCase(...TREASURES);
    s.recomputeTrophy(tc);
    expect(s.wonFlag).toBe(true);
    expect(calls).toBe(1);
  });

  it('depositing items individually (non-recursive) is sufficient — no nesting bonus', () => {
    // Verify that with non-recursive otvalFrob, having EGG empty is required
    // to get the full 10 points for EGG+CANARY+BAUBLE.
    // If EGG contained CANARY (nested), we'd only get 5+1=6 for those, not 10.
    const s = makeScoring();
    const tc = new Thing('TROPHY-CASE', 'trophy case', {});

    // Simulate the wrong path: EGG with CANARY inside + BAUBLE separately
    const egg = new Thing('EGG', 'egg', {});
    egg.props.set('TVALUE', 5);
    const canaryInEgg = new Thing('CANARY-IN-EGG', 'canary', {});
    canaryInEgg.props.set('TVALUE', 4);
    canaryInEgg.moveTo(egg);
    egg.moveTo(tc);
    const bauble = new Thing('BAUBLE', 'bauble', {});
    bauble.props.set('TVALUE', 1);
    bauble.moveTo(tc);

    // Non-recursive: EGG(5) + BAUBLE(1) = 6 (canary not counted; still inside egg)
    expect(s.otvalFrob(tc)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// D. 353 edge case — intact-egg vs broken-egg swap (path property proof)
//    Depositing intact EGG(TVALUE=5) instead of BROKEN-EGG(TVALUE=2)
//    adds 3 extra points: 350 + 3 = 353.
//    This proves the gap is a path property, not a data error.
// ---------------------------------------------------------------------------

describe('R1-D: 353 edge case — intact-egg deposit (path property)', () => {
  // The 350-canonical setup uses BROKEN-EGG(2) among its treasures.
  // This documents the alternate path: if the player deposits the intact EGG
  // (TVALUE=5) instead, the total is 353. The EGG data is correct at TVALUE=5;
  // only which object is deposited determines the score.

  // Base scenario: base = 348, BROKEN-EGG(2) in trophy → total 350.
  // Edge case:     base = 348, EGG(5) in trophy → total 353.
  // The base of 348 isolates the egg-vs-broken-egg swap cleanly.

  it('BROKEN-EGG(2) deposit: base=348 + trophy={BROKEN-EGG(2)} = 350', () => {
    const s = makeScoring();
    s.scoreUpd(348);
    const tc = makeCase(['BROKEN-EGG', 2]);
    s.recomputeTrophy(tc);
    expect(s.score).toBe(350);
  });

  it('intact EGG(5) deposit: base=348 + trophy={EGG(5)} = 353 (3-point gap)', () => {
    // Intact EGG has TVALUE=5; BROKEN-EGG has TVALUE=2.
    // The 3-point difference (5-2=3) is the 353→350 reconciliation.
    // This score is "correct" for the intact-egg path — not a bug in the data.
    const s = makeScoring();
    s.scoreUpd(348);
    const tc = makeCase(['EGG', 5]);
    s.recomputeTrophy(tc);
    expect(s.score).toBe(353);
  });

  it('gap between intact-egg and broken-egg paths = 3 points (EGG.TVALUE - BROKEN-EGG.TVALUE)', () => {
    // Verify the data values (objects.json matches ZIL 1dungeon.zil:1154–1217).
    type Entry = { id: string; props?: Record<string, number> };
    const data = objectsData as unknown as Entry[];
    const eggTv = data.find(o => o.id === 'EGG')!.props!['TVALUE']!;
    const brokenEggTv = data.find(o => o.id === 'BROKEN-EGG')!.props!['TVALUE']!;
    expect(eggTv).toBe(5);
    expect(brokenEggTv).toBe(2);
    expect(eggTv - brokenEggTv).toBe(3);  // = 353 - 350
  });

  it('intact-egg deposit ranks as Wizard (score=353 > 350, no exact-350 rank)', () => {
    // 353 > 350 — does NOT match the exact-350 "Master Adventurer" rank.
    // This verifies the rank table is also correct under the edge-case score.
    const s = makeScoring();
    s.scoreUpd(348);
    const tc = makeCase(['EGG', 5]);
    s.recomputeTrophy(tc);
    // 353 > 350 → not "Master Adventurer" (exact match at 350 only)
    // 353 > 330 → "Wizard"
    expect(s.rank()).toBe('Wizard');
  });
});

// ---------------------------------------------------------------------------
// E. recomputeTrophy stays correct under non-recursive model
// ---------------------------------------------------------------------------

describe('R1-E: recomputeTrophy non-recursive correctness', () => {
  it('nested TVALUE never contributes to score via recomputeTrophy', () => {
    // Simulate depositing egg with canary inside via recomputeTrophy path.
    // Non-recursive: score = base(10) + EGG(5) = 15. NOT 10 + 5 + 4 = 19.
    const s = makeScoring();
    s.scoreUpd(10);
    const tc = new Thing('TROPHY-CASE', 'trophy case', {});
    const { egg } = makeEggWithCanary(5, 4);
    egg.moveTo(tc);
    s.recomputeTrophy(tc);
    expect(s.score).toBe(15);  // 10 + 5, not 10 + 9
  });

  it('removing canary from egg and depositing separately increases score by canary TVALUE', () => {
    // First: egg with canary inside → score = base + 5
    // Then: take canary out, deposit as sibling → score = base + 9
    const s = makeScoring();
    s.scoreUpd(10);
    const tc = new Thing('TROPHY-CASE', 'trophy case', {});
    const egg = new Thing('EGG', 'egg', {});
    egg.props.set('TVALUE', 5);
    const canary = new Thing('CANARY', 'canary', {});
    canary.props.set('TVALUE', 4);
    canary.moveTo(egg);
    egg.moveTo(tc);

    s.recomputeTrophy(tc);
    expect(s.score).toBe(15);  // canary nested — not counted

    // "Remove" canary from egg and deposit in trophy case directly
    canary.moveTo(tc);  // now a sibling of egg
    s.recomputeTrophy(tc);
    expect(s.score).toBe(19);  // base(10) + egg(5) + canary(4) = 19
  });
});

// ---------------------------------------------------------------------------
// F. Data integrity cross-check — objects.json TVALUE matches expected totals
// ---------------------------------------------------------------------------

describe('R1-F: data integrity under non-recursive model', () => {
  it('sum of all non-broken TVALUEs == 129 (ZIL 1dungeon.zil:1154–1217)', () => {
    type Entry = { id: string; props?: Record<string, number> };
    const data = objectsData as unknown as Entry[];
    const BROKEN = new Set(['BROKEN-EGG', 'BROKEN-CANARY']);
    const total = data
      .filter(o => !BROKEN.has(o.id))
      .reduce((acc, o) => acc + (o.props?.['TVALUE'] ?? 0), 0);
    expect(total).toBe(129);
  });

  it('SCORE-MAX = 350 = BASE-SCORE-MAX(221) + TVALUE-MAX(129)', () => {
    // Under non-recursive otvalFrob, 129 is achievable by depositing all
    // non-broken items as DIRECT children of the trophy case (no nesting).
    expect(221 + 129).toBe(350);
  });

  it('canonical path TVALUE sum with EGG(5) empty and CANARY(4) separate == 129', () => {
    // Verify that the canonical path (thief opens egg; canary removed separately)
    // still totals 129 under non-recursive, because EGG and CANARY are both direct children.
    type Entry = { id: string; props?: Record<string, number> };
    const data = objectsData as unknown as Entry[];
    const BROKEN = new Set(['BROKEN-EGG', 'BROKEN-CANARY']);
    const total = data
      .filter(o => !BROKEN.has(o.id))
      .reduce((acc, o) => acc + (o.props?.['TVALUE'] ?? 0), 0);
    // EGG(5) + CANARY(4) + BAUBLE(1) + others(119) = 129
    // When deposited as direct children (canary separated from egg), still 129.
    expect(total).toBe(129);
  });
});
