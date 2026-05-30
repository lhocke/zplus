/**
 * B2 — runMEnd + M-END wire in turn loop
 *
 * Verifies that:
 *   1. M-END fires on EVERY non-fatal turn (unconditional post-turn room callback)
 *      via a probe room handler that records calls (rarg === M_END).
 *   2. M-END is SKIPPED when the chain returned M-FATAL (ctx.fatal() was called).
 *   3. M-END receives the just-executed verb/dobj/iobj (stashed as lastVerb etc.)
 *      so that handlers like LIVING-ROOM-FCN can read them.
 *   4. M-FATAL also breaks out of the chained-command loop (P-CONT cleared).
 *   5. M-END fires on the CURRENT room (post-GOTO) — after any movement.
 *
 * Per td4-perform-chain.md §2 and reconciliation-parser-perform.md §4 Wave B2.
 *
 * TDD: written BEFORE the implementation (RED → GREEN → commit).
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../src/engine/game';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import { Clock } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import { M_END, M_BEG } from '../../src/engine/messages';
import type { ActionContext } from '../../src/domain/game-object';
import type { Rng } from '../../src/engine/game';

const rng: Rng = { next: () => 0 };

// ---------------------------------------------------------------------------
// Probe room builder
// ---------------------------------------------------------------------------

/**
 * Builds a minimal lit room with a probe handler that records calls.
 *
 * The handler:
 *   - On M_BEG with fatalVerb: signals M-FATAL via ctx.fatal() then returns true.
 *   - On M_END: pushes an entry onto `log` with the context's verb/dobj/iobj.
 *
 * `fatalVerb` is the verb string that triggers M-FATAL at step 2 (room M-BEG).
 * Using step 2 (room handler) for the fatal signal is the easiest hook that
 * doesn't require extracting a real verb.
 */
interface ProbeWorld {
  game: Game;
  /** Calls received at rarg === M_END: { verb, dobjId, iobjId } */
  mEndCalls: Array<{ verb: string; dobjId: string | undefined; iobjId: string | undefined }>;
  /** The probe room */
  room: Room;
  /** A takeable item in the room for dobj tests */
  item: Thing;
}

function buildProbeWorld(opts: { fatalVerb?: string } = {}): ProbeWorld {
  const mEndCalls: Array<{ verb: string; dobjId: string | undefined; iobjId: string | undefined }> = [];

  const room = new Room('PROBE-ROOM', 'Probe Room', { ldesc: 'A minimal probe room.' });
  room.set(Flag.Light);

  room.handler = (ctx: ActionContext): boolean => {
    if (ctx.rarg === M_BEG && opts.fatalVerb !== undefined && ctx.verb === opts.fatalVerb) {
      // Signal M-FATAL so the dispatcher sets ChainResult.fatal = true.
      ctx.fatal();
      ctx.tell(`Fatal: ${ctx.verb}`);
      return true;  // short-circuit the chain (ZIL RTRUE after RFATAL)
    }
    if (ctx.rarg === M_END) {
      mEndCalls.push({
        verb: ctx.verb,
        dobjId: ctx.dobj?.id,
        iobjId: ctx.iobj?.id,
      });
      // M-END handlers return false (RFALSE) in normal play (e.g. LIVING-ROOM-FCN)
      return false;
    }
    return false;
  };

  const item = new Thing('PROBE-ITEM', 'probe item', {
    synonyms: ['item'],
    adjectives: ['probe'],
  });
  item.set(Flag.Takeable);
  item.moveTo(room);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, item, player]);
  const game = new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });

  return { game, mEndCalls, room, item };
}

// ---------------------------------------------------------------------------
// Test: M-END fires on a normal (non-fatal) turn
// ---------------------------------------------------------------------------

describe('B2 — runMEnd: M-END fires on every non-fatal turn', () => {
  it('M-END fires after a look command (unconditional post-turn callback)', () => {
    const { game, mEndCalls } = buildProbeWorld();
    game.start();
    game.turn('look');
    // M-END should have fired exactly once.
    expect(mEndCalls.length).toBeGreaterThanOrEqual(1);
    // The most recent M-END call should carry rarg = M_END (checked by the handler recording).
    // The verb should be 'look'.
    const last = mEndCalls[mEndCalls.length - 1]!;
    expect(last.verb).toBe('look');
  });

  it('M-END fires after a take command', () => {
    const { game, mEndCalls } = buildProbeWorld();
    game.start();
    game.turn('take item');
    expect(mEndCalls.length).toBeGreaterThanOrEqual(1);
    const last = mEndCalls[mEndCalls.length - 1]!;
    expect(last.verb).toBe('take');
  });

  it('M-END fires even when no handler claimed the command (unconditional)', () => {
    // "examine item" falls through to the default verb (step 7), not short-circuited.
    // M-END must STILL fire.
    const { game, mEndCalls } = buildProbeWorld();
    game.start();
    game.turn('examine item');
    expect(mEndCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('M-END carries the just-executed dobj id when a dobj was present', () => {
    const { game, mEndCalls, item } = buildProbeWorld();
    game.start();
    game.turn('examine item');
    const last = mEndCalls[mEndCalls.length - 1]!;
    // The dobj id should be the item we acted on.
    expect(last.dobjId).toBe(item.id);
  });
});

// ---------------------------------------------------------------------------
// Test: M-END is SKIPPED on M-FATAL turns
// ---------------------------------------------------------------------------

describe('B2 — runMEnd: M-END is skipped when M-FATAL fires', () => {
  it('M-END does NOT fire when the room M-BEG handler calls ctx.fatal()', () => {
    // Install a handler that signals fatal on verb 'look'.
    const { game, mEndCalls } = buildProbeWorld({ fatalVerb: 'look' });
    game.start();

    // Reset calls accumulated during start() (start() calls describeCurrentRoom,
    // not turn(), so there should be none; but be explicit).
    mEndCalls.length = 0;

    game.turn('look');

    // M-END must NOT have fired because the chain returned M-FATAL.
    expect(mEndCalls.length).toBe(0);
  });

  it('M-FATAL aborts a chained command (P-CONT cleared — second segment skipped)', () => {
    // "look . examine item" — fatal on 'look' should abort; 'examine item' never runs.
    const { game, mEndCalls } = buildProbeWorld({ fatalVerb: 'look' });
    game.start();
    mEndCalls.length = 0;

    // "look. examine item" — 'look' fires M-FATAL; 'examine item' should be skipped.
    game.turn('look. examine item');

    // No M-END calls because both segments were aborted (P-CONT cleared).
    // The second segment (examine item) was never reached.
    // M-END was not called for either segment.
    expect(mEndCalls.length).toBe(0);
  });

  it('M-FATAL only aborts the current chained line, not the next turn call', () => {
    // After a fatal turn, the next independent turn() call should work normally.
    const { game, mEndCalls } = buildProbeWorld({ fatalVerb: 'look' });
    game.start();
    mEndCalls.length = 0;

    game.turn('look');               // fatal — no M-END
    expect(mEndCalls.length).toBe(0);

    game.turn('examine item');       // non-fatal — M-END fires
    expect(mEndCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Test: M-END fires on the CURRENT room (post-GOTO), not the starting room
// ---------------------------------------------------------------------------

describe('B2 — runMEnd: M-END fires on the destination room after movement', () => {
  it('after moving north, M-END fires on the new room (not the starting room)', () => {
    // Build a two-room world; both rooms have probe handlers so we can
    // distinguish which room's M-END was called.
    const destEndCalls: string[] = [];

    const startRoom = new Room('START', 'Start Room', { ldesc: 'The start.' });
    startRoom.set(Flag.Light);
    startRoom.set(Flag.Light);

    const destRoom = new Room('DEST', 'Dest Room', { ldesc: 'The destination.' });
    destRoom.set(Flag.Light);
    // Add north exit from start to dest.
    (startRoom as unknown as { exits: Array<{ dir: string; to: string }> }).exits = [];
    startRoom.exits.push({ dir: 'north', to: 'DEST' });

    destRoom.handler = (ctx: ActionContext): boolean => {
      if (ctx.rarg === M_END) {
        destEndCalls.push(ctx.verb);
        return false;
      }
      return false;
    };

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(startRoom);

    const world = World.fromObjects([startRoom, destRoom, player]);
    const game = new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });

    game.start();
    game.turn('north');

    // After moving north, M-END should have fired on destRoom (verb = 'walk').
    expect(destEndCalls.length).toBeGreaterThanOrEqual(1);
    expect(destEndCalls[destEndCalls.length - 1]).toBe('walk');
  });
});

// ---------------------------------------------------------------------------
// Test: stashed lastVerb/lastDobj/lastIobj used by M-END (LIVING-ROOM pattern)
// ---------------------------------------------------------------------------

describe('B2 — runMEnd: stashed verb/dobj/iobj visible in M-END ctx', () => {
  it('M-END ctx.verb matches the just-executed verb', () => {
    const { game, mEndCalls } = buildProbeWorld();
    game.start();
    mEndCalls.length = 0;

    game.turn('examine item');
    const last = mEndCalls[mEndCalls.length - 1]!;
    expect(last.verb).toBe('examine');
  });

  it('M-END ctx.dobj is the direct object of the just-executed command', () => {
    const { game, mEndCalls, item } = buildProbeWorld();
    game.start();
    mEndCalls.length = 0;

    game.turn('take item');
    const last = mEndCalls[mEndCalls.length - 1]!;
    expect(last.dobjId).toBe(item.id);
  });
});
