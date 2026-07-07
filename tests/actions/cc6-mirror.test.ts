/**
 * CC6 — mirror handler unit tests (spec §6.6)
 *
 * MIRROR-MIRROR — 1actions.zil:971–1012
 * MIRROR-ROOM   — 1actions.zil:958–966
 *
 *   RUB mirror (no instrument / bare hands):
 *     swap ALL contents of MIRROR-ROOM-1 and MIRROR-ROOM-2 + teleport player.
 *     Prints rumble message. Engine describes new room automatically (no-look
 *     deviation from ZIL GOTO <> accepted; see bat-garlic.ts note).
 *
 *   RUB mirror WITH <instrument>:
 *     "You feel a faint tingling transmitted through the <desc>."  (no swap)
 *
 *   EXAMINE / LOOK-INSIDE:
 *     intact  → "There is an ugly person staring back at you."
 *     munged → "The mirror is broken into many pieces."
 *
 *   TAKE:
 *     "The mirror is many times your size. Give up."
 *
 *   V-MUNG (break/destroy/smash mirror with <weapon>):
 *     intact  → sets MIRROR-MUNG=true, LUCKY=false; prints bad-luck message.
 *     munged → "Haven't you done enough damage already?"
 *
 *   MIRROR-ROOM M-LOOK:
 *     prints base ldesc + optional mung addendum when MIRROR-MUNG is true.
 *
 * Grammar note:
 *   ZIL MIRROR-MIRROR handles V-MUNG, V-THROW, and V-ATTACK.  In the engine,
 *   bare "attack mirror" parses ATTACK with ACTORBIT requirement (mirror lacks it).
 *   The reachable break path for players is "break/smash/destroy mirror with
 *   <weapon>" → V-MUNG PRE-MUNG. Tests use "break mirror with sword".
 *
 * Spec §6.6 done-criteria:
 *   - rub mirror → room contents swap + teleport
 *   - break mirror → MIRROR-MUNG set, LUCKY=false
 *   - Phase-2 zprob reads the flipped LUCKY (combat denom shifts 100→300)
 *
 * Spec §10.4 test contract: world-state prerequisites assert-and-fail.
 * No conditional early-returns above expects.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Thing } from '../../src/domain/thing.js';
import { Flag } from '../../src/domain/flags.js';

const ROOM1 = 'MIRROR-ROOM-1';
const ROOM2 = 'MIRROR-ROOM-2';

function gameAtRoom1() {
  const g = newGameAt(ROOM1);
  g.start();
  // Give the player a lamp so the room is lit (mirror rooms have no ambient light).
  const lamp = g.world.get('LAMP');
  expect(lamp, 'LAMP must exist').toBeDefined();
  lamp!.moveTo(g.player);
  lamp!.set(Flag.OnFire);
  lamp!.set(Flag.Light);
  return g;
}

// Arm the player with a sword so "break mirror with sword" (V-MUNG PRE-MUNG) parses.
function armWithSword(g: ReturnType<typeof newGameAt>): void {
  const sword = g.world.get('SWORD');
  expect(sword, 'SWORD must exist').toBeDefined();
  sword!.moveTo(g.player);
}

// ---------------------------------------------------------------------------
// Mirror rooms exist
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR: world prerequisites', () => {
  it('MIRROR-ROOM-1 exists in world', () => {
    const g = newGameAt(ROOM1);
    g.start();
    const room = g.world.get(ROOM1);
    expect(room, 'MIRROR-ROOM-1 must exist').toBeDefined();
  });

  it('MIRROR-ROOM-2 exists in world', () => {
    const g = newGameAt(ROOM1);
    g.start();
    const room = g.world.get(ROOM2);
    expect(room, 'MIRROR-ROOM-2 must exist').toBeDefined();
  });

  it('MIRROR-1 is in MIRROR-ROOM-1', () => {
    const g = newGameAt(ROOM1);
    g.start();
    const mirror = g.world.get('MIRROR-1');
    expect(mirror, 'MIRROR-1 must exist').toBeDefined();
    expect(mirror!.parent?.id, 'MIRROR-1 must be in MIRROR-ROOM-1').toBe(ROOM1);
  });

  it('MIRROR-2 is in MIRROR-ROOM-2', () => {
    const g = newGameAt(ROOM1);
    g.start();
    const mirror = g.world.get('MIRROR-2');
    expect(mirror, 'MIRROR-2 must exist').toBeDefined();
    expect(mirror!.parent?.id, 'MIRROR-2 must be in MIRROR-ROOM-2').toBe(ROOM2);
  });
});

// ---------------------------------------------------------------------------
// RUB mirror — swap + teleport (1actions.zil:972–993)
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR-MIRROR: rub swaps room contents (1actions.zil:979–990)', () => {
  it('rub mirror: MIRROR-1 moves to MIRROR-ROOM-2', async () => {
    const g = gameAtRoom1();
    const mirror1 = g.world.get('MIRROR-1');
    expect(mirror1, 'MIRROR-1 must exist').toBeDefined();

    await g.turn('rub mirror');

    expect(mirror1!.parent?.id, 'MIRROR-1 must move to MIRROR-ROOM-2 after rub').toBe(ROOM2);
  });

  it('rub mirror: MIRROR-2 moves to MIRROR-ROOM-1', async () => {
    const g = gameAtRoom1();
    const mirror2 = g.world.get('MIRROR-2');
    expect(mirror2, 'MIRROR-2 must exist').toBeDefined();

    await g.turn('rub mirror');

    expect(mirror2!.parent?.id, 'MIRROR-2 must move to MIRROR-ROOM-1 after rub').toBe(ROOM1);
  });

  it('rub mirror: player teleports to MIRROR-ROOM-2', async () => {
    const g = gameAtRoom1();
    await g.turn('rub mirror');
    expect(g.player.parent?.id, 'player must be in MIRROR-ROOM-2 after rub').toBe(ROOM2);
  });

  it('rub mirror: rumble message emitted', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('rub mirror')).output;
    expect(out).toContain('rumble');
  });

  it('rub mirror: does NOT print "seven years" (no break)', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('rub mirror')).output;
    expect(out).not.toContain('seven years');
  });

  // spec §6.6 "(no LOOK)" — ZIL <GOTO .RM2 <>> passes V?=false, so V-FIRST-LOOK
  // is skipped (gverbs.zil:2134–2136).  The engine must not auto-describe the
  // arrival room after the handler-driven teleport.
  it('rub mirror: no room description printed (no LOOK — spec §6.6, gverbs.zil:2134)', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('rub mirror')).output;
    // Room title and ldesc must be absent — only the rumble line should appear.
    expect(out).not.toContain('Mirror Room');
    expect(out).not.toContain('tall ceilings');
    expect(out).not.toContain('enormous mirror');
  });
});

describe('CC6 — MIRROR-MIRROR: rub swaps items in both rooms (1actions.zil:979–990)', () => {
  it('item in MIRROR-ROOM-1 moves to MIRROR-ROOM-2 after rub', async () => {
    const g = gameAtRoom1();
    const room1 = g.world.get(ROOM1);
    expect(room1, 'MIRROR-ROOM-1 must exist').toBeDefined();

    const gem = new Thing('TEST-GEM-SWAP1', 'gem');
    g.world.register(gem);
    gem.moveTo(room1!);

    await g.turn('rub mirror');

    expect(gem.parent?.id, 'gem from ROOM1 must be in MIRROR-ROOM-2 after swap').toBe(ROOM2);
  });

  it('item in MIRROR-ROOM-2 moves to MIRROR-ROOM-1 after rub', async () => {
    const g = gameAtRoom1();
    const room2 = g.world.get(ROOM2);
    expect(room2, 'MIRROR-ROOM-2 must exist').toBeDefined();

    const coin = new Thing('TEST-COIN-SWAP2', 'coin');
    g.world.register(coin);
    coin.moveTo(room2!);

    await g.turn('rub mirror');

    expect(coin.parent?.id, 'coin from ROOM2 must be in MIRROR-ROOM-1 after swap').toBe(ROOM1);
  });
});

// ---------------------------------------------------------------------------
// RUB mirror WITH instrument — tingling (1actions.zil:973–976)
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR-MIRROR: rub with instrument → tingling (1actions.zil:973–976)', () => {
  it('rub mirror with lamp: tingling message', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('rub mirror with lamp')).output;
    expect(out).toContain('tingling');
  });

  it('rub mirror with lamp: no swap (player stays in MIRROR-ROOM-1)', async () => {
    const g = gameAtRoom1();
    await g.turn('rub mirror with lamp');
    expect(g.player.parent?.id, 'player must stay in MIRROR-ROOM-1 when instrument used').toBe(ROOM1);
  });

  it('rub mirror with lamp: MIRROR-1 stays in MIRROR-ROOM-1 (no swap)', async () => {
    const g = gameAtRoom1();
    const mirror1 = g.world.get('MIRROR-1');
    expect(mirror1, 'MIRROR-1 must exist').toBeDefined();

    await g.turn('rub mirror with lamp');

    expect(mirror1!.parent?.id, 'MIRROR-1 must not move when instrument used').toBe(ROOM1);
  });
});

// ---------------------------------------------------------------------------
// EXAMINE mirror — intact and munged (1actions.zil:994–999)
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR-MIRROR: examine mirror (1actions.zil:994–999)', () => {
  it('examine intact mirror: ugly person message', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('examine mirror')).output;
    expect(out).toContain('ugly person');
  });

  it('examine broken mirror: broken-pieces message', async () => {
    const g = gameAtRoom1();
    armWithSword(g);
    await g.turn('break mirror with sword');
    const out = await (await g.turn('examine mirror')).output;
    expect(out).toContain('broken into many pieces');
  });
});

// ---------------------------------------------------------------------------
// TAKE mirror — too large (1actions.zil:1000–1002)
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR-MIRROR: take mirror → size message (1actions.zil:1000–1002)', () => {
  it('take mirror: "many times your size" message', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('take mirror')).output;
    expect(out).toContain('many times your size');
  });

  it('take mirror: mirror not in player inventory', async () => {
    const g = gameAtRoom1();
    const mirror1 = g.world.get('MIRROR-1');
    expect(mirror1, 'MIRROR-1 must exist').toBeDefined();

    await g.turn('take mirror');

    expect(mirror1!.parent?.id, 'mirror must not be in player inventory').not.toBe('PLAYER');
  });
});

// ---------------------------------------------------------------------------
// V-MUNG (break mirror with sword) — break logic (1actions.zil:1003–1012)
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR-MIRROR: break mirror sets MIRROR-MUNG and LUCKY=false (1actions.zil:1008–1009)', () => {
  it('break mirror with sword: bad-luck message emitted', async () => {
    const g = gameAtRoom1();
    armWithSword(g);
    const out = await (await g.turn('break mirror with sword')).output;
    expect(out).toContain('seven years');
  });

  it('break mirror: LUCKY is false after break', async () => {
    const g = gameAtRoom1();
    armWithSword(g);
    expect(g.lucky, 'LUCKY must start true').toBe(true);

    await g.turn('break mirror with sword');

    // Phase-2 zprob reads this.lucky via getLucky(); breaking the mirror
    // shifts LOSE-WEAPON from denom=100 to denom=300 (~1/3 as likely).
    // 1actions.zil:1009; combat.ts:687.
    expect(g.lucky, 'LUCKY must be false after mirror is broken').toBe(false);
  });

  it('break mirror twice: second break yields "enough damage" message', async () => {
    const g = gameAtRoom1();
    armWithSword(g);
    await g.turn('break mirror with sword');
    const out = await (await g.turn('break mirror with sword')).output;
    expect(out).toContain('enough damage');
  });

  it('break mirror: LUCKY stays false after second break attempt', async () => {
    const g = gameAtRoom1();
    armWithSword(g);
    await g.turn('break mirror with sword');
    await g.turn('break mirror with sword');
    expect(g.lucky, 'LUCKY must remain false').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MIRROR-ROOM FCN — M-LOOK description (1actions.zil:958–966)
// ---------------------------------------------------------------------------

describe('CC6 — MIRROR-ROOM: M-LOOK description (1actions.zil:958–966)', () => {
  it('MIRROR-ROOM-1 look: base description present', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('look')).output;
    expect(out).toContain('enormous mirror');
  });

  it('MIRROR-ROOM-1 look: exits mentioned', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('look')).output;
    expect(out).toContain('exits');
  });

  it('MIRROR-ROOM-1 look when intact: no mung addendum', async () => {
    const g = gameAtRoom1();
    const out = await (await g.turn('look')).output;
    expect(out).not.toContain('recklessness');
  });

  it('MIRROR-ROOM-1 look after break: mung addendum present', async () => {
    const g = gameAtRoom1();
    armWithSword(g);
    await g.turn('break mirror with sword');
    const out = await (await g.turn('look')).output;
    expect(out).toContain('recklessness');
  });
});
