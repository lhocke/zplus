/**
 * I1 / TS-L — Demon iteration order in Clock.advance()
 *
 * Phase-3 spec §7.2 TS-L + §8 I1 done-criteria:
 *   Demons fire in advance() iteration order (Map insertion order).
 *   I-FIGHT precedes I-THIEF.  I-THIEF precedes I-CYCLOPS.
 *
 * Three cases asserted:
 *   (a) World start — order established at registration time.
 *   (b) After clock.restore() — only turnsLeft/enabled change; order is
 *       preserved because the Map entries are not removed or re-inserted.
 *   (c) After a runtime schedule() — newly appended entries fire last,
 *       after the already-registered demons.
 *
 * ZIL ground truth:
 *   I-FIGHT  1actions.zil:3810 — registered first (Phase-2)
 *   I-THIEF  1actions.zil:1756 — "moved to DEMONS", scheduled after I-FIGHT
 *            Phase-3 I1 mandate: I-THIEF AFTER I-FIGHT
 *
 * I-SWORD is also checked: it is scheduled in bootstrap.ts before Game
 * constructs the remaining entries, confirming it appears before I-FIGHT
 * in the iteration sequence.
 */

import { describe, it, expect } from 'vitest';
import { Clock, type ClockEntry, type ClockSnapshot } from '../../src/engine/clock.js';
import { createGame } from '../../src/engine/bootstrap.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ClockInternals = {
  clock: {
    snapshot(): ClockSnapshot[];
    restore(snaps: ClockSnapshot[]): void;
    schedule(e: ClockEntry): void;
    advance(): string[];
    enable(id: string): void;
  };
};

function getClock(g: ReturnType<typeof createGame>) {
  return (g as unknown as ClockInternals).clock;
}

// ---------------------------------------------------------------------------
// (a) World start
// ---------------------------------------------------------------------------

describe('TS-L(a): demon order at world start', () => {
  it('I-FIGHT is registered and enabled before I-THIEF', () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    const snaps = clock.snapshot();
    const ids = snaps.map(s => s.id);
    const iFightIdx  = ids.indexOf('I-FIGHT');
    const iThiefIdx  = ids.indexOf('I-THIEF');

    expect(iFightIdx).toBeGreaterThanOrEqual(0);   // I-FIGHT must be scheduled
    expect(iThiefIdx).toBeGreaterThanOrEqual(0);   // I-THIEF must be scheduled
    expect(iFightIdx).toBeLessThan(iThiefIdx);     // I-FIGHT before I-THIEF
  });

  it('I-SWORD is scheduled (phase-2 hotfix H3) and appears in advance() iteration order', () => {
    // I-SWORD is registered in bootstrap.ts before Game constructs I-FIGHT/I-THIEF,
    // so it fires earlier in advance().  Confirm it is present in the snapshot.
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    const snaps = clock.snapshot();
    const ids = snaps.map(s => s.id);
    const iSwordIdx = ids.indexOf('I-SWORD');
    const iFightIdx = ids.indexOf('I-FIGHT');

    expect(iSwordIdx).toBeGreaterThanOrEqual(0);  // I-SWORD must be present
    // I-SWORD is registered in bootstrap.ts before Game adds I-FIGHT.
    expect(iSwordIdx).toBeLessThan(iFightIdx);
  });

  it('I-THIEF is registered before I-CYCLOPS', () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    const snaps = clock.snapshot();
    const ids = snaps.map(s => s.id);
    const iThiefIdx   = ids.indexOf('I-THIEF');
    const iCyclopsIdx = ids.indexOf('I-CYCLOPS');

    expect(iThiefIdx).toBeGreaterThanOrEqual(0);
    expect(iCyclopsIdx).toBeGreaterThanOrEqual(0);
    expect(iThiefIdx).toBeLessThan(iCyclopsIdx);
  });

  it('I-THIEF demon is enabled at world start (turnsLeft=-1, enabled=true)', () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    const snap = clock.snapshot().find(s => s.id === 'I-THIEF');
    expect(snap).toBeDefined();
    expect(snap!.turnsLeft).toBe(-1);
    expect(snap!.enabled).toBe(true);
  });

  it('demons fire in snapshot order during advance()', () => {
    // Use a standalone Clock to verify the advance() iteration invariant:
    // entries fire in the order they were schedule()d (Map insertion order).
    const clock = new Clock();
    const fired: string[] = [];

    const mkEntry = (id: string): ClockEntry => ({
      id,
      turnsLeft: -1,
      enabled: true,
      tick() { fired.push(id); return true; },
    });

    clock.schedule(mkEntry('I-FIGHT'));
    clock.schedule(mkEntry('I-THIEF'));
    clock.schedule(mkEntry('I-CYCLOPS'));

    clock.advance();

    expect(fired).toEqual(['I-FIGHT', 'I-THIEF', 'I-CYCLOPS']);
  });
});

// ---------------------------------------------------------------------------
// (b) After clock.restore()
// ---------------------------------------------------------------------------

describe('TS-L(b): demon order preserved after clock.restore()', () => {
  it('snapshot order is unchanged after restore()', () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    // Capture initial order
    const before = clock.snapshot().map(s => s.id);

    // Restore with the same snapshot (simulate a save/restore cycle)
    const snaps = clock.snapshot();
    clock.restore(snaps);

    const after = clock.snapshot().map(s => s.id);
    expect(after).toEqual(before);
  });

  it('I-FIGHT still precedes I-THIEF after restore()', () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    const snaps = clock.snapshot();
    clock.restore(snaps);

    const ids = clock.snapshot().map(s => s.id);
    expect(ids.indexOf('I-FIGHT')).toBeLessThan(ids.indexOf('I-THIEF'));
  });

  it('advance() iteration order is preserved after restore()', () => {
    // Standalone clock: register A, B, C; snapshot+restore; verify fire order.
    const clock = new Clock();
    const fired: string[] = [];

    (['A', 'B', 'C'] as const).forEach(id => {
      clock.schedule({
        id,
        turnsLeft: -1,
        enabled: true,
        tick() { fired.push(id); return true; },
      });
    });

    clock.advance();
    expect(fired).toEqual(['A', 'B', 'C']);

    const snaps = clock.snapshot();
    clock.restore(snaps);

    fired.length = 0;
    clock.advance();
    expect(fired).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// (c) After runtime schedule()
// ---------------------------------------------------------------------------

describe('TS-L(c): newly scheduled demons fire after existing ones', () => {
  it('entry added mid-game via schedule() fires last in advance()', () => {
    const clock = new Clock();
    const fired: string[] = [];

    const mkEntry = (id: string): ClockEntry => ({
      id,
      turnsLeft: -1,
      enabled: true,
      tick() { fired.push(id); return true; },
    });

    clock.schedule(mkEntry('I-FIGHT'));
    clock.schedule(mkEntry('I-THIEF'));

    // Runtime addition — simulates a demon enqueued mid-game.
    clock.schedule(mkEntry('I-LATE'));

    clock.advance();

    expect(fired.indexOf('I-FIGHT')).toBeLessThan(fired.indexOf('I-THIEF'));
    expect(fired.indexOf('I-THIEF')).toBeLessThan(fired.indexOf('I-LATE'));
  });

  it('newly registered demon in game object fires after I-THIEF', () => {
    // When new world entries are added after game construction, they land
    // after the already-registered demons in the Map.
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    const clock = getClock(g);

    const fired: string[] = [];
    // Inject a sentinel demon AFTER all game entries.
    clock.schedule({
      id: 'I-SENTINEL',
      turnsLeft: -1,
      enabled: true,
      tick() { fired.push('I-SENTINEL'); return true; },
    });

    // Also intercept I-THIEF tick to record its position.
    // We use snapshot + restore to verify order without running real thief logic:
    const snaps = clock.snapshot();
    const ids = snaps.map(s => s.id);

    const iThiefIdx    = ids.indexOf('I-THIEF');
    const iSentinelIdx = ids.indexOf('I-SENTINEL');

    expect(iThiefIdx).toBeGreaterThanOrEqual(0);
    expect(iSentinelIdx).toBeGreaterThanOrEqual(0);
    expect(iThiefIdx).toBeLessThan(iSentinelIdx);
  });
});
