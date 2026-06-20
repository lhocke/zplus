/**
 * CC10 — Misc room FCNs (spec §6.10)
 *
 * Ports and registers these previously-unregistered room action routines:
 *   BATS-ROOM        1actions.zil:2478  — BAT-ROOM M-LOOK/M-ENTER bat-presence gating
 *   BOOM-ROOM        1actions.zil:2446  — GAS-ROOM M-END gas explosion on lit flame
 *   CAVE2-ROOM       1actions.zil:2416  — TINY-CAVE M-END candle blow-out (probabilistic)
 *   SOUTH-TEMPLE-FCN 1actions.zil:2573  — SOUTH-TEMPLE M-BEG COFFIN-CURE gate
 *   MACHINE-ROOM-FCN 1actions.zil:2488  — MACHINE-ROOM M-LOOK (already in coal-mine.ts)
 *   CANYON-VIEW-F    1dungeon.zil:2406  — CANYON-VIEW M-BEG LEAP death
 *
 * Test contract (spec §10.4 / L40):
 *   - World-state prerequisites: assert-and-fail (no conditional early-returns above expect).
 *   - Path-B seeded test: count-in-range over N runs; never a fixed draw.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { Rng } from '../../src/engine/rng.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function giveLit(g: ReturnType<typeof newGameAt>, objId: string): void {
  const obj = g.world.get(objId);
  expect(obj, `${objId} must exist`).toBeDefined();
  obj!.moveTo(g.player);
  obj!.set(Flag.OnFire);
  obj!.set(Flag.Light);
}

function giveLantern(g: ReturnType<typeof newGameAt>): void {
  giveLit(g, 'LAMP');
}

// ---------------------------------------------------------------------------
// BATS-ROOM — 1actions.zil:2478–2486
// ---------------------------------------------------------------------------

describe('CC10 — BATS-ROOM M-LOOK: room description (1actions.zil:2479)', () => {
  it('look in BAT-ROOM: description says "doors only to the east and south"', () => {
    const g = newGameAt('BAT-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('look').output;
    expect(out).toContain('doors only to the east and south');
  });
});

describe('CC10 — BATS-ROOM M-ENTER: garlic absent triggers bat grab (1actions.zil:2482)', () => {
  it('enter BAT-ROOM with no garlic: output contains bat grab text', () => {
    // Start one room away; walk in so M-ENTER fires.
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    // Ensure garlic is nowhere near (it starts far away).
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    // Move garlic to a remote room so it's neither on player nor in BAT-ROOM.
    const remote = g.world.get('LIVING-ROOM');
    expect(remote, 'LIVING-ROOM must exist for garlic park').toBeDefined();
    garlic!.moveTo(remote!);
    const out = g.turn('west').output;
    // FLY-ME fires: grab message must be present.
    expect(out).toContain('scruff of your neck');
  });

  // ZIL BATS-ROOM M-ENTER: <V-LOOK> <CRLF> <FLY-ME> (1actions.zil:2484–2486).
  // Room description must appear BEFORE the fweep/grab block.
  it('enter BAT-ROOM with no garlic: room description appears before bat grab (1actions.zil:2484)', () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    const remote = g.world.get('LIVING-ROOM');
    expect(remote, 'LIVING-ROOM must exist for garlic park').toBeDefined();
    garlic!.moveTo(remote!);
    const out = g.turn('west').output;
    const descIdx = out.indexOf('doors only to the east and south');
    const grabIdx = out.indexOf('scruff of your neck');
    expect(descIdx, 'room description must appear in output').toBeGreaterThanOrEqual(0);
    expect(grabIdx, 'grab message must appear in output').toBeGreaterThanOrEqual(0);
    // ZIL ordering: description before grab.
    expect(descIdx).toBeLessThan(grabIdx);
  });

  // BAT-D (1actions.zil:2469–2476): when garlic absent, bat is described as swooping.
  // V-LOOK inside M-ENTER fires DESCRIBE-OBJECTS → BAT's DESCFCN → swoop text.
  it('enter BAT-ROOM with no garlic: bat described as swooping (BAT-D, 1actions.zil:2475)', () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    const remote = g.world.get('LIVING-ROOM');
    expect(remote, 'LIVING-ROOM must exist for garlic park').toBeDefined();
    garlic!.moveTo(remote!);
    const out = g.turn('west').output;
    expect(out).toContain('swoops down at you');
  });

  // BAT-D garlic-present branch: "deranged and holding his nose" (1actions.zil:2471–2473).
  it('look in BAT-ROOM with garlic in hand: bat described as deranged (BAT-D, 1actions.zil:2471)', () => {
    const g = newGameAt('BAT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    garlic!.moveTo(g.player);
    const out = g.turn('look').output;
    expect(out).toContain('deranged');
  });

  // BAT-D garlic-absent branch visible on explicit LOOK in BAT-ROOM.
  it('look in BAT-ROOM with no garlic: bat described as swooping (BAT-D, 1actions.zil:2475)', () => {
    const g = newGameAt('BAT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    const remote = g.world.get('LIVING-ROOM');
    expect(remote, 'LIVING-ROOM must exist').toBeDefined();
    garlic!.moveTo(remote!);
    const out = g.turn('look').output;
    expect(out).toContain('swoops down at you');
  });

  it('enter BAT-ROOM with no garlic: player is teleported to a BAT-DROPS room', () => {
    const BAT_DROPS = [
      'MINE-1', 'MINE-2', 'MINE-3', 'MINE-4',
      'LADDER-TOP', 'LADDER-BOTTOM', 'SQUEEKY-ROOM', 'MINE-ENTRANCE',
    ];
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    const remote = g.world.get('LIVING-ROOM');
    expect(remote, 'LIVING-ROOM must exist for garlic park').toBeDefined();
    garlic!.moveTo(remote!);
    g.turn('west');
    expect(BAT_DROPS).toContain(g.player.parent?.id);
  });

  it('enter BAT-ROOM with garlic in inventory: no teleport', () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    garlic!.moveTo(g.player);
    g.turn('west');
    // Player stayed in BAT-ROOM (or SHAFT-ROOM if move blocked — actually west should work)
    expect(g.player.parent?.id).toBe('BAT-ROOM');
  });

  it('enter BAT-ROOM with garlic in room: no teleport', () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist').toBeDefined();
    const batRoom = g.world.get('BAT-ROOM');
    expect(batRoom, 'BAT-ROOM must exist').toBeDefined();
    garlic!.moveTo(batRoom!);
    g.turn('west');
    expect(g.player.parent?.id).toBe('BAT-ROOM');
  });
});

// ---------------------------------------------------------------------------
// BOOM-ROOM — 1actions.zil:2446–2467
// GAS-ROOM M-END: carrying any lit flame object → explosion + jigsUp
// ---------------------------------------------------------------------------

describe('CC10 — BOOM-ROOM: carried lit candle → explosion (1actions.zil:2452)', () => {
  function gameAtGasRoom() {
    const g = newGameAt('GAS-ROOM');
    g.start();
    giveLantern(g);
    return g;
  }

  it('end of turn in GAS-ROOM with lit candles: explosion message fires', () => {
    const g = gameAtGasRoom();
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);
    // Any action to advance the turn (M-END fires).
    const out = g.turn('look').output;
    expect(out).toContain('coal gas');
  });

  it('end of turn in GAS-ROOM with lit candles: game ends (jigsUp)', () => {
    const g = gameAtGasRoom();
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);
    // Any action that doesn't kill the player first; M-END fires at turn end.
    // The action itself may output but the explosion fires in M-END.
    const out = g.turn('look').output;
    // Death path: jigsUp inserts a death message.
    expect(out).toContain('BOOOOOOOOOOOM');
  });

  it('end of turn in GAS-ROOM with lit torch: explosion fires', () => {
    const g = gameAtGasRoom();
    const torch = g.world.get('TORCH');
    expect(torch, 'TORCH must exist').toBeDefined();
    torch!.moveTo(g.player);
    torch!.set(Flag.OnFire);
    const out = g.turn('look').output;
    expect(out).toContain('BOOOOOOOOOOOM');
  });

  it('end of turn in GAS-ROOM with lit match: explosion fires', () => {
    const g = gameAtGasRoom();
    const match = g.world.get('MATCH');
    expect(match, 'MATCH must exist').toBeDefined();
    match!.moveTo(g.player);
    match!.set(Flag.OnFire);
    const out = g.turn('look').output;
    expect(out).toContain('BOOOOOOOOOOOM');
  });

  it('end of turn in GAS-ROOM with no lit flame: no explosion', () => {
    // Use a plain lantern (no candles/torch/match lit) — lantern is not a flame object.
    const g2 = newGameAt('GAS-ROOM');
    g2.start();
    giveLantern(g2);
    const out = g2.turn('look').output;
    expect(out).not.toContain('BOOOOOOOOOOOM');
  });

  it('BOOM-ROOM: "dummy" message when last action was LAMP-ON on candles (1actions.zil:2459)', () => {
    // When the player lights a candle in the gas room themselves, the message is "How sad..."
    // instead of "Oh dear..." (DUMMY? branch).
    // This is M-END on a turn where V-LAMP-ON with PRSO=CANDLES just fired.
    const g = gameAtGasRoom();
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    // Candles held but unlit — light them with a match in the gas room.
    candles!.moveTo(g.player);
    const match = g.world.get('MATCH');
    expect(match, 'MATCH must exist').toBeDefined();
    match!.moveTo(g.player);
    match!.set(Flag.OnFire);
    // "burn candles with match" → V-BURN with PRSO=CANDLES → DUMMY?=T → "How sad"
    const out = g.turn('burn candles with match').output;
    expect(out).toContain('aspiring adventurer');
  });
});

// ---------------------------------------------------------------------------
// CAVE2-ROOM — 1actions.zil:2416–2426
// TINY-CAVE M-END: candle blow-out (probabilistic, seeded structural test)
// ---------------------------------------------------------------------------

describe('CC10 — CAVE2-ROOM: candle blow-out fires over seeded run (1actions.zil:2416)', () => {
  // Path B fence: never assert a specific draw.
  // ZPROB(50) with LUCKY=T → 50% probability per turn.
  // Over 100 turns we expect ~50 blow-outs; generous window [20, 80].
  it('candle blow-out fires in 20–80% of 100 seeded turns (ZPROB 50, 1actions.zil:2419)', () => {
    const rng = new Rng(42);
    const g = createGame({ startRoom: 'TINY-CAVE', rng });
    g.start();

    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    // No lantern — candles are the only light source.
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);
    candles!.set(Flag.Light);
    // Arm candle timer so CAVE2 checks ONBIT properly.
    (g as unknown as { flags: { set: (n: string, v: boolean) => void } })
      .flags.set('CANDLES-ARMED', true);

    const N = 100;
    let blowCount = 0;
    for (let i = 0; i < N; i++) {
      // Re-light candles each turn so the test measures per-turn probability.
      if (!candles!.has(Flag.OnFire)) {
        candles!.set(Flag.OnFire);
        candles!.set(Flag.Light);
      }
      const out = g.turn('look').output;
      if (out.includes('gust of wind blows out your candles')) blowCount++;
    }
    expect(blowCount).toBeGreaterThanOrEqual(20);
    expect(blowCount).toBeLessThanOrEqual(80);
  });

  it('candle blow-out message: exact ZIL text (1actions.zil:2423)', () => {
    // Run seeded until we see the blow-out — guaranteed deterministic.
    const rng = new Rng(42);
    const g = createGame({ startRoom: 'TINY-CAVE', rng });
    g.start();

    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);
    candles!.set(Flag.Light);

    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      if (!candles!.has(Flag.OnFire)) {
        candles!.set(Flag.OnFire);
        candles!.set(Flag.Light);
      }
      const out = g.turn('look').output;
      if (out.includes('gust of wind')) {
        expect(out).toContain('A gust of wind blows out your candles!');
        found = true;
      }
    }
    expect(found, 'blow-out must fire within 200 seeded turns').toBe(true);
  });

  it('candle blow-out clears ONBIT (candles go dark, 1actions.zil:2422)', () => {
    // Blow-out must clear Flag.OnFire on candles.
    const rng = new Rng(42);
    const g = createGame({ startRoom: 'TINY-CAVE', rng });
    g.start();

    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);
    candles!.set(Flag.Light);

    let blown = false;
    for (let i = 0; i < 200 && !blown; i++) {
      if (!candles!.has(Flag.OnFire)) {
        candles!.set(Flag.OnFire);
        candles!.set(Flag.Light);
      }
      const out = g.turn('look').output;
      if (out.includes('gust of wind')) {
        blown = true;
        expect(candles!.has(Flag.OnFire), 'ONBIT must be cleared after blow-out').toBe(false);
      }
    }
    expect(blown, 'blow-out must occur within 200 turns for state check').toBe(true);
  });

  it('candle blow-out only fires when carrying candles (1actions.zil:2418)', () => {
    // Without candles in inventory: no blow-out.
    const rng = new Rng(42);
    const g = createGame({ startRoom: 'TINY-CAVE', rng });
    g.start();

    // Candles not on player — put in remote room.
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    const remote = g.world.get('LIVING-ROOM');
    expect(remote, 'LIVING-ROOM must exist').toBeDefined();
    candles!.moveTo(remote!);

    // Need lantern for light so game is functional.
    giveLantern(g);

    for (let i = 0; i < 50; i++) {
      const out = g.turn('look').output;
      expect(out).not.toContain('gust of wind blows out your candles');
    }
  });
});

// ---------------------------------------------------------------------------
// SOUTH-TEMPLE-FCN — 1actions.zil:2573–2576
// M-BEG: sets COFFIN-CURE = NOT (coffin in inventory)
// Exit gate (ifFlag: COFFIN-CURE) already wired in rooms.json.
// ---------------------------------------------------------------------------

describe('CC10 — SOUTH-TEMPLE-FCN: coffin-gate blocks exit when carrying coffin', () => {
  function gameAtSouthTemple() {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    giveLantern(g);
    return g;
  }

  it('carrying coffin: down exit blocked with "You haven\'t a prayer" (1actions.zil:2573)', () => {
    const g = gameAtSouthTemple();
    const coffin = g.world.get('COFFIN');
    expect(coffin, 'COFFIN must exist').toBeDefined();
    coffin!.moveTo(g.player);
    const out = g.turn('down').output;
    expect(out).toContain("prayer");
  });

  it('carrying coffin: player stays in SOUTH-TEMPLE', () => {
    const g = gameAtSouthTemple();
    const coffin = g.world.get('COFFIN');
    expect(coffin, 'COFFIN must exist').toBeDefined();
    coffin!.moveTo(g.player);
    g.turn('down');
    expect(g.player.parent?.id).toBe('SOUTH-TEMPLE');
  });

  it('not carrying coffin: down exit is open (1actions.zil:2575)', () => {
    const g = gameAtSouthTemple();
    // Coffin is not on player.
    const coffin = g.world.get('COFFIN');
    expect(coffin, 'COFFIN must exist').toBeDefined();
    // Ensure coffin is NOT in player inventory (put it in north temple).
    const north = g.world.get('NORTH-TEMPLE');
    expect(north, 'NORTH-TEMPLE must exist').toBeDefined();
    coffin!.moveTo(north!);
    g.turn('down');
    // Player moved to TINY-CAVE (down exit leads there).
    expect(g.player.parent?.id).toBe('TINY-CAVE');
  });

  it('COFFIN-CURE does NOT set resurrection logic (spec seam: that is Hades only)', () => {
    // SOUTH-TEMPLE-FCN only sets COFFIN-CURE; the resurrection branch lives in hades.ts.
    // Verify that SOUTH-TEMPLE-FCN does NOT modify LLD-FLAG or any resurrection global.
    const g = gameAtSouthTemple();
    type FlagMap = { get: (n: string) => boolean; set: (n: string, v: boolean) => void };
    const flags = (g as unknown as { flags: FlagMap }).flags;
    const before = flags.get('LLD-FLAG');
    const coffin = g.world.get('COFFIN');
    expect(coffin, 'COFFIN must exist').toBeDefined();
    coffin!.moveTo(g.player);
    g.turn('look');
    // LLD-FLAG unchanged.
    expect(flags.get('LLD-FLAG')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// MACHINE-ROOM-FCN — 1actions.zil:2488–2500
// Already registered in coal-mine.ts (CC3). Verify registration is present.
// ---------------------------------------------------------------------------

describe('CC10 — MACHINE-ROOM-FCN: registration present (1actions.zil:2488)', () => {
  it('look in MACHINE-ROOM: lid state visible in description', () => {
    const g = newGameAt('MACHINE-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('look').output;
    expect(out).toContain('dryer');
  });
});

// ---------------------------------------------------------------------------
// CANYON-VIEW-F — 1dungeon.zil:2406–2411
// A.1 outcome: FCN exists (handles M-BEG LEAP; does NOT handle M-LOOK/desc).
// ZIL citation: 1dungeon.zil:2406 — CANYON-VIEW-F defined; only M-BEG+LEAP handled.
// ---------------------------------------------------------------------------

describe('CC10 — CANYON-VIEW-F: M-BEG LEAP causes death (1dungeon.zil:2407)', () => {
  it('jump (bare leap) at CANYON-VIEW: output contains death text', () => {
    const g = newGameAt('CANYON-VIEW');
    g.start();
    // CANYON-VIEW has ONBIT (outdoor, always lit).
    const out = g.turn('jump').output;
    expect(out).toContain('Nice view, lousy place to jump');
  });

  it('jump at CANYON-VIEW: game ends (jigsUp fires)', () => {
    const g = newGameAt('CANYON-VIEW');
    g.start();
    const out = g.turn('jump').output;
    // jigsUp output contains death sequence.
    expect(out).toContain('****');
  });
});

describe('CC10 — CANYON-VIEW-F: look output matches rooms.json ldesc (A.1 absence evidence)', () => {
  // ZIL citation: 1dungeon.zil:2406–2411. CANYON-VIEW-F has no M-LOOK/M-ENTER clause.
  // The ldesc in rooms.json provides the full room description; no handler override needed.
  it('look at CANYON-VIEW: output contains "Great Canyon" from ldesc', () => {
    const g = newGameAt('CANYON-VIEW');
    g.start();
    const out = g.turn('look').output;
    expect(out).toContain('Great Canyon');
  });

  it('look at CANYON-VIEW: output contains "Aragain Falls" from ldesc', () => {
    const g = newGameAt('CANYON-VIEW');
    g.start();
    const out = g.turn('look').output;
    expect(out).toContain('Aragain Falls');
  });
});
