/**
 * BD2 — grue on blocked move in dark room.
 *
 * ZIL V-WALK (gverbs.zil:1560–1580): when there is NO exit in the attempted
 * direction, the no-exit fallthrough is NOT simply "You can't go that way."
 * First V-WALK checks: NOT LIT, PROB 80, EQUAL? WINNER ADVENTURER,
 * NOT FSET? HERE NONLANDBIT → JIGS-UP "Oh, no! You have walked into the
 * slavering fangs of a lurking grue!"
 *
 * This is the SEEDED / Path-B fence per spec §7 BD2 + §10 rule:
 *   - Assert the grue BRANCH fires (jigsUp was called, result is fatal).
 *   - NEVER golden-diff the death draw.
 *   - NEVER add a golden line for the grue text.
 *
 * gverbs.zil:2095 (GOTO grue) is a *separate* grue path (dark→dark MOVE).
 * This test covers the V-WALK no-exit grue at gverbs.zil:1562–1580.
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Fixture: a dark land room with no exits (no light source, no NONLANDBIT).
// ---------------------------------------------------------------------------

interface DarkFixture {
  world: World;
  darkRoom: Room;
  player: Actor;
}

function makeDarkFixture(): DarkFixture {
  // Dark land room — no ONBIT, no NONLANDBIT, no exits.
  const darkRoom = new Room('DARK-ROOM', 'Dark Room', { ldesc: 'Utter darkness.' });
  // Not lit (no Flag.On, no light sources).
  // Land room (no Flag.NonLand) — grue gate fires on land rooms only.

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(darkRoom);

  const world = World.fromObjects([darkRoom, player]);
  return { world, darkRoom, player };
}

// Build a VerbContext that wires jigsUp and prob.
function makeCtx(
  fix: DarkFixture,
  probResult: boolean,
  jigsUpSpy: (msg: string) => void,
): VerbContext {
  return {
    verb: 'walk',
    prep: 'north',   // no north exit defined in DARK-ROOM
    player: fix.player,
    here: fix.darkRoom,
    world: fix.world,
    prob: (_pct) => probResult,
    jigsUp: jigsUpSpy,
  };
}

// ---------------------------------------------------------------------------
// Path-B (prob fires): grue branch.
// ---------------------------------------------------------------------------

describe('BD2 — V-WALK no-exit in dark: grue branch (Path-B fence)', () => {
  it('when prob fires: jigsUp is called (grue branch routes to jigsUp)', async () => {
    const fix = makeDarkFixture();
    let jigsUpCalled = false;
    const ctx = makeCtx(fix, /*probResult*/true, (msg) => {
      jigsUpCalled = true;
      expect(msg).toMatch(/grue/i);
    });
    await executeVerb(ctx, 'walk');
    expect(jigsUpCalled).toBe(true);
  });

  it('when prob fires: result is fatal (grue kill = RFATAL)', async () => {
    const fix = makeDarkFixture();
    const ctx = makeCtx(fix, /*probResult*/true, () => {});
    const r = await executeVerb(ctx, 'walk');
    expect(r.fatal).toBe(true);
  });

  it('when prob fires: output does NOT contain the canned "can\'t go" string', async () => {
    const fix = makeDarkFixture();
    const ctx = makeCtx(fix, /*probResult*/true, () => {});
    const r = await executeVerb(ctx, 'walk');
    expect(r.output).not.toMatch(/You can't go that way/i);
  });

  // Path-A: prob does NOT fire → canned message (regression guard).
  it('when prob does not fire (safe roll): falls through to "can\'t go" message', async () => {
    const fix = makeDarkFixture();
    let jigsUpCalled = false;
    const ctx = makeCtx(fix, /*probResult*/false, () => { jigsUpCalled = true; });
    const r = await executeVerb(ctx, 'walk');
    expect(jigsUpCalled).toBe(false);
    expect(r.output).toContain("You can't go that way");
  });
});

// ---------------------------------------------------------------------------
// NONLANDBIT gate: grue must NOT fire in non-land rooms (water rooms).
// ---------------------------------------------------------------------------

describe('BD2 — grue gate: NONLANDBIT exemption', () => {
  it('NonLand room: no grue even when dark + prob fires', async () => {
    const darkWater = new Room('DARK-WATER', 'Dark Water', { ldesc: 'Dark water.' });
    darkWater.set(Flag.NonLand);   // water room — grue excluded
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(darkWater);
    const world = World.fromObjects([darkWater, player]);

    let jigsUpCalled = false;
    const ctx: VerbContext = {
      verb: 'walk',
      prep: 'north',
      player,
      here: darkWater,
      world,
      prob: () => true,
      jigsUp: () => { jigsUpCalled = true; },
    };
    await executeVerb(ctx, 'walk');
    expect(jigsUpCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lit room: grue must NOT fire when the room is lit.
// ---------------------------------------------------------------------------

describe('BD2 — grue gate: lit room exemption', () => {
  it('lit room: no grue even when prob fires', async () => {
    const litRoom = new Room('LIT-ROOM', 'Lit Room', { ldesc: 'Bright here.' });
    litRoom.set(Flag.On);   // always lit
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(litRoom);
    const world = World.fromObjects([litRoom, player]);

    let jigsUpCalled = false;
    const ctx: VerbContext = {
      verb: 'walk',
      prep: 'north',
      player,
      here: litRoom,
      world,
      prob: () => true,
      jigsUp: () => { jigsUpCalled = true; },
    };
    await executeVerb(ctx, 'walk');
    expect(jigsUpCalled).toBe(false);
  });
});
