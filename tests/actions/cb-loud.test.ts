/**
 * CB-LOUD — LOUD-ROOM-FCN + loud-room input mode
 *
 * Done-criteria (spec §9 Wave 1 CB-LOUD):
 *   - M-LOOK: base text + quiet or loud suffix keyed on state
 *   - M-END: loud + gates-open + !low-tide → panic scramble to LOUD-RUNS dest
 *   - Loud-room input mode: all non-whitelist input → "echo echo ..." (NM-D)
 *   - Whitelist: W/E/U exits and SAVE/RESTORE/QUIT pass through; ECHO solves
 *   - ECHO sets LOUD-FLAG + clears BAR.SACREDBIT (bar takeable after)
 *   - Mode exits when player leaves LOUD-ROOM
 *   - pickOne(LOUD-RUNS) panic destination ∈ {DAMP-CAVE, ROUND-ROOM, DEEP-CANYON}
 *
 * ZIL refs:
 *   LOUD-ROOM-FCN  1actions.zil:1660–1728
 *   LOUD-RUNS      1actions.zil:1261
 *   V-ECHO         gverbs.zil:526–548
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

function setFlags(g: Game, gatesOpen: boolean, lowTide: boolean) {
  flags(g).set('GATES-OPEN', gatesOpen);
  flags(g).set('LOW-TIDE', lowTide);
}

function giveLight(g: Game) {
  const lamp = g.world.get('LAMP')!;
  lamp.moveTo(g.player);
  lamp.set(Flag.OnFire);
}

const LOUD_RUNS = new Set(['DAMP-CAVE', 'ROUND-ROOM', 'DEEP-CANYON']);

// ---------------------------------------------------------------------------
// M-LOOK — 1actions.zil:1661–1673
//
// In loud mode, `look` is intercepted by the whitelist gate (echoes).
// Test M-LOOK via start() (initial room description on world start)
// and via quiet state where look is not intercepted.
// ---------------------------------------------------------------------------

describe('CB-LOUD — LOUD-ROOM-FCN M-LOOK: loud suffix (default state S0)', () => {
  // start() calls describeCurrentRoom() directly — fires M-LOOK without going
  // through the loudRoomDispatch whitelist gate.
  it('contains the base room description (via start)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.start();
    expect(out).toContain('large room with a ceiling');
    expect(out).toContain('narrow passage from east to west');
    expect(out).toContain('stairway leading upward');
  });

  it('S0 (gates closed, not low tide): room is deafeningly loud (via start)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.start();
    expect(out).toContain('deafeningly loud');
  });

  it('S2 (gates open, not low tide): room is deafeningly loud (via start)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, true, false);
    const out = g.start();
    expect(out).toContain('deafeningly loud');
  });
});

describe('CB-LOUD — LOUD-ROOM-FCN M-LOOK: quiet suffix', () => {
  it('LOUD-FLAG set: room is eerie in its quietness (via look)', () => {
    // Quiet state — loudRoomDispatch does not intercept, look fires M-LOOK normally.
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    flags(g).set('LOUD-FLAG', true);
    const out = g.turn('look').output;
    expect(out).toContain('eerie in its quietness');
    expect(out).not.toContain('deafeningly loud');
  });

  it('gates closed + low tide (S4): room is quiet (via look)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, true);
    const out = g.turn('look').output;
    expect(out).toContain('eerie in its quietness');
    expect(out).not.toContain('deafeningly loud');
  });
});

// ---------------------------------------------------------------------------
// M-END — 1actions.zil:1674–1680: loud panic scramble
// ---------------------------------------------------------------------------

describe('CB-LOUD — LOUD-ROOM-FCN M-END: panic scramble to LOUD-RUNS set', () => {
  it('when loud (gates open, !low-tide): scrambles player out of LOUD-ROOM', () => {
    // M-END fires after each turn; player ends up NOT in LOUD-ROOM
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, true, false);  // S2: gates open, not drained — loud
    // A wait will trigger M-END
    g.turn('wait');
    expect(g.world.get('PLAYER')!.parent?.id).not.toBe('LOUD-ROOM');
  });

  it('when loud: destination is one of LOUD-RUNS', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, true, false);
    g.turn('wait');
    const dest = g.world.get('PLAYER')!.parent?.id ?? '';
    expect(LOUD_RUNS.has(dest)).toBe(true);
  });

  it('when gates closed (M-END condition false): no panic scramble, player stays put', () => {
    // M-END condition: GATES-OPEN && !LOW-TIDE. With gates closed, no scramble.
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);  // gates closed → M-END does not fire scramble
    g.turn('wait');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });

  it('when quiet (gates closed + low tide): no panic scramble', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, true);
    g.turn('wait');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });
});

// ---------------------------------------------------------------------------
// Loud-room input mode (NM-D) — ratified OQ-1 seam
// ---------------------------------------------------------------------------

describe('CB-LOUD — loud-room input mode: whitelist gate (NM-D)', () => {
  it('non-whitelist input returns "echo echo" response', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);  // S0: loud (default state)
    const out = g.turn('take bar').output;
    expect(out).toContain('echo');
  });

  it('W exit passes through (moves west to ROUND-ROOM)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('west');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('ROUND-ROOM');
  });

  it('E exit passes through (moves east to DAMP-CAVE)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('east');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('DAMP-CAVE');
  });

  it('U exit passes through (moves up to DEEP-CANYON)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('up');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('DEEP-CANYON');
  });

  it('ECHO in loud mode sets LOUD-FLAG', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('echo');
    expect(flags(g).get('LOUD-FLAG')).toBe(true);
  });

  it('ECHO in loud mode prints "acoustics of the room change subtly"', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('echo').output;
    expect(out).toContain('acoustics of the room change subtly');
  });

  it('ECHO clears BAR.SACREDBIT (bar becomes takeable)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const bar = g.world.get('BAR')!;
    expect(bar.has(Flag.Sacred)).toBe(true);  // starts sacred
    g.turn('echo');
    expect(bar.has(Flag.Sacred)).toBe(false); // cleared by ECHO
  });

  it('after ECHO (LOUD-FLAG set), normal verbs work', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('echo');
    // Now quiet — take bar should succeed (no echo gate)
    const out = g.turn('take bar').output;
    expect(out).not.toContain('echo');
  });

  it('bar untakeable while loud (SACREDBIT blocks take)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const bar = g.world.get('BAR')!;
    expect(bar.has(Flag.Sacred)).toBe(true);
    // In loud mode, take bar echoes; bar stays in room
    g.turn('take bar');
    expect(bar.parent?.id).toBe('LOUD-ROOM');
  });

  it('mode exits when player leaves: non-whitelist input works after leaving', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('west');  // exit to ROUND-ROOM
    // Now in ROUND-ROOM (not loud mode); examine should work normally
    const out = g.turn('look').output;
    expect(out).not.toContain('echo');
  });
});

// ---------------------------------------------------------------------------
// ECHO action in quiet mode — falls through to V-ECHO (gverbs.zil:526)
// ---------------------------------------------------------------------------

describe('CB-LOUD — ECHO in quiet room: V-ECHO fallback', () => {
  it('ECHO outside LOUD-ROOM: "echo echo ..." (V-ECHO fallback)', () => {
    const g = newGameAt('LIVING-ROOM');
    giveLight(g);
    const out = g.turn('echo').output;
    expect(out).toContain('echo');
  });
});
