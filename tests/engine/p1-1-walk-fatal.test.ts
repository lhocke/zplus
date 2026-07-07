/**
 * P1-1 — V-WALK fatal channel
 *
 * Per the ZIL spec (gverbs.zil V-WALK, td4-verb-defaults.md §4 "V-WALK"):
 *   - NEXIT / CEXIT (blocked by flag) / DEXIT (object gate closed) /
 *     no-exit-in-direction all return RFATAL.
 *   - Per-routine resolver returning undefined (movement blocked) → RFATAL.
 *   - Successful moves (lit destination, dark destination, grue kill) are NOT
 *     RFATAL in the blocked sense (grue kill is fatal via jigsUp, dark-move
 *     continuation is cleared via clearContinuation).
 *
 * RFATAL / M-FATAL means VerbResult.fatal === true, which causes game.ts to:
 *   1. Skip M-END.
 *   2. Abort any remaining chained commands (clearContinuation).
 *
 * References: enable-first-mechanics-audit.md §P1-1, td4-perform-chain.md §2,
 * td4-verb-defaults.md §4 (V-WALK exit-type dispatch), verbs/index.ts verbGo.
 *
 * TDD: tests written RED first; implementation lands second.
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Actor } from '../../src/domain/actor';
import { Thing } from '../../src/domain/thing';
import { Flag } from '../../src/domain/flags';
import type { Exit } from '../../src/domain/game-object';
import { newGameAt } from '../helpers/new-game';

// ---------------------------------------------------------------------------
// Fixture: minimal world with several exit types.
//
// Layout:
//   ROOM-A — always-lit room
//     exits:
//       north → ROOM-B (UEXIT: plain reachable destination)
//       south → (NEXIT: blocked, has elseMessage, no destination)
//       east  → (CEXIT: conditional on global flag MAGIC-FLAG)
//       west  → (DEXIT: blocked by object-flag gate; GATE-OBJ must be Open)
//       up    → [no exit defined] (missing exit direction)
//       down  → ROOM-B via per-routine
//
//   ROOM-B — always-lit room (the reachable destination)
//
//   GATE-OBJ — a game object used as the DEXIT gate (starts closed)
// ---------------------------------------------------------------------------

interface WalkFixture {
  world: World;
  roomA: Room;
  roomB: Room;
  gateObj: Thing;
  player: Actor;
}

function makeWalkFixture(): WalkFixture {
  const roomB = new Room('ROOM-B', 'Room B', { ldesc: 'Room B.' });
  roomB.set(Flag.On);

  const gateObj = new Thing('GATE-OBJ', 'heavy gate', { synonyms: ['gate'] });
  // GATE-OBJ starts CLOSED (no Flag.Open) — models a DEXIT blocked exit.

  const exits: Exit[] = [
    // UEXIT: plain destination — should succeed, fatal=false.
    { dir: 'north', to: 'ROOM-B' },
    // NEXIT: no destination, elseMessage — should return fatal=true.
    { dir: 'south', elseMessage: 'The way is blocked by a rusty portcullis.' },
    // CEXIT: conditional on global flag; starts false — should return fatal=true.
    { dir: 'east', ifFlag: 'MAGIC-FLAG', to: 'ROOM-B', elseMessage: 'A magic barrier blocks the way.' },
    // DEXIT: conditional on object OPENBIT; gate starts closed — should return fatal=true.
    { dir: 'west', ifFlag: 'GATE-OBJ', to: 'ROOM-B', elseMessage: 'The gate is shut.' },
    // PER-routine exit — we will test with and without a resolver.
    { dir: 'down', per: 'SOME-ROUTINE', to: 'ROOM-B' },
  ];

  const roomA = new Room('ROOM-A', 'Room A', { ldesc: 'Room A.', exits });
  roomA.set(Flag.On);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(roomA);

  const world = World.fromObjects([roomA, roomB, gateObj, player]);

  return { world, roomA, roomB, gateObj, player };
}

function ctx(fix: WalkFixture, opts: {
  prep?: string;
  here?: Room;
  perResolver?: (name: string, here: Room) => string | undefined;
  getGlobal?: (name: string) => boolean;
}): VerbContext {
  return {
    verb: 'walk',
    prep: opts.prep,
    player: fix.player,
    here: opts.here ?? fix.roomA,
    world: fix.world,
    perResolver: opts.perResolver,
    getGlobal: opts.getGlobal,
  };
}

// ---------------------------------------------------------------------------
// A. Unit tests — VerbResult.fatal on each blocked path
// ---------------------------------------------------------------------------

describe('P1-1 V-WALK fatal channel — blocked paths return fatal=true', () => {

  it('NEXIT (elseMessage, no destination): fatal=true, moved=false', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, { prep: 'south' }), 'walk');
    expect(r.fatal).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('NEXIT still prints the elseMessage', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, { prep: 'south' }), 'walk');
    expect(r.output).toContain('portcullis');
  });

  it('CEXIT (flag gate closed): fatal=true, moved=false', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, {
      prep: 'east',
      getGlobal: (name) => name === 'MAGIC-FLAG' ? false : false,
    }), 'walk');
    expect(r.fatal).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('CEXIT still prints the elseMessage when flag is false', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, {
      prep: 'east',
      getGlobal: () => false,
    }), 'walk');
    expect(r.output).toContain('magic barrier');
  });

  it('DEXIT (object gate closed): fatal=true, moved=false', async () => {
    const fix = makeWalkFixture();
    // gateObj starts closed (no Flag.Open).
    const r = await executeVerb(ctx(fix, { prep: 'west' }), 'walk');
    expect(r.fatal).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('DEXIT still prints the elseMessage when gate is closed', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, { prep: 'west' }), 'walk');
    expect(r.output).toContain('gate is shut');
  });

  it('no exit in direction: fatal=true, moved=false', async () => {
    const fix = makeWalkFixture();
    // 'up' has no exit defined in ROOM-A.
    const r = await executeVerb(ctx(fix, { prep: 'up' }), 'walk');
    expect(r.fatal).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('per-routine resolver returning undefined (blocked): fatal=true', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, {
      prep: 'down',
      perResolver: (_name, _here) => undefined, // resolver says blocked
    }), 'walk');
    expect(r.fatal).toBe(true);
    expect(r.moved).toBe(false);
  });

  it('per-routine resolver returning a destination: fatal=false, moved=true', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, {
      prep: 'down',
      perResolver: (_name, _here) => 'ROOM-B',
    }), 'walk');
    expect(r.fatal ?? false).toBe(false);
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('ROOM-B');
  });
});

// ---------------------------------------------------------------------------
// B. Successful moves: fatal=false (regression guard)
// ---------------------------------------------------------------------------

describe('P1-1 V-WALK fatal channel — successful moves are NOT fatal', () => {

  it('UEXIT (plain destination, lit): fatal is not true', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, { prep: 'north' }), 'walk');
    expect(r.fatal ?? false).toBe(false);
    expect(r.moved).toBe(true);
  });

  it('CEXIT with flag open: fatal is not true, move succeeds', async () => {
    const fix = makeWalkFixture();
    const r = await executeVerb(ctx(fix, {
      prep: 'east',
      getGlobal: (name) => name === 'MAGIC-FLAG' ? true : false,
    }), 'walk');
    expect(r.fatal ?? false).toBe(false);
    expect(r.moved).toBe(true);
  });

  it('DEXIT with gate open: fatal is not true, move succeeds', async () => {
    const fix = makeWalkFixture();
    fix.gateObj.set(Flag.Open); // open the gate
    const r = await executeVerb(ctx(fix, { prep: 'west' }), 'walk');
    expect(r.fatal ?? false).toBe(false);
    expect(r.moved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Integration tests — chained commands abort when walk is blocked
// ---------------------------------------------------------------------------

describe('P1-1 V-WALK fatal channel — integration: chained commands abort on blocked walk', () => {
  /**
   * In the real game, a chained input like "go east. take lamp" should abort
   * after "go east" fails (M-FATAL clears the continuation queue).
   * We verify this by starting in a room with a blocked exit and issuing a
   * chained command: the second command must NOT execute.
   */

  it('blocked walk aborts the remainder of a chained command', async () => {
    // Use the real bootstrapped game. WEST-OF-HOUSE has no "east" exit.
    // Chain: "go east. north" — "east" is blocked, "north" must not run.
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    // Record player room before the command.
    // After "go east" fails fatally, the chained "north" should NOT execute.
    // If "north" ran, the player would be in NORTH-OF-HOUSE.
    const result = await g.turn('go east. north');
    // The player must still be at WEST-OF-HOUSE (chain aborted).
    // We verify by issuing a "look" and checking the room name.
    const lookOut = await g.turn('look');
    expect(lookOut.output).toContain('West of House');
    // Also verify the blocked-walk message appeared in the result.
    // (The east exit from WEST-OF-HOUSE has a verbatim elseMessage.)
    expect(result.output.length).toBeGreaterThan(0);
    // The "North of House" description must NOT appear (north never ran).
    expect(result.output).not.toContain('North of House');
  });

  it('successful walk does NOT abort chained commands', async () => {
    // "go north. look" from WEST-OF-HOUSE — north succeeds → look should run.
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    // "north" moves player; the chained "look" should fire.
    // We verify the output contains the North of House room description.
    const result = await g.turn('north. look');
    expect(result.output).toContain('North of House');
  });
});
