/**
 * SS3 — Scoring.snapshotState() / Scoring.restoreState()
 *
 * Spec §3.5: restore sets _baseScore/_score/_wonFlag directly without
 * re-firing wonFlagHook. The world effects already happened in the saved game
 * and are captured in object/flag deltas — re-firing would double-emit the whisper.
 */

import { describe, it, expect } from 'vitest';
import { Scoring } from '../../src/engine/scoring.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { createGame } from '../../src/engine/bootstrap.js';

function makeScoring(hook?: (tell: (s: string) => void) => void) {
  return new Scoring(new SimpleEventEmitter(), undefined, hook);
}

// ---------------------------------------------------------------------------
// 1. snapshotState captures all three accumulators
// ---------------------------------------------------------------------------

describe('SS3 snapshotState', () => {
  it('captures baseScore, score, wonFlag', () => {
    const s = makeScoring();
    s.scoreUpd(42);
    const snap = s.snapshotState();
    expect(snap.baseScore).toBe(42);
    expect(snap.score).toBe(42);
    expect(snap.wonFlag).toBe(false);
  });

  it('captures wonFlag=true after triggering it', () => {
    const s = makeScoring();
    s.scoreUpd(350);
    const snap = s.snapshotState();
    expect(snap.wonFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. restoreState reinstates all three accumulators
// ---------------------------------------------------------------------------

describe('SS3 restoreState round-trip', () => {
  it('restores baseScore, score, wonFlag from a snapshot', () => {
    const src = makeScoring();
    src.scoreUpd(100);
    const snap = src.snapshotState();

    const dst = makeScoring();
    dst.restoreState(snap);
    expect(dst.baseScore).toBe(100);
    expect(dst.score).toBe(100);
    expect(dst.wonFlag).toBe(false);
  });

  it('restores wonFlag=true without re-firing the hook', () => {
    let hookCalls = 0;
    const hook = () => { hookCalls++; };

    const src = makeScoring(hook);
    src.scoreUpd(350);           // fires the hook once
    expect(hookCalls).toBe(1);

    const snap = src.snapshotState();

    // Restore onto a fresh instance that also has the hook.
    const dst = makeScoring(hook);
    dst.restoreState(snap);      // must NOT fire the hook again

    expect(dst.wonFlag).toBe(true);
    expect(hookCalls).toBe(1);   // still 1 — no double-whisper
  });
});

// ---------------------------------------------------------------------------
// 3. NO double-whisper: the critical NM from spec §3.5
// ---------------------------------------------------------------------------

describe('SS3 no-double-whisper (spec NM)', () => {
  it('restoring a won-game does not emit the wonFlag side-effects again', () => {
    const whispers: string[] = [];
    const hook = (tell: (s: string) => void) => {
      tell('A whisper echoes from the past...');
    };

    const src = new Scoring(new SimpleEventEmitter(), undefined, hook);
    src.scoreUpd(350);  // hook fires, whisper collected

    const snap = src.snapshotState();

    const dst = new Scoring(new SimpleEventEmitter(), undefined, (tell) => {
      tell('should not appear');
      whispers.push('double-whisper!');
    });
    dst.restoreState(snap);  // must NOT invoke the hook

    expect(whispers).toHaveLength(0);
    expect(dst.wonFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Game-level round-trip: snapshot() / restore() carries scoring correctly
// ---------------------------------------------------------------------------

describe('SS3 Game-level scoring round-trip', () => {
  it('score/baseScore/wonFlag survive a full game snapshot → restore cycle', () => {
    const g = createGame({ seed: 42 });
    g.start();

    // Award some points to get non-zero state.
    // KITCHEN has VALUE=10; start there + trigger the award via start().
    const g2 = createGame({ startRoom: 'KITCHEN', seed: 42 });
    g2.start();  // awards room VALUE=10

    const s1 = g2.snapshot();
    expect(s1.scoring.score).toBeGreaterThan(0);

    const g3 = createGame({ seed: 42 });
    g3.restore(s1);

    const s2 = g3.snapshot();
    expect(s2.scoring.baseScore).toBe(s1.scoring.baseScore);
    expect(s2.scoring.score).toBe(s1.scoring.score);
    expect(s2.scoring.wonFlag).toBe(s1.scoring.wonFlag);
  });

  it('view().score matches after restore', () => {
    const g = createGame({ startRoom: 'CELLAR', seed: 42 });
    g.start();  // CELLAR.VALUE=25

    const s1 = g.snapshot();
    const g2 = createGame({ seed: 42 });
    g2.restore(s1);

    expect(g2.view().score).toBe(g.view().score);
  });
});
