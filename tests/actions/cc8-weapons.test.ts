/**
 * CC8 — weapon FCN unit tests (spec §6.8)
 *
 * ZIL refs (1actions.zil):
 *   KNIFE-F          :926–929  — TAKE clears NDESCBIT on ATTIC-TABLE, returns false
 *   RUSTY-KNIFE-FCN  :907–924  — TAKE with sword → blue pulse (false); ATTACK/SWING → death
 *   AXE-F            :622–624  — WEAPON-FUNCTION(AXE, TROLL) when TROLL-FLAG is false
 *   WEAPON-FUNCTION  :629–638  — troll present: TAKE axe → white-hot or swings-out-of-reach
 *   STILETTO-FUNCTION          — already live (treasure-room.ts); untouched here
 *
 * Done-criteria (spec §6.8 + §11 CC8):
 *   - rusty-knife attack (as instrument) → death message contains "throat"
 *   - rusty-knife attack drops the knife from world (REMOVE-CAREFULLY)
 *   - take rusty-knife with sword in inventory → blue pulse message; no glow change
 *   - KNIFE-F take → ATTIC-TABLE loses NonDescript flag; handler returns false
 *   - AXE-F with troll present (TROLL-FLAG false) → TAKE returns white-hot or swings-msg
 *   - AXE-F with TROLL-FLAG true → returns false (no-op)
 *   - stiletto is untouched (still live via treasure-room.ts)
 *
 * Spec §10.4: world-state prerequisites assert-and-fail; no conditional
 * early-returns above expects.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// RUSTY-KNIFE-FCN — 1actions.zil:907–924
// ---------------------------------------------------------------------------

describe('CC8 — RUSTY-KNIFE-FCN: blue pulse on take with sword (1actions.zil:908–912)', () => {
  it('taking rusty-knife while carrying sword emits blue-light pulse', async () => {
    const g = newGameAt('MAZE-5');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    // Give player the sword.
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist').toBeDefined();
    sword!.moveTo(g.player);

    // Rusty-knife must be in the room for take to work.
    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    const room = g.world.get('MAZE-5');
    expect(room, 'MAZE-5 must exist').toBeDefined();
    knife!.moveTo(room!);

    const out = await (await g.turn('take rusty knife')).output;
    expect(out).toContain('blue');
  });

  it('blue pulse message contains "sword" reference (1actions.zil:911)', async () => {
    const g = newGameAt('MAZE-5');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist').toBeDefined();
    sword!.moveTo(g.player);

    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    const room = g.world.get('MAZE-5');
    expect(room, 'MAZE-5 must exist').toBeDefined();
    knife!.moveTo(room!);

    const out = await (await g.turn('take rusty knife')).output;
    // ZIL: "your sword gives a single pulse of blinding blue light."
    expect(out).toContain('sword');
  });

  it('take rusty-knife with sword: handler returns false (take succeeds)', async () => {
    const g = newGameAt('MAZE-5');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist').toBeDefined();
    sword!.moveTo(g.player);

    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    const room = g.world.get('MAZE-5');
    expect(room, 'MAZE-5 must exist').toBeDefined();
    knife!.moveTo(room!);

    await g.turn('take rusty knife');
    // The handler returns false (RFALSE), so the take verb continues — knife
    // ends up in player's inventory.
    expect(knife!.parent?.id).toBe(g.player.id);
  });

  it('take rusty-knife WITHOUT sword: no blue pulse', async () => {
    const g = newGameAt('MAZE-5');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    // Make sure sword is NOT in player's inventory.
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist').toBeDefined();
    const livingRoom = g.world.get('LIVING-ROOM');
    expect(livingRoom, 'LIVING-ROOM must exist').toBeDefined();
    sword!.moveTo(livingRoom!);

    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    const room = g.world.get('MAZE-5');
    expect(room, 'MAZE-5 must exist').toBeDefined();
    knife!.moveTo(room!);

    const out = await (await g.turn('take rusty knife')).output;
    expect(out).not.toContain('blue');
  });
});

describe('CC8 — RUSTY-KNIFE-FCN: attack death (1actions.zil:914–923)', () => {
  it('attack with rusty knife → death message contains "throat"', async () => {
    const g = newGameAt('TROLL-ROOM');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    // Give player the rusty knife.
    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    knife!.moveTo(g.player);

    // Troll must be in the room for "attack troll with rusty knife" to parse.
    const troll = g.world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    troll!.moveTo(room!);

    const out = await (await g.turn('attack troll with rusty knife')).output;
    expect(out).toContain('throat');
  });

  it('attack with rusty knife → rusty knife removed from world', async () => {
    const g = newGameAt('TROLL-ROOM');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    knife!.moveTo(g.player);

    const troll = g.world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    troll!.moveTo(room!);

    await g.turn('attack troll with rusty knife');
    // REMOVE-CAREFULLY before JIGS-UP removes the knife from the world.
    expect(knife!.parent).toBeNull();
  });

  it('attack with rusty knife → death triggers (jigsUp called)', async () => {
    const g = newGameAt('TROLL-ROOM');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const knife = g.world.get('RUSTY-KNIFE');
    expect(knife, 'RUSTY-KNIFE must exist').toBeDefined();
    knife!.moveTo(g.player);

    const troll = g.world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    troll!.moveTo(room!);

    // After death the game enters the "You have been killed" / resurrection flow.
    // The death message is the distinguishing marker.
    const out = await (await g.turn('attack troll with rusty knife')).output;
    // jigsUp preamble / death separator from 1actions.zil:4049
    expect(out).toMatch(/throat|killed|died|dead|slits/i);
  });
});

// ---------------------------------------------------------------------------
// KNIFE-F — 1actions.zil:926–929
// ---------------------------------------------------------------------------

describe('CC8 — KNIFE-F: TAKE clears NDESCBIT on ATTIC-TABLE (1actions.zil:927–928)', () => {
  it('ATTIC-TABLE starts with NonDescript flag', () => {
    const g = newGameAt('ATTIC');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const table = g.world.get('ATTIC-TABLE');
    expect(table, 'ATTIC-TABLE must exist').toBeDefined();
    expect(table!.has(Flag.NonDescript), 'ATTIC-TABLE must start NonDescript').toBe(true);
  });

  it('taking the knife clears NonDescript on ATTIC-TABLE', async () => {
    const g = newGameAt('ATTIC');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const table = g.world.get('ATTIC-TABLE');
    expect(table, 'ATTIC-TABLE must exist').toBeDefined();
    // Ensure knife is on the table (default position).
    const knife = g.world.get('KNIFE');
    expect(knife, 'KNIFE must exist').toBeDefined();
    knife!.moveTo(table!);

    await g.turn('take knife');

    expect(table!.has(Flag.NonDescript), 'ATTIC-TABLE must lose NonDescript after knife taken').toBe(false);
  });

  it('taking the knife: handler returns false (take verb continues)', async () => {
    const g = newGameAt('ATTIC');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const table = g.world.get('ATTIC-TABLE');
    expect(table, 'ATTIC-TABLE must exist').toBeDefined();
    const knife = g.world.get('KNIFE');
    expect(knife, 'KNIFE must exist').toBeDefined();
    knife!.moveTo(table!);

    await g.turn('take knife');
    // KNIFE-F returns false → take verb continues → knife moves to player.
    expect(knife!.parent?.id).toBe(g.player.id);
  });
});

// ---------------------------------------------------------------------------
// AXE-F — 1actions.zil:622–624
// ---------------------------------------------------------------------------

describe('CC8 — AXE-F: WEAPON-FUNCTION when TROLL-FLAG is false (1actions.zil:622–624)', () => {
  function gameAtTrollRoom() {
    const g = newGameAt('TROLL-ROOM');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    return g;
  }

  it('TAKE axe with troll present and TROLL-FLAG false → white-hot message', async () => {
    const g = gameAtTrollRoom();
    // TROLL-FLAG starts false (troll is alive).
    const troll = g.world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    troll!.moveTo(room!);

    // Axe is with the troll (default).
    const axe = g.world.get('AXE');
    expect(axe, 'AXE must exist').toBeDefined();
    axe!.moveTo(troll!);

    // Since axe is with troll (not in room), the "swings it out of reach" branch fires.
    const out = await (await g.turn('take axe')).output;
    expect(out).toMatch(/swings|white-hot|can't hold|out of your reach/i);
  });

  it('TAKE axe in room with troll present → white-hot message (1actions.zil:637)', async () => {
    const g = gameAtTrollRoom();
    const troll = g.world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    troll!.moveTo(room!);

    // Put axe in the room (not in troll), so the "white-hot" branch fires.
    const axe = g.world.get('AXE');
    expect(axe, 'AXE must exist').toBeDefined();
    axe!.moveTo(room!);

    const out = await (await g.turn('take axe')).output;
    expect(out).toContain('white-hot');
  });

  it('AXE-F with TROLL-FLAG true → returns false (no weapon-function message)', async () => {
    const g = gameAtTrollRoom();
    // Set TROLL-FLAG true (troll is dead/fled).
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('TROLL-FLAG', true);

    const axe = g.world.get('AXE');
    expect(axe, 'AXE must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    axe!.moveTo(room!);

    const out = await (await g.turn('take axe')).output;
    // With TROLL-FLAG true, AXE-F returns false immediately — no white-hot msg.
    expect(out).not.toContain('white-hot');
    expect(out).not.toContain('swings it out');
  });

  it('TAKE axe with troll NOT in room → weapon-function returns false (no message)', async () => {
    const g = gameAtTrollRoom();
    // Move troll away from here.
    const troll = g.world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    const elsewhere = g.world.get('LIVING-ROOM');
    expect(elsewhere, 'LIVING-ROOM must exist').toBeDefined();
    troll!.moveTo(elsewhere!);

    const axe = g.world.get('AXE');
    expect(axe, 'AXE must exist').toBeDefined();
    const room = g.world.get('TROLL-ROOM');
    expect(room, 'TROLL-ROOM must exist').toBeDefined();
    axe!.moveTo(room!);

    const out = await (await g.turn('take axe')).output;
    expect(out).not.toContain('white-hot');
    expect(out).not.toContain('swings it out');
  });
});

// ---------------------------------------------------------------------------
// STILETTO — untouched (already live; verify registration)
// ---------------------------------------------------------------------------

describe('CC8 — STILETTO: still live via treasure-room.ts (spec §6.8, §2-A)', () => {
  it('STILETTO-FUNCTION is registered in the action registry', async () => {
    // The registry must export a handler for STILETTO-FUNCTION.
    // We verify indirectly: if the thief is in the treasure room with the stiletto,
    // trying to take the stiletto should produce the weapon-function message.
    const g = newGameAt('TREASURE-ROOM');
    g.start();
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.moveTo(g.player);
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);

    const thief = g.world.get('THIEF');
    expect(thief, 'THIEF must exist').toBeDefined();
    const room = g.world.get('TREASURE-ROOM');
    expect(room, 'TREASURE-ROOM must exist').toBeDefined();
    thief!.moveTo(room!);
    thief!.set(Flag.Fight);
    thief!.clear(Flag.Invisible);

    const stiletto = g.world.get('STILETTO');
    expect(stiletto, 'STILETTO must exist').toBeDefined();
    // Put stiletto in room (not in thief) → "seems white-hot" branch of WEAPON-FUNCTION.
    stiletto!.moveTo(room!);

    const out = await (await g.turn('take stiletto')).output;
    expect(out).toContain('white-hot');
  });
});
