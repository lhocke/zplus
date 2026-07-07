/**
 * CC3 — coal-mine machine unit tests (spec §6.3, §10.3)
 *
 * MACHINE-F / MSWITCH-FUNCTION / BASKET-F / MACHINE-ROOM-FCN
 * ZIL refs:
 *   1actions.zil:2488  MACHINE-ROOM-FCN — M-LOOK description with lid state
 *   1actions.zil:2502  MACHINE-F        — OPEN/CLOSE lid, TAKE machine
 *   1actions.zil:2531  MSWITCH-FUNCTION — TURN switch with screwdriver
 *   1actions.zil:277   BASKET-F         — RAISE/LOWER the basket (CAGE-TOP global)
 *
 * Done-criteria (spec §6.3):
 *   - put coal in machine + close lid + turn switch → diamond (transform)
 *   - open machine when closed → lid opens message
 *   - open machine when already open → DUMMY message
 *   - open machine with coal inside → "revealing" + coal listed
 *   - close machine when open → lid closes message
 *   - close machine when already closed → DUMMY message
 *   - take machine → too large to carry
 *   - turn switch without screwdriver → instrument message
 *   - turn switch with screwdriver when lid open → machine doesn't do anything
 *   - turn switch with screwdriver when lid closed, no coal → gunk output
 *   - RAISE basket when already up (CAGE-TOP=T) → DUMMY message
 *   - LOWER basket when up (CAGE-TOP=T) → basket descends, CAGE-TOP=false
 *   - LOWER basket when already down (CAGE-TOP=false) → DUMMY message
 *   - RAISE basket when down → basket ascends, CAGE-TOP=true
 *   - LOWER basket with lamp aboard → room goes dark ("pitch black")
 *   - MACHINE-ROOM-FCN M-LOOK: lid-state in description
 *   - LIGHT-SHAFT NO-OBJS award: reach LOWER-SHAFT empty-handed with light
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';

function flags(g: ReturnType<typeof newGameAt>) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

function giveLantern(g: ReturnType<typeof newGameAt>): void {
  const lamp = g.world.get('LAMP');
  expect(lamp, 'LAMP must exist in world').toBeDefined();
  lamp!.moveTo(g.player);
  lamp!.set(Flag.OnFire);
  lamp!.set(Flag.Light);
}

// Put the basket in the "up" position and mark the flag accordingly.
function setBasketUp(g: ReturnType<typeof newGameAt>): void {
  const raised = g.world.get('RAISED-BASKET')!;
  const lowered = g.world.get('LOWERED-BASKET')!;
  expect(raised, 'RAISED-BASKET must exist').toBeDefined();
  expect(lowered, 'LOWERED-BASKET must exist').toBeDefined();
  raised.moveTo(g.world.get('SHAFT-ROOM')!);
  lowered.moveTo(g.world.get('LOWER-SHAFT')!);
  flags(g).set('CAGE-TOP', true);
}

// Put the basket in the "down" position and mark the flag accordingly.
function setBasketDown(g: ReturnType<typeof newGameAt>): void {
  const raised = g.world.get('RAISED-BASKET')!;
  const lowered = g.world.get('LOWERED-BASKET')!;
  expect(raised, 'RAISED-BASKET must exist').toBeDefined();
  expect(lowered, 'LOWERED-BASKET must exist').toBeDefined();
  raised.moveTo(g.world.get('LOWER-SHAFT')!);
  lowered.moveTo(g.world.get('SHAFT-ROOM')!);
  flags(g).set('CAGE-TOP', false);
}

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

function gameAtMachineRoom() {
  const g = newGameAt('MACHINE-ROOM');
  g.start();
  giveLantern(g);
  return g;
}

function gameWithCoalInMachine() {
  const g = gameAtMachineRoom();
  const coal = g.world.get('COAL');
  const machine = g.world.get('MACHINE');
  expect(coal, 'COAL must exist').toBeDefined();
  expect(machine, 'MACHINE must exist').toBeDefined();
  coal!.moveTo(machine!);
  return g;
}

// ---------------------------------------------------------------------------
// MACHINE-ROOM-FCN — 1actions.zil:2488–2500
// ---------------------------------------------------------------------------

describe('CC3 — MACHINE-ROOM-FCN M-LOOK: lid state in description (1actions.zil:2488)', () => {
  it('look in MACHINE-ROOM when lid is closed: description says "closed"', async () => {
    const g = gameAtMachineRoom();
    const out = await (await g.turn('look')).output;
    expect(out).toContain('closed');
  });

  it('look in MACHINE-ROOM when lid is open: description says "open"', async () => {
    const g = gameAtMachineRoom();
    await g.turn('open machine');
    const out = await (await g.turn('look')).output;
    expect(out).toContain('open');
  });

  it('look in MACHINE-ROOM: contains clothes dryer description', async () => {
    const g = gameAtMachineRoom();
    const out = await (await g.turn('look')).output;
    expect(out).toContain('dryer');
  });
});

// ---------------------------------------------------------------------------
// MACHINE-F — 1actions.zil:2502–2529
// ---------------------------------------------------------------------------

describe('CC3 — MACHINE-F: take machine (1actions.zil:2503)', () => {
  it('take machine: too large message', async () => {
    const g = gameAtMachineRoom();
    const out = await (await g.turn('take machine')).output;
    expect(out).toContain('far too large to carry');
  });

  it('take machine: machine stays in MACHINE-ROOM', async () => {
    const g = gameAtMachineRoom();
    await g.turn('take machine');
    const machine = g.world.get('MACHINE')!;
    expect(machine.parent?.id).toBe('MACHINE-ROOM');
  });
});

describe('CC3 — MACHINE-F: open machine (1actions.zil:2505–2515)', () => {
  it('open machine when closed (empty): lid opens message', async () => {
    const g = gameAtMachineRoom();
    const out = await (await g.turn('open machine')).output;
    expect(out).toContain('lid opens');
  });

  it('open machine when closed (empty): machine gets Open flag', async () => {
    const g = gameAtMachineRoom();
    const machine = g.world.get('MACHINE')!;
    expect(machine.has(Flag.Open)).toBe(false);
    await g.turn('open machine');
    expect(machine.has(Flag.Open)).toBe(true);
  });

  it('open machine when already open: DUMMY message (1actions.zil:2507)', async () => {
    const g = gameAtMachineRoom();
    await g.turn('open machine');
    const out = await (await g.turn('open machine')).output;
    // PICK-ONE DUMMY — any of the dummy-table entries; should NOT say "lid opens"
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('lid opens');
  });

  it('open machine with coal inside: "revealing" + item listed (1actions.zil:2509)', async () => {
    const g = gameWithCoalInMachine();
    const out = await (await g.turn('open machine')).output;
    expect(out).toContain('revealing');
    expect(out).toContain('coal');
  });
});

describe('CC3 — MACHINE-F: close machine (1actions.zil:2516–2523)', () => {
  it('close machine when open: lid closes message', async () => {
    const g = gameAtMachineRoom();
    await g.turn('open machine');
    const out = await (await g.turn('close machine')).output;
    expect(out).toContain('lid closes');
  });

  it('close machine when open: machine loses Open flag', async () => {
    const g = gameAtMachineRoom();
    await g.turn('open machine');
    const machine = g.world.get('MACHINE')!;
    expect(machine.has(Flag.Open)).toBe(true);
    await g.turn('close machine');
    expect(machine.has(Flag.Open)).toBe(false);
  });

  it('close machine when already closed: DUMMY message (1actions.zil:2521)', async () => {
    const g = gameAtMachineRoom();
    const out = await (await g.turn('close machine')).output;
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('lid closes');
  });
});

// ---------------------------------------------------------------------------
// MSWITCH-FUNCTION — 1actions.zil:2531–2551
// ---------------------------------------------------------------------------

describe('CC3 — MSWITCH-FUNCTION: turn switch (1actions.zil:2531)', () => {
  it('turn switch with non-screwdriver instrument: "won\'t do" message', async () => {
    const g = gameAtMachineRoom();
    // Lantern is already in player inventory (from giveLantern); use it as iobj.
    const out = await (await g.turn('turn switch with lantern')).output;
    expect(out).toContain("won't do");
  });

  it('turn switch with screwdriver when lid is open: machine does nothing (1actions.zil:2535)', async () => {
    const g = gameAtMachineRoom();
    const screw = g.world.get('SCREWDRIVER');
    expect(screw, 'SCREWDRIVER must exist').toBeDefined();
    screw!.moveTo(g.player);
    await g.turn('open machine');
    const out = await (await g.turn('turn switch with screwdriver')).output;
    expect(out).toContain("doesn't seem to want to do anything");
  });

  it('turn switch with screwdriver, lid closed, no coal: gunk produced (1actions.zil:2544)', async () => {
    const g = gameAtMachineRoom();
    const screw = g.world.get('SCREWDRIVER');
    expect(screw, 'SCREWDRIVER must exist').toBeDefined();
    screw!.moveTo(g.player);
    const machine = g.world.get('MACHINE')!;
    expect(machine.has(Flag.Open), 'machine lid must start closed').toBe(false);
    await g.turn('turn switch with screwdriver');
    const gunk = g.world.get('GUNK');
    expect(gunk, 'GUNK must exist').toBeDefined();
    expect(gunk!.parent?.id).toBe('MACHINE');
  });

  it('turn switch with screwdriver, lid closed, no coal: machine excitement output present (1actions.zil:2537)', async () => {
    const g = gameAtMachineRoom();
    const screw = g.world.get('SCREWDRIVER');
    expect(screw, 'SCREWDRIVER must exist').toBeDefined();
    screw!.moveTo(g.player);
    const out = await (await g.turn('turn switch with screwdriver')).output;
    expect(out).toContain('dazzling display');
  });

  it('turn switch with screwdriver, lid closed, coal inside: diamond produced (1actions.zil:2541)', async () => {
    const g = gameAtMachineRoom();
    const screw = g.world.get('SCREWDRIVER');
    expect(screw, 'SCREWDRIVER must exist').toBeDefined();
    screw!.moveTo(g.player);
    const coal = g.world.get('COAL');
    const machine = g.world.get('MACHINE')!;
    expect(coal, 'COAL must exist').toBeDefined();
    coal!.moveTo(machine);
    await g.turn('turn switch with screwdriver');
    expect(coal!.parent, 'coal must be removed from world').toBeNull();
    const diamond = g.world.get('DIAMOND');
    expect(diamond, 'DIAMOND must exist').toBeDefined();
    expect(diamond!.parent?.id).toBe('MACHINE');
  });

  it('turn switch with screwdriver, lid closed, coal inside: excitement message present', async () => {
    const g = gameAtMachineRoom();
    const screw = g.world.get('SCREWDRIVER');
    expect(screw, 'SCREWDRIVER must exist').toBeDefined();
    screw!.moveTo(g.player);
    const coal = g.world.get('COAL');
    const machine = g.world.get('MACHINE')!;
    expect(coal, 'COAL must exist').toBeDefined();
    coal!.moveTo(machine);
    const out = await (await g.turn('turn switch with screwdriver')).output;
    expect(out).toContain('dazzling display');
  });
});

// ---------------------------------------------------------------------------
// BASKET-F — 1actions.zil:277–306
// ---------------------------------------------------------------------------

// CAGE-TOP=T (true) means basket is at the top (RAISED-BASKET in SHAFT-ROOM).
// CAGE-TOP=false means basket is at the bottom (LOWERED-BASKET in LOWER-SHAFT).
// ZIL initial state: CAGE-TOP T.  Tests set state explicitly via setBasketUp/Down.

describe('CC3 — BASKET-F: RAISE basket when already up (1actions.zil:279)', () => {
  it('raise basket when CAGE-TOP=T: emits DUMMY message', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    const out = await (await g.turn('raise basket')).output;
    // PICK-ONE DUMMY — some message; must NOT say "raised to the top" (success branch)
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('raised to the top');
  });

  it('raise basket when CAGE-TOP=T: CAGE-TOP stays true', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    await g.turn('raise basket');
    expect(flags(g).get('CAGE-TOP')).toBe(true);
  });
});

describe('CC3 — BASKET-F: RAISE basket when down (1actions.zil:281–287)', () => {
  it('raise basket when CAGE-TOP=false: RAISED-BASKET moves to SHAFT-ROOM', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    await g.turn('raise basket');
    expect(raised.parent?.id).toBe('SHAFT-ROOM');
  });

  it('raise basket when CAGE-TOP=false: LOWERED-BASKET moves to LOWER-SHAFT', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    const lowered = g.world.get('LOWERED-BASKET')!;
    expect(lowered, 'LOWERED-BASKET must exist').toBeDefined();
    await g.turn('raise basket');
    expect(lowered.parent?.id).toBe('LOWER-SHAFT');
  });

  it('raise basket when CAGE-TOP=false: CAGE-TOP becomes true', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    await g.turn('raise basket');
    expect(flags(g).get('CAGE-TOP')).toBe(true);
  });

  it('raise basket when CAGE-TOP=false: emits "raised to the top" message', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    const out = await (await g.turn('raise basket')).output;
    expect(out).toContain('raised to the top');
  });
});

describe('CC3 — BASKET-F: LOWER basket when already down (1actions.zil:289)', () => {
  it('lower basket when CAGE-TOP=false: emits DUMMY message', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    const out = await (await g.turn('lower basket')).output;
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('lowered to the bottom');
  });

  it('lower basket when CAGE-TOP=false: CAGE-TOP stays false', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    await g.turn('lower basket');
    expect(flags(g).get('CAGE-TOP')).toBe(false);
  });
});

describe('CC3 — BASKET-F: LOWER basket when up (1actions.zil:291–300)', () => {
  it('lower basket when CAGE-TOP=T: RAISED-BASKET moves to LOWER-SHAFT', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    await g.turn('lower basket');
    expect(raised.parent?.id).toBe('LOWER-SHAFT');
  });

  it('lower basket when CAGE-TOP=T: LOWERED-BASKET moves to SHAFT-ROOM', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    const lowered = g.world.get('LOWERED-BASKET')!;
    expect(lowered, 'LOWERED-BASKET must exist').toBeDefined();
    await g.turn('lower basket');
    expect(lowered.parent?.id).toBe('SHAFT-ROOM');
  });

  it('lower basket when CAGE-TOP=T: CAGE-TOP becomes false', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    await g.turn('lower basket');
    expect(flags(g).get('CAGE-TOP')).toBe(false);
  });

  it('lower basket when CAGE-TOP=T: emits "lowered to the bottom" message', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    const out = await (await g.turn('lower basket')).output;
    expect(out).toContain('lowered to the bottom');
  });
});

describe('CC3 — BASKET-F: lower basket with lamp aboard → pitch black (1actions.zil:298)', () => {
  it('lower basket with lit lamp in basket: "pitch black" appended to output', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    setBasketUp(g);
    // Lamp in the raised basket (not on player) so lowering removes the light.
    const lamp = g.world.get('LAMP')!;
    expect(lamp, 'LAMP must exist').toBeDefined();
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    lamp.moveTo(raised);
    const out = await (await g.turn('lower basket')).output;
    expect(out).toContain('pitch black');
  });
});

describe('CC3 — BASKET-F: TAKE basket blocked (1actions.zil:304)', () => {
  it('take raised basket from SHAFT-ROOM: securely fastened message', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    const out = await (await g.turn('take basket')).output;
    expect(out).toContain('securely fastened');
  });

  it('take lowered basket from LOWER-SHAFT: securely fastened message', async () => {
    const g = newGameAt('LOWER-SHAFT');
    g.start();
    giveLantern(g);
    // LOWERED-BASKET is initially in LOWER-SHAFT per objects.json
    const lowered = g.world.get('LOWERED-BASKET')!;
    expect(lowered, 'LOWERED-BASKET must exist').toBeDefined();
    expect(lowered.parent?.id, 'LOWERED-BASKET must be in LOWER-SHAFT initially').toBe('LOWER-SHAFT');
    const out = await (await g.turn('take basket')).output;
    expect(out).toContain('securely fastened');
  });
});

describe('CC3 — BASKET-F: RAISE/LOWER intercepts before HACK-HACK (spec §4.5 seam)', () => {
  it('lower basket does NOT emit HACK-HACK "Playing in this way with the"', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketUp(g);
    const out = await (await g.turn('lower basket')).output;
    expect(out).not.toContain('Playing in this way with the');
  });

  it('raise basket when down does NOT emit HACK-HACK "Playing in this way with the"', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    setBasketDown(g);
    const out = await (await g.turn('raise basket')).output;
    expect(out).not.toContain('Playing in this way with the');
  });
});

// ---------------------------------------------------------------------------
// LIGHT-SHAFT NO-OBJS + Phase-2 score end-to-end (spec §6.3)
// 1actions.zil:2558–2571
// ---------------------------------------------------------------------------

describe('CC3 — LIGHT-SHAFT end-to-end: NO-OBJS awards +13 (1actions.zil:2558)', () => {
  it('enter LOWER-SHAFT empty-handed with lit lamp in basket: award fires', async () => {
    // Player arrives at LOWER-SHAFT without heavy items; lit lamp is in
    // RAISED-BASKET (Transparent+Container) which has been lowered here.
    // RAISED-BASKET is Transparent, so lit() can see the lamp inside it.
    // NO-OBJS M-BEG: empty-handed (no player item >4 weight) AND lit AND
    // room=LOWER-SHAFT → score +13.
    const g = newGameAt('LOWER-SHAFT');
    g.start();
    const lamp = g.world.get('LAMP')!;
    expect(lamp, 'LAMP must exist').toBeDefined();
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    lamp.moveTo(raised);
    raised.moveTo(g.world.get('LOWER-SHAFT')!);
    const scoreBefore = g.view().score;
    await g.turn('look');
    const scoreAfter = g.view().score;
    expect(scoreAfter - scoreBefore).toBe(13);
  });

  it('LIGHT-SHAFT score fires only once', async () => {
    const g = newGameAt('LOWER-SHAFT');
    g.start();
    const lamp = g.world.get('LAMP')!;
    expect(lamp, 'LAMP must exist').toBeDefined();
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    lamp.moveTo(raised);
    raised.moveTo(g.world.get('LOWER-SHAFT')!);
    await g.turn('look');
    const scoreAfterFirst = g.view().score;
    await g.turn('look');
    const scoreAfterSecond = g.view().score;
    expect(scoreAfterSecond).toBe(scoreAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Fresh-game basket state (CAGE-TOP=T by default — 1actions.zil:275).
// These tests do NOT call setBasketUp/setBasketDown; they exercise the real
// default game path to catch the CAGE-TOP init seam.
// ---------------------------------------------------------------------------

describe('CC3 — BASKET-F: fresh-game default CAGE-TOP=T (1actions.zil:275)', () => {
  it('fresh game lower basket: basket descends (CAGE-TOP=T → valid lower)', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    await g.turn('lower basket');
    // After lowering, RAISED-BASKET should be in LOWER-SHAFT.
    expect(raised.parent?.id).toBe('LOWER-SHAFT');
  });

  it('fresh game lower basket: emits "lowered to the bottom" (not a DUMMY)', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const out = await (await g.turn('lower basket')).output;
    expect(out).toContain('lowered to the bottom');
  });

  it('fresh game raise basket: emits DUMMY (basket already up by default)', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const out = await (await g.turn('raise basket')).output;
    expect(out).not.toContain('raised to the top');
  });

  it('fresh game raise basket: RAISED-BASKET stays in SHAFT-ROOM', async () => {
    const g = newGameAt('SHAFT-ROOM');
    g.start();
    giveLantern(g);
    const raised = g.world.get('RAISED-BASKET')!;
    expect(raised, 'RAISED-BASKET must exist').toBeDefined();
    await g.turn('raise basket');
    expect(raised.parent?.id).toBe('SHAFT-ROOM');
  });
});

// ---------------------------------------------------------------------------
// OPEN MACHINE output formatting — single-line "The lid opens, revealing X."
// ZIL 1actions.zil:2509–2511: sequential TELL calls concatenate with no newline.
// ---------------------------------------------------------------------------

describe('CC3 — MACHINE-F: open output on single line (1actions.zil:2509)', () => {
  it('open machine with one item: output is one line (no embedded newline)', async () => {
    const g = gameWithCoalInMachine();
    const out = await (await g.turn('open machine')).output;
    // The revealing line must not be split by a newline
    const revealLine = out.split('\n').find(l => l.includes('revealing'));
    expect(revealLine).toBeDefined();
    expect(revealLine).toContain('coal');
  });

  it('open machine with two items: both items on same line as "revealing"', async () => {
    const g = gameAtMachineRoom();
    const coal = g.world.get('COAL')!;
    const screw = g.world.get('SCREWDRIVER')!;
    const machine = g.world.get('MACHINE')!;
    expect(coal, 'COAL must exist').toBeDefined();
    expect(screw, 'SCREWDRIVER must exist').toBeDefined();
    coal.moveTo(machine);
    screw.moveTo(machine);
    const out = await (await g.turn('open machine')).output;
    const revealLine = out.split('\n').find(l => l.includes('revealing'));
    expect(revealLine).toBeDefined();
    expect(revealLine).toContain('coal');
    expect(revealLine).toContain('screwdriver');
  });
});
