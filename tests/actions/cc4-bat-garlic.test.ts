/**
 * CC4 — bat/garlic unit tests (spec §6.4)
 *
 * BAT-F / FLY-ME / GARLIC-F
 * ZIL refs:
 *   1actions.zil:308   BAT-F      — TAKE/ATTACK bat + garlic check → FLY-ME or repel
 *   1actions.zil:317   FLY-ME     — FWEEP(4) + grab msg + teleport to BAT-DROPS room
 *   1actions.zil:326   FWEEP      — prints "    Fweep!" N times
 *   1actions.zil:332   BAT-DROPS  — 8 mine/ladder/entrance rooms
 *   1actions.zil:4160  GARLIC-F   — EAT garlic: remove + gulp message
 *
 * Done-criteria (spec §6.4 + §11 CC4):
 *   - bat with no garlic → FLY-ME fires (player teleported to a valid BAT-DROPS room)
 *   - output includes "Fweep!" lines and the grab message
 *   - player lands in one of the 8 BAT-DROPS rooms (seeded structural — assert membership)
 *   - garlic in player inventory → bat repelled ("clinging to the ceiling")
 *   - garlic in current room → bat repelled
 *   - garlic present: player does NOT move to a new room
 *   - GARLIC-F EAT: garlic removed from world + gulp message
 *
 * Spec §10.4 test contract: world-state prerequisites assert-and-fail, no conditional
 * early-returns above expects.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';

// BAT-DROPS table — 1actions.zil:332–341.
// These are the eight rooms the bat randomly drops the player into.
const BAT_DROPS: readonly string[] = [
  'MINE-1',
  'MINE-2',
  'MINE-3',
  'MINE-4',
  'LADDER-TOP',
  'LADDER-BOTTOM',
  'SQUEEKY-ROOM',
  'MINE-ENTRANCE',
];

function gameAtBatRoom() {
  const g = newGameAt('BAT-ROOM');
  g.start();
  // Lantern so room is lit.
  const lamp = g.world.get('LAMP');
  expect(lamp, 'LAMP must exist').toBeDefined();
  lamp!.moveTo(g.player);
  lamp!.set(Flag.OnFire);
  lamp!.set(Flag.Light);
  return g;
}

function ensureBatInRoom(g: ReturnType<typeof newGameAt>): void {
  const bat = g.world.get('BAT');
  expect(bat, 'BAT must exist in world').toBeDefined();
  const room = g.world.get(g.view().here);
  expect(room, 'current room must exist in world').toBeDefined();
  bat!.moveTo(room!);
}

function giveGarlicToPlayer(g: ReturnType<typeof newGameAt>): void {
  const garlic = g.world.get('GARLIC');
  expect(garlic, 'GARLIC must exist in world').toBeDefined();
  garlic!.moveTo(g.player);
}

function putGarlicInRoom(g: ReturnType<typeof newGameAt>): void {
  const garlic = g.world.get('GARLIC');
  expect(garlic, 'GARLIC must exist in world').toBeDefined();
  const room = g.world.get(g.view().here);
  expect(room, 'current room must exist in world').toBeDefined();
  garlic!.moveTo(room!);
}

// ---------------------------------------------------------------------------
// BAT-F — garlic-repel branch (1actions.zil:313–314)
// ---------------------------------------------------------------------------

describe('CC4 — BAT-F: garlic in inventory repels bat (1actions.zil:313)', () => {
  it('take bat with garlic in inventory: "clinging to the ceiling" message', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    giveGarlicToPlayer(g);
    const out = g.turn('take bat').output;
    expect(out).toContain('ceiling');
  });

  it('take bat with garlic in inventory: player does NOT move', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    giveGarlicToPlayer(g);
    const startRoom = g.player.parent?.id;
    g.turn('take bat');
    expect(g.player.parent?.id).toBe(startRoom);
  });

  it('attack bat with sword, garlic in inventory: bat repelled', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    giveGarlicToPlayer(g);
    // Give the player a weapon so the ATTACK parse resolves (numObjects=2 in syntax.json).
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist in world').toBeDefined();
    sword!.moveTo(g.player);
    const out = g.turn('attack bat with sword').output;
    expect(out).toContain('ceiling');
  });
});

describe('CC4 — BAT-F: garlic in room repels bat (1actions.zil:313)', () => {
  it('take bat with garlic on floor: "clinging to the ceiling" message', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    putGarlicInRoom(g);
    const out = g.turn('take bat').output;
    expect(out).toContain('ceiling');
  });

  it('take bat with garlic on floor: player does NOT move', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    putGarlicInRoom(g);
    const startRoom = g.player.parent?.id;
    g.turn('take bat');
    expect(g.player.parent?.id).toBe(startRoom);
  });
});

// ---------------------------------------------------------------------------
// FLY-ME — teleport branch (1actions.zil:317–324)
// Path B fence: assert branch fires + valid BAT-DROPS member; never a specific draw.
// ---------------------------------------------------------------------------

describe('CC4 — FLY-ME: bat teleport (1actions.zil:317)', () => {
  it('take bat without garlic: output includes "Fweep!" (1actions.zil:318)', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    const out = g.turn('take bat').output;
    expect(out).toContain('Fweep!');
  });

  it('take bat without garlic: output includes grab message (1actions.zil:319–320)', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    const out = g.turn('take bat').output;
    expect(out).toContain('scruff of your neck');
  });

  it('take bat without garlic: player lands in a valid BAT-DROPS room', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    g.turn('take bat');
    const newRoom = g.player.parent?.id;
    expect(newRoom, 'player must have moved to a room').toBeDefined();
    expect(BAT_DROPS, 'destination must be a BAT-DROPS member').toContain(newRoom);
  });

  it('take bat without garlic: player moves away from BAT-ROOM', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    g.turn('take bat');
    expect(g.player.parent?.id).not.toBe('BAT-ROOM');
  });

  it('attack bat with sword, no garlic: also triggers FLY-ME (1actions.zil:312)', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    // Give the player a weapon so the ATTACK parse resolves (numObjects=2 in syntax.json).
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist in world').toBeDefined();
    sword!.moveTo(g.player);
    const out = g.turn('attack bat with sword').output;
    // Branch fires: grab message present and player moved.
    expect(out).toContain('scruff');
    expect(BAT_DROPS).toContain(g.player.parent?.id);
  });

  // ZIL FWEEP(N) decrements N before the print test, so FWEEP(4) prints 3 lines.
  // 1actions.zil:328: <COND (<L? <SET N <- .N 1>> 1> <RETURN>) (T <TELL "    Fweep!" CR>)>
  it('FLY-ME: exactly 3 Fweep! lines (FWEEP(4) = N-1 prints, 1actions.zil:326-330)', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    const out = g.turn('take bat').output;
    const fweepCount = (out.match(/    Fweep!/g) ?? []).length;
    expect(fweepCount).toBe(3);
  });

  // ZIL FWEEP ends with <CRLF> (1actions.zil:330), dfrotz renders a blank line
  // between the last Fweep and the grab message.
  it('FLY-ME: blank line between last Fweep and grab message (1actions.zil:330)', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    const out = g.turn('take bat').output;
    expect(out).toMatch(/Fweep!\n\nThe bat grabs/);
  });
});

// ---------------------------------------------------------------------------
// BAT-F V-TELL path — FWEEP(6) count (1actions.zil:309-311)
// ---------------------------------------------------------------------------

describe('CC4 — BAT-F V-TELL: Fweep count (1actions.zil:310)', () => {
  // ZIL <FWEEP 6> with the N-1 rule prints 5 lines.
  it('tell bat: exactly 5 Fweep! lines (FWEEP(6) = N-1 prints)', () => {
    const g = gameAtBatRoom();
    ensureBatInRoom(g);
    const out = g.turn('tell bat').output;
    const fweepCount = (out.match(/    Fweep!/g) ?? []).length;
    expect(fweepCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// GARLIC-F — EAT garlic (1actions.zil:4161–4165)
// ---------------------------------------------------------------------------

describe('CC4 — GARLIC-F: eat garlic (1actions.zil:4161)', () => {
  it('eat garlic: prints gulp message', () => {
    const g = newGameAt('BAT-ROOM');
    g.start();
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist in world').toBeDefined();
    garlic!.moveTo(g.player);
    const out = g.turn('eat garlic').output;
    expect(out).toContain('Gulp');
  });

  it('eat garlic: garlic is removed from the world', () => {
    const g = newGameAt('BAT-ROOM');
    g.start();
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist in world').toBeDefined();
    garlic!.moveTo(g.player);
    g.turn('eat garlic');
    expect(garlic!.parent).toBeNull();
  });

  it('eat garlic: output mentions not making friends', () => {
    const g = newGameAt('BAT-ROOM');
    g.start();
    const garlic = g.world.get('GARLIC');
    expect(garlic, 'GARLIC must exist in world').toBeDefined();
    garlic!.moveTo(g.player);
    const out = g.turn('eat garlic').output;
    expect(out).toContain("won't make friends");
  });
});
