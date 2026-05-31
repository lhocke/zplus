import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { Scoring } from '../../src/engine/scoring';
import { SimpleEventEmitter } from '../../src/engine/events';
import type { EngineEvent } from '../../src/engine/events';

// ---------------------------------------------------------------------------
// RNG — seeded, deterministic
// ---------------------------------------------------------------------------

describe('Rng', () => {
  it('next() returns values in [0, 1)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 50; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed produces the same sequence', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    // Very unlikely to be identical with different seeds.
    expect(seqA).not.toEqual(seqB);
  });

  it('nextInt(n) returns integer in [0, n)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 50; i++) {
      const v = rng.nextInt(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('nextInt(n) with same seed is deterministic', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 20; i++) {
      expect(a.nextInt(10)).toBe(b.nextInt(10));
    }
  });

  it('seed() resets to the given seed and replays the sequence', () => {
    const rng = new Rng(55);
    const first = rng.next();
    rng.next();
    rng.next();
    rng.seed(55);
    expect(rng.next()).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Scoring — tracks score, emits score-changed, rank thresholds
// ---------------------------------------------------------------------------

describe('Scoring', () => {
  function makeScoring() {
    const emitter = new SimpleEventEmitter();
    const scoring = new Scoring(emitter);
    return { scoring, emitter };
  }

  it('starts at 0', () => {
    const { scoring } = makeScoring();
    expect(scoring.score).toBe(0);
  });

  it('add(n) increases the score', () => {
    const { scoring } = makeScoring();
    scoring.add(10);
    expect(scoring.score).toBe(10);
    scoring.add(25);
    expect(scoring.score).toBe(35);
  });

  it('add(n) emits score-changed with correct score and delta', () => {
    const { scoring, emitter } = makeScoring();
    const events: Array<Extract<EngineEvent, { type: 'score-changed' }>> = [];
    emitter.on('score-changed', e => events.push(e));

    scoring.add(15);
    expect(events).toHaveLength(1);
    expect(events[0]!.score).toBe(15);
    expect(events[0]!.delta).toBe(15);

    scoring.add(5);
    expect(events).toHaveLength(2);
    expect(events[1]!.score).toBe(20);
    expect(events[1]!.delta).toBe(5);
  });

  it('add(0) does not emit score-changed', () => {
    const { scoring, emitter } = makeScoring();
    const events: EngineEvent[] = [];
    emitter.on('score-changed', e => events.push(e));
    scoring.add(0);
    expect(events).toHaveLength(0);
  });

  it('add with negative delta (penalty) decreases score and emits', () => {
    const { scoring, emitter } = makeScoring();
    const events: Array<Extract<EngineEvent, { type: 'score-changed' }>> = [];
    emitter.on('score-changed', e => events.push(e));

    scoring.add(50);
    scoring.add(-10);
    expect(scoring.score).toBe(40);
    expect(events[1]!.delta).toBe(-10);
    expect(events[1]!.score).toBe(40);
  });

  it('rank() returns the correct title at score boundaries (8-rank table)', () => {
    // ZIL source: 1actions.zil:4026–4044.  Exclusive lower bounds (> N) except
    // the top rank which is exact (== 350).
    //
    //  SCORE == 350  → Master Adventurer
    //  SCORE > 330   → Wizard
    //  SCORE > 300   → Master
    //  SCORE > 200   → Adventurer
    //  SCORE > 100   → Junior Adventurer
    //  SCORE > 50    → Novice Adventurer
    //  SCORE > 25    → Amateur Adventurer
    //  else          → Beginner
    const cases: Array<[number, string]> = [
      [0,   'Beginner'],
      [25,  'Beginner'],         // 25 is NOT > 25
      [26,  'Amateur Adventurer'],
      [50,  'Amateur Adventurer'], // 50 is NOT > 50
      [51,  'Novice Adventurer'],
      [100, 'Novice Adventurer'],  // 100 is NOT > 100
      [101, 'Junior Adventurer'],
      [200, 'Junior Adventurer'],  // 200 is NOT > 200
      [201, 'Adventurer'],
      [300, 'Adventurer'],         // 300 is NOT > 300
      [301, 'Master'],
      [330, 'Master'],             // 330 is NOT > 330
      [331, 'Wizard'],
      [349, 'Wizard'],             // 349 != 350
      [350, 'Master Adventurer'],  // exact match
    ];

    for (const [score, expectedRank] of cases) {
      const e2 = new SimpleEventEmitter();
      const sc = new Scoring(e2);
      sc.add(score);
      expect(sc.rank()).toBe(expectedRank);
    }
  });

  it('rank thresholds cover all 8 Zork I ranks', () => {
    // All rank labels in the correct 8-rank table (td3-scoring-death-SPEC.md §7).
    const allRanks = [
      'Beginner',
      'Amateur Adventurer',
      'Novice Adventurer',
      'Junior Adventurer',
      'Adventurer',
      'Master',
      'Wizard',
      'Master Adventurer',
    ];
    const seen = new Set<string>();

    for (let s = 0; s <= 350; s++) {
      const e2 = new SimpleEventEmitter();
      const sc2 = new Scoring(e2);
      sc2.add(s);
      seen.add(sc2.rank());
    }

    for (const r of allRanks) {
      expect(seen).toContain(r);
    }
  });
});
