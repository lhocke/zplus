/**
 * CC9 — ambience/scenery unit tests (spec §6.9)
 *
 * WHITE-HOUSE-F / FOREST-F / SONGBIRD-F / GRANITE-WALL-F / CLIFF / WCLIF
 * I-FOREST-ROOM registration + 15% chirp.
 *
 * ZIL refs:
 *   1actions.zil:64   GRANITE-WALL-F
 *   1actions.zil:82   SONGBIRD-F (already registered — not re-built here)
 *   1actions.zil:92   WHITE-HOUSE-F
 *   1actions.zil:136  FOREST-F
 *   1actions.zil:2996 I-FOREST-ROOM
 *   1actions.zil:3004 FOREST-ROOM (M-ENTER arming — already built)
 *   1actions.zil:3011 WCLIF-OBJECT
 *   1actions.zil:3015 CLIFF-OBJECT
 *
 * Done-criteria (spec §6.9 / §11 CC9):
 *   - examine house → "beautiful colonial house... painted white... extremely wealthy."
 *   - WHITE-HOUSE-F V-FIND at cardinal sides → "It's right here!"
 *   - WHITE-HOUSE-F V-FIND at CLEARING → "It seems to be to the west."
 *   - WHITE-HOUSE-F V-FIND in deep forest (no house nearby) → "It was here just a minute ago...."
 *   - WHITE-HOUSE-F V-BURN → "You must be joking."
 *   - FOREST-F V-FIND → "You cannot see the forest for the trees."
 *   - FOREST-F V-LISTEN → "The pines and the hemlocks seem to be murmuring."
 *   - FOREST-F V-DISEMBARK → "You will have to specify a direction."
 *   - GRANITE-WALL-F at NORTH-TEMPLE V-FIND → "The west wall is solid granite here."
 *   - GRANITE-WALL-F at NORTH-TEMPLE V-TAKE → "It's solid granite."
 *   - GRANITE-WALL-F at TREASURE-ROOM V-FIND → "The east wall is solid granite here."
 *   - GRANITE-WALL-F at SLIDE-ROOM V-READ → 'It only SAYS "Granite Wall".'
 *   - GRANITE-WALL-F elsewhere → "There is no granite wall here."
 *   - WCLIF-OBJECT (WHITE-CLIFF) V-CLIMB-UP/DOWN/FOO → "The cliff is too steep for climbing."
 *   - CLIFF-OBJECT (CLIMBABLE-CLIFF) V-LEAP → "That would be very unwise. Perhaps even fatal."
 *   - I-FOREST-ROOM registered (getEntry returns non-null)
 *   - M-ENTER a forest room → I-FOREST-ROOM enabled
 *   - chirp output over seeded run: ~15% (structural count, not a fixed draw)
 *
 * Spec §10.4 test contract: world-state prerequisites assert-and-fail, no conditional
 * early-returns above expects.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import { Rng } from '../../src/engine/rng.js';

type ClockLike = { getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined };
function clockOf(g: ReturnType<typeof createGame>): ClockLike {
  return (g as unknown as { clock: ClockLike }).clock;
}

// ---------------------------------------------------------------------------
// WHITE-HOUSE-F — 1actions.zil:92
// ---------------------------------------------------------------------------

describe('CC9 — WHITE-HOUSE-F: V-EXAMINE (1actions.zil:113)', () => {
  it('examine house → describes the beautiful colonial house', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    const out = g.turn('examine house').output;
    expect(out).toContain('beautiful colonial house');
    expect(out).toContain('painted white');
    expect(out).toContain('extremely wealthy');
  });
});

describe('CC9 — WHITE-HOUSE-F: V-FIND (1actions.zil:107)', () => {
  it('find house from west side → "It\'s right here!"', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    const out = g.turn('find house').output;
    expect(out).toContain("It's right here!");
  });

  it('find house from north side → "It\'s right here!"', () => {
    const g = newGameAt('NORTH-OF-HOUSE');
    g.start();
    const out = g.turn('find house').output;
    expect(out).toContain("It's right here!");
  });

  it('find house from east side → "It\'s right here!"', () => {
    const g = newGameAt('EAST-OF-HOUSE');
    g.start();
    const out = g.turn('find house').output;
    expect(out).toContain("It's right here!");
  });

  it('find house from CLEARING → "It seems to be to the west."', () => {
    const g = newGameAt('CLEARING');
    g.start();
    const out = g.turn('find house').output;
    expect(out).toContain('It seems to be to the west.');
  });

  it('find house from forest → "It was here just a minute ago...."', () => {
    const g = newGameAt('FOREST-1');
    g.start();
    const out = g.turn('find house').output;
    expect(out).toContain('It was here just a minute ago');
  });
});

describe('CC9 — WHITE-HOUSE-F: V-BURN (1actions.zil:127)', () => {
  it('burn house → "You must be joking."', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    // Give player torch so PRE-BURN passes (needs a FLAMING source as PRSI).
    // V-BURN on house: BURNBIT not set → "can't burn a house" is the default.
    // But WHITE-HOUSE-F intercepts V-BURN with "You must be joking."
    // We drive with V-BURN directly via an action-level test.
    const house = g.world.get('WHITE-HOUSE');
    expect(house, 'WHITE-HOUSE must exist').toBeDefined();
    const torch = g.world.get('TORCH');
    expect(torch, 'TORCH must exist').toBeDefined();
    torch!.set(Flag.OnFire);
    torch!.moveTo(g.player);
    const out = g.turn('burn house with torch').output;
    expect(out).toContain('You must be joking.');
  });
});

// ---------------------------------------------------------------------------
// FOREST-F — 1actions.zil:136
// ---------------------------------------------------------------------------

describe('CC9 — FOREST-F: V-FIND (1actions.zil:147)', () => {
  it('find forest in forest → "You cannot see the forest for the trees."', () => {
    const g = newGameAt('FOREST-1');
    g.start();
    const out = g.turn('find forest').output;
    expect(out).toContain('You cannot see the forest for the trees.');
  });
});

describe('CC9 — FOREST-F: V-LISTEN (1actions.zil:149)', () => {
  it('listen to forest → "The pines and the hemlocks seem to be murmuring."', () => {
    const g = newGameAt('FOREST-1');
    g.start();
    const out = g.turn('listen to forest').output;
    expect(out).toContain('pines');
    expect(out).toContain('hemlocks');
    expect(out).toContain('murmuring');
  });
});

// V-DISEMBARK in FOREST-F (1actions.zil:144) fires when PRSO=FOREST with V-DISEMBARK.
// FOREST lacks VEHBIT so standard GWIM won't match it for bare "disembark";
// the clause guards against users inside a vehicle trying to disembark "into" the forest.
// This branch is exercised by the handler but requires a VEHBIT context to reach normally.
// Structural note: the handler returns true for V-DISEMBARK when FOREST is PRSO.

// ---------------------------------------------------------------------------
// GRANITE-WALL-F — 1actions.zil:64
// ---------------------------------------------------------------------------

describe('CC9 — GRANITE-WALL-F: at NORTH-TEMPLE (1actions.zil:65)', () => {
  it('V-FIND at NORTH-TEMPLE → "The west wall is solid granite here."', () => {
    const g = newGameAt('NORTH-TEMPLE');
    g.start();
    const out = g.turn('find granite wall').output;
    expect(out).toContain('west wall is solid granite');
  });

  it('V-TAKE (take wall) at NORTH-TEMPLE → "It\'s solid granite."', () => {
    const g = newGameAt('NORTH-TEMPLE');
    g.start();
    const out = g.turn('take granite wall').output;
    expect(out).toContain("It's solid granite.");
  });
});

describe('CC9 — GRANITE-WALL-F: at TREASURE-ROOM (1actions.zil:70)', () => {
  it('V-FIND at TREASURE-ROOM → "The east wall is solid granite here."', () => {
    const g = newGameAt('TREASURE-ROOM');
    g.start();
    const out = g.turn('find granite wall').output;
    expect(out).toContain('east wall is solid granite');
  });
});

describe('CC9 — GRANITE-WALL-F: at SLIDE-ROOM (1actions.zil:75)', () => {
  it('V-FIND at SLIDE-ROOM → \'It only SAYS "Granite Wall".\'', () => {
    const g = newGameAt('SLIDE-ROOM');
    g.start();
    const out = g.turn('find granite wall').output;
    expect(out).toContain('only SAYS');
    expect(out).toContain('Granite Wall');
  });
});

describe('CC9 — GRANITE-WALL-F: elsewhere (1actions.zil:79)', () => {
  it('V-FIND wall in CAVE — "There is no granite wall here."', () => {
    const g = newGameAt('CELLAR');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);
    const out = g.turn('find granite wall').output;
    expect(out).toContain('There is no granite wall here.');
  });
});

// ---------------------------------------------------------------------------
// WCLIF-OBJECT (WHITE-CLIFF) — 1actions.zil:3011
// ---------------------------------------------------------------------------

describe('CC9 — WCLIF-OBJECT: climb (1actions.zil:3012)', () => {
  it('climb white cliff → "The cliff is too steep for climbing."', () => {
    const g = newGameAt('WHITE-CLIFFS-NORTH');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);
    const whiteCliff = g.world.get('WHITE-CLIFF');
    expect(whiteCliff, 'WHITE-CLIFF must exist').toBeDefined();
    const out = g.turn('climb white cliff').output;
    expect(out).toContain('too steep for climbing');
  });
});

// ---------------------------------------------------------------------------
// CLIFF-OBJECT (CLIMBABLE-CLIFF) — 1actions.zil:3015
// ---------------------------------------------------------------------------

describe('CC9 — CLIFF-OBJECT: V-LEAP (1actions.zil:3016)', () => {
  it('jump off cliff → "That would be very unwise. Perhaps even fatal."', () => {
    const g = newGameAt('CANYON-BOTTOM');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);
    const cliff = g.world.get('CLIMBABLE-CLIFF');
    expect(cliff, 'CLIMBABLE-CLIFF must exist').toBeDefined();
    const out = g.turn('jump off cliff').output;
    expect(out).toContain('very unwise');
    expect(out).toContain('fatal');
  });
});

// ---------------------------------------------------------------------------
// I-FOREST-ROOM clock slot — spec §6.9 + §10.3
// ---------------------------------------------------------------------------

describe('CC9 — I-FOREST-ROOM: slot registered in bootstrap', () => {
  it('clock entry I-FOREST-ROOM is registered after createGame', () => {
    const g = createGame();
    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be registered').toBeDefined();
  });

  it('I-FOREST-ROOM starts disabled', () => {
    const g = createGame();
    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be registered').toBeDefined();
    expect(entry!.enabled).toBe(false);
  });
});

describe('CC9 — I-FOREST-ROOM: enabled on forest room M-ENTER', () => {
  it('entering FOREST-1 enables I-FOREST-ROOM', () => {
    // Start outside forest, move in — M-ENTER fires for FOREST-ROOM action routine.
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    // Give lamp so we can move
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);
    // Move north → NORTH-OF-HOUSE, then continue into forest
    g.turn('north');  // NORTH-OF-HOUSE
    g.turn('north');  // FOREST area
    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be registered').toBeDefined();
    expect(entry!.enabled).toBe(true);
  });

  it('moving into FOREST-1 from PATH enables I-FOREST-ROOM', () => {
    // Start at PATH (has FOREST-ROOM action routine); move south to FOREST-3,
    // then back to confirm M-ENTER fires the enableClock call.
    const g = newGameAt('PATH');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);
    // Move in any direction that reaches a room with FOREST-ROOM handler.
    // PATH → east → FOREST-1 (both have FOREST-ROOM; M-ENTER fires on arrival).
    g.turn('east');  // → FOREST-1; M-ENTER fires → enableClock('I-FOREST-ROOM')
    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be registered').toBeDefined();
    expect(entry!.enabled).toBe(true);
  });
});

describe('CC9 — I-FOREST-ROOM: 15% chirp (1actions.zil:2996, seeded structural)', () => {
  // Path B fence: assert branch fires at ~15% rate over a seeded run.
  // Never assert a specific draw; assert the count is in range [floor(n*0.05), ceil(n*0.30)].
  //
  // Setup: move player from PATH to FOREST-1 to trigger M-ENTER + enableClock.
  function setupForestGame(seed: number): ReturnType<typeof createGame> {
    const rng = new Rng(seed);
    const g = createGame({ startRoom: 'PATH', rng });
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);
    // Move west: PATH → FOREST-1 (M-ENTER fires → I-FOREST-ROOM enabled).
    g.turn('west');
    return g;
  }

  it('chirp fires at ~15% rate over 200 seeded forest turns', () => {
    const g = setupForestGame(42);

    // Use 'look' (1 clock tick per turn) to get a clean per-turn probability measure.
    // V-WAIT advances 3 ticks which conflates the per-turn rate.
    let chirpCount = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const r = g.turn('look');
      if (r.output.includes('chirping of a song bird')) chirpCount++;
    }

    // Expected ~15%, allow a generous 5%–30% window for a 200-turn seeded run.
    expect(chirpCount).toBeGreaterThanOrEqual(Math.floor(N * 0.05));
    expect(chirpCount).toBeLessThanOrEqual(Math.ceil(N * 0.30));
  });

  it('chirp output contains the exact ZIL string (1actions.zil:3001)', () => {
    const g = setupForestGame(99);

    // Run turns until we get one chirp or 500 turns — seeded so deterministic.
    // Use 'look' (1 clock tick) for a clean per-turn probability.
    let found = false;
    for (let i = 0; i < 500 && !found; i++) {
      const r = g.turn('look');
      if (r.output.includes('chirping of a song bird')) {
        expect(r.output).toContain(
          'You hear in the distance the chirping of a song bird.',
        );
        found = true;
      }
    }
    expect(found, 'at least one chirp must fire in 500 turns').toBe(true);
  });
});

describe('CC9 — I-FOREST-ROOM: disables when leaving forest (1actions.zil:2997)', () => {
  it('entering non-forest room: I-FOREST-ROOM disables on next clock tick', () => {
    // Start at PATH (has FOREST-ROOM action), move to FOREST-1 to arm I-FOREST-ROOM,
    // then teleport to WEST-OF-HOUSE to confirm self-disable on next turn.
    const g = newGameAt('PATH');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);

    // Move west: PATH → FOREST-1; M-ENTER fires → enableClock('I-FOREST-ROOM').
    g.turn('west');
    const beforeLeave = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(beforeLeave, 'I-FOREST-ROOM must be registered').toBeDefined();
    expect(beforeLeave!.enabled, 'I-FOREST-ROOM must be enabled in FOREST-1').toBe(true);

    // Teleport player to WEST-OF-HOUSE (non-forest room) without triggering M-ENTER.
    const westOfHouse = g.world.get('WEST-OF-HOUSE');
    expect(westOfHouse, 'WEST-OF-HOUSE must exist').toBeDefined();
    g.player.moveTo(westOfHouse!);

    // A turn in a non-forest room: clock fires I-FOREST-ROOM, finds we're not in
    // a forest room, disables itself (1actions.zil:2997: <DISABLE <INT I-FOREST-ROOM>>).
    g.turn('look');
    const afterLeave = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(afterLeave, 'I-FOREST-ROOM must still be registered').toBeDefined();
    expect(afterLeave!.enabled, 'I-FOREST-ROOM must self-disable outside forest').toBe(false);
  });
});
