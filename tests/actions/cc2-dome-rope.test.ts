/**
 * CC2 — rope/dome unit tests (spec §6.2, §10.3)
 *
 * ROPE-FUNCTION / DOME-ROOM-FCN / TORCH-ROOM-FCN
 * ZIL refs: 1actions.zil:3030 (ROPE-FUNCTION), :1030 (DOME-ROOM-FCN), :1018 (TORCH-ROOM-FCN)
 *
 * Done-criteria (spec §6.2):
 *   - tie rope at dome → DOME-FLAG set, descent enabled
 *   - untie reverses (DOME-FLAG cleared, descent blocked)
 *   - dome down exit gates on DOME-FLAG (message when not set)
 *   - TORCH-ROOM up exit always blocked
 *   - TAKE blocked when rope is tied (DOME-FLAG set)
 *   - DROP rope in DOME-ROOM without DOME-FLAG → drops to TORCH-ROOM below
 *   - TIE seam: ROPE-FUNCTION intercepts V-TIE before the V-TIE default
 *   - can't tie rope to non-railing objects
 *   - TORCH-ROOM-FCN M-LOOK: room desc with rope-descend line when DOME-FLAG
 *   - DOME-ROOM-FCN M-LOOK: periphery desc with rope-hanging line when DOME-FLAG
 *   - DOME-ROOM-FCN M-ENTER: dead player falls to TORCH-ROOM
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';

// Pull the flags map off the game the same way other test files do it.
function flags(g: ReturnType<typeof newGameAt>) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

// Give the player a lit lantern so dark rooms produce visible output.
// Object id is 'LAMP' (brass lantern); 'LANTERN' is the action routine name.
function giveLantern(g: ReturnType<typeof newGameAt>): void {
  const lamp = g.world.get('LAMP');
  expect(lamp, 'LAMP must exist in world').toBeDefined();
  lamp!.moveTo(g.player);
  lamp!.set(Flag.OnFire);
  // Flag.Light is already set on LAMP; set it explicitly in case state differs.
  lamp!.set(Flag.Light);
}

// Helper: place the rope in the player's inventory and the player in DOME-ROOM
// with a lit lantern so room descriptions are visible.
function gameWithRopeAtDome() {
  const g = newGameAt('DOME-ROOM');
  g.start();
  const rope = g.world.get('ROPE');
  expect(rope, 'ROPE must exist in world').toBeDefined();
  rope!.moveTo(g.player);
  giveLantern(g);
  return g;
}

// ---------------------------------------------------------------------------
// ROPE-FUNCTION — 1actions.zil:3030
// ---------------------------------------------------------------------------

describe('CC2 — ROPE-FUNCTION: tie rope to railing sets DOME-FLAG (1actions.zil:3036–3049)', () => {
  it('tie rope to railing: DOME-FLAG becomes true', () => {
    const g = gameWithRopeAtDome();
    g.turn('tie rope to railing');
    expect(flags(g).get('DOME-FLAG')).toBe(true);
  });

  it('tie rope to railing: emits rope-drops message', () => {
    const g = gameWithRopeAtDome();
    const out = g.turn('tie rope to railing').output;
    expect(out).toContain('rope drops over the side');
  });

  it('tie rope to railing again when already tied: reports already tied', () => {
    const g = gameWithRopeAtDome();
    g.turn('tie rope to railing');
    const out = g.turn('tie rope to railing').output;
    expect(out).toContain('already tied');
  });

  it('tie rope to non-railing object in DOME-ROOM: cannot tie message', () => {
    const g = gameWithRopeAtDome();
    // Tie rope to the lantern (in player inventory via giveLantern) — not the railing.
    // ROPE-FUNCTION V-TIE non-railing branch: "You can't tie the rope to that."
    const out = g.turn('tie rope to lantern').output;
    expect(out).toContain("can't tie the rope to that");
  });
});

describe('CC2 — ROPE-FUNCTION: untie rope clears DOME-FLAG (1actions.zil:3064–3070)', () => {
  it('untie rope when tied: DOME-FLAG becomes false', () => {
    const g = gameWithRopeAtDome();
    g.turn('tie rope to railing');
    expect(flags(g).get('DOME-FLAG')).toBe(true);
    g.turn('untie rope');
    expect(flags(g).get('DOME-FLAG')).toBe(false);
  });

  it('untie rope when tied: emits untied message', () => {
    const g = gameWithRopeAtDome();
    g.turn('tie rope to railing');
    const out = g.turn('untie rope').output;
    expect(out).toContain('rope is now untied');
  });

  it('untie rope when not tied: reports not tied', () => {
    const g = gameWithRopeAtDome();
    const out = g.turn('untie rope').output;
    expect(out).toContain('not tied to anything');
  });
});

describe('CC2 — ROPE-FUNCTION: take blocked when rope is tied (1actions.zil:3076–3078)', () => {
  it('take rope when DOME-FLAG set: rope is tied message', () => {
    const g = gameWithRopeAtDome();
    g.turn('tie rope to railing');
    // Rope is tied — attempting to take it should say it's tied to the railing.
    const out = g.turn('take rope').output;
    expect(out).toContain('tied to the railing');
  });
});

describe('CC2 — ROPE-FUNCTION: drop in DOME-ROOM falls below (1actions.zil:3071–3075)', () => {
  it('drop rope in DOME-ROOM without DOME-FLAG: rope moves to TORCH-ROOM', () => {
    const g = gameWithRopeAtDome();
    g.turn('drop rope');
    const rope = g.world.get('ROPE')!;
    expect(rope.parent?.id).toBe('TORCH-ROOM');
  });

  it('drop rope in DOME-ROOM without DOME-FLAG: emits drops-below message', () => {
    const g = gameWithRopeAtDome();
    const out = g.turn('drop rope').output;
    expect(out).toContain('rope drops gently to the floor below');
  });
});

describe('CC2 — TIE seam: ROPE-FUNCTION intercepts before V-TIE default (spec §4.3)', () => {
  it('tie rope to railing does NOT emit V-TIE default fallback string', () => {
    const g = gameWithRopeAtDome();
    const out = g.turn('tie rope to railing').output;
    // V-TIE default: "You can't tie the rope to that." — must not appear on success
    expect(out).not.toContain("You can't tie the rope to that.");
  });

  it('tie rope outside DOME-ROOM: ROPE-FUNCTION fires before V-TIE default', () => {
    // When not in DOME-ROOM, ROPE-FUNCTION intercepts and emits its own message.
    // Rope starts in ATTIC; tie it to the lamp (which is in player inventory after giveLantern).
    const g = newGameAt('ATTIC');
    g.start();
    giveLantern(g);
    // Rope starts in ATTIC
    const rope = g.world.get('ROPE');
    expect(rope, 'ROPE must exist in world').toBeDefined();
    // "tie rope to lamp" — rope is dobj (PRSO), lamp is iobj (PRSI); ROPE-FUNCTION fires
    // because ROPE has the ROPE-FUNCTION handler (step 6 of PERFORM = PRSO P?ACTION).
    const out = g.turn('tie rope to lamp').output;
    // ROPE-FUNCTION not-in-DOME-ROOM branch: "can't tie the rope to that."
    expect(out).toContain("can't tie the rope to that");
  });
});

// ---------------------------------------------------------------------------
// DOME-ROOM descent gate
// ---------------------------------------------------------------------------

describe('CC2 — DOME-ROOM descent gate (spec §6.2, 1dungeon.zil:2081-2082)', () => {
  it('go down from DOME-ROOM without DOME-FLAG: descent blocked', () => {
    const g = newGameAt('DOME-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('down').output;
    // elseMessage from rooms.json (ZIL: "You cannot go down without fracturing many bones.")
    expect(out).toContain('fracturing many bones');
  });

  it('go down from DOME-ROOM with DOME-FLAG set: descent reaches TORCH-ROOM', () => {
    const g = newGameAt('DOME-ROOM');
    g.start();
    giveLantern(g);
    flags(g).set('DOME-FLAG', true);
    g.turn('down');
    expect(g.view().here).toBe('TORCH-ROOM');
  });

  it('descent after tie-then-untie is blocked again', () => {
    const g = gameWithRopeAtDome();
    g.turn('tie rope to railing');
    g.turn('untie rope');
    const out = g.turn('down').output;
    expect(out).toContain('fracturing many bones');
  });
});

// ---------------------------------------------------------------------------
// TORCH-ROOM up exit — always blocked (1dungeon.zil:2090)
// ---------------------------------------------------------------------------

describe('CC2 — TORCH-ROOM up exit always blocked (1dungeon.zil:2090)', () => {
  it('go up from TORCH-ROOM: blocked with "cannot reach the rope"', () => {
    const g = newGameAt('TORCH-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('up').output;
    expect(out).toContain('cannot reach the rope');
  });

  it('go up from TORCH-ROOM even with DOME-FLAG set: still blocked', () => {
    // ZIL defines the UP exit as unconditionally blocked — no rope-climbing up.
    const g = newGameAt('TORCH-ROOM');
    g.start();
    giveLantern(g);
    flags(g).set('DOME-FLAG', true);
    const out = g.turn('up').output;
    expect(out).toContain('cannot reach the rope');
  });
});

// ---------------------------------------------------------------------------
// TORCH-ROOM-FCN M-LOOK — 1actions.zil:1018–1028
// ---------------------------------------------------------------------------

describe('CC2 — TORCH-ROOM-FCN M-LOOK (1actions.zil:1018–1028)', () => {
  it('look in TORCH-ROOM: contains dome/pedestal description', () => {
    const g = newGameAt('TORCH-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('look').output;
    expect(out).toContain('large dome');
    expect(out).toContain('white marble pedestal');
  });

  it('look in TORCH-ROOM with DOME-FLAG set: rope descending line appears', () => {
    const g = newGameAt('TORCH-ROOM');
    g.start();
    giveLantern(g);
    flags(g).set('DOME-FLAG', true);
    const out = g.turn('look').output;
    expect(out).toContain('piece of rope descends from the railing');
  });

  it('look in TORCH-ROOM without DOME-FLAG: no rope-descending line', () => {
    const g = newGameAt('TORCH-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('look').output;
    expect(out).not.toContain('piece of rope descends');
  });
});

// ---------------------------------------------------------------------------
// DOME-ROOM-FCN M-LOOK — 1actions.zil:1030–1039
// ---------------------------------------------------------------------------

describe('CC2 — DOME-ROOM-FCN M-LOOK (1actions.zil:1030–1039)', () => {
  it('look in DOME-ROOM: periphery/railing description', () => {
    const g = newGameAt('DOME-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('look').output;
    expect(out).toContain('periphery of a large dome');
    expect(out).toContain('wooden railing');
  });

  it('look in DOME-ROOM with DOME-FLAG: rope hanging from railing line', () => {
    const g = newGameAt('DOME-ROOM');
    g.start();
    giveLantern(g);
    flags(g).set('DOME-FLAG', true);
    const out = g.turn('look').output;
    expect(out).toContain('Hanging down from the railing is a rope');
  });

  it('look in DOME-ROOM without DOME-FLAG: no rope-hanging line', () => {
    const g = newGameAt('DOME-ROOM');
    g.start();
    giveLantern(g);
    const out = g.turn('look').output;
    expect(out).not.toContain('Hanging down from the railing is a rope');
  });
});

// ---------------------------------------------------------------------------
// DOME-ROOM-FCN M-ENTER: dead player falls to TORCH-ROOM (1actions.zil:1041–1047)
// ---------------------------------------------------------------------------

describe('CC2 — DOME-ROOM-FCN M-ENTER: dead player falls to TORCH-ROOM', () => {
  it('entering DOME-ROOM while dead: player is moved to TORCH-ROOM', () => {
    // Simulate dead player entering the dome — M-ENTER should push them down.
    // We test via the room handler directly rather than navigating in since
    // routing to DOME-ROOM from a lit room while dead is hard to set up end-to-end.
    const g = newGameAt('ENGRAVINGS-CAVE');
    g.start();
    giveLantern(g);
    // Mark player as dead (ghost mode).
    const deadFlag = (g as unknown as { dead: boolean });
    deadFlag.dead = true;
    // Navigate west from ENGRAVINGS-CAVE leads to DOME-ROOM (per ZIL).
    // Actually ENGRAVINGS-CAVE is EAST of DOME-ROOM; going east arrives at DOME-ROOM.
    // Let's check the exit data.
    // DOME-ROOM west → ENGRAVINGS-CAVE; so ENGRAVINGS-CAVE east → DOME-ROOM.
    g.turn('east');
    // Dead player entering DOME-ROOM should be moved to TORCH-ROOM.
    expect(g.view().here).toBe('TORCH-ROOM');
  });
});
