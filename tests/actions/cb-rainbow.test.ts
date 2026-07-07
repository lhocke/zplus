/**
 * CB-RAINBOW — SCEPTRE-FUNCTION + RAINBOW-FCN + pot-of-gold
 *
 * Done-criteria (spec §9 Wave 3 CB-RAINBOW):
 *   - Wave at ARAGAIN-FALLS / END-OF-RAINBOW toggles RAINBOW-FLAG
 *   - Pot-of-gold reveal fires only at END-OF-RAINBOW (NM-K)
 *   - Wave while on ON-RAINBOW is fatal (NM-K)
 *   - Wave elsewhere: "dazzling display"
 *   - Waving again (RAINBOW-FLAG=true) dismisses rainbow, ROBs ON-RAINBOW items,
 *     clears RAINBOW-FLAG
 *   - RAINBOW-FCN CROSS: RAINBOW-FLAG=false → "Can you walk on water vapor?"
 *   - RAINBOW-FCN CROSS: RAINBOW-FLAG=true + ARAGAIN-FALLS → moves player to END-OF-RAINBOW
 *   - RAINBOW-FCN CROSS: RAINBOW-FLAG=true + END-OF-RAINBOW → moves player to ARAGAIN-FALLS
 *   - RAINBOW-FCN CROSS: from CANYON-VIEW → "From here?!?"
 *   - RAINBOW-FCN LOOK-UNDER → "Frigid River flows under the rainbow"
 *   - V-CROSS fall-through: "You can't cross that!"
 *   - Falls description already tested in cb-river-obj; not re-tested here
 *
 * ZIL refs:
 *   SCEPTRE-FUNCTION   1actions.zil:2592–2619
 *   RAINBOW-FCN        1actions.zil:2634–2650
 *   FALLS-ROOM         1actions.zil:2621–2633  (tested in cb-river-obj)
 *   POT-OF-GOLD        1dungeon.zil line w/ INVISIBLE flag
 *   RAINBOW-FLAG       1dungeon.zil:1232
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { FlagStore } from '../../src/engine/flag-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flags(g: ReturnType<typeof newGameAt>) {
  return (g as unknown as { flags: FlagStore }).flags;
}

function setRainbowFlag(g: ReturnType<typeof newGameAt>, value: boolean) {
  flags(g).set('RAINBOW-FLAG', value);
}

function getRainbowFlag(g: ReturnType<typeof newGameAt>): boolean {
  return flags(g).get('RAINBOW-FLAG');
}

/** Give the player the sceptre and lamp; ensure room is lit. */
function setupFalls(roomId: string) {
  const g = newGameAt(roomId);
  const sceptre = g.world.get('SCEPTRE')!;
  const lamp = g.world.get('LAMP')!;
  sceptre.moveTo(g.player);
  lamp.moveTo(g.player);
  lamp.set(Flag.OnFire);
  return g;
}

// ---------------------------------------------------------------------------
// SCEPTRE-FUNCTION: wave at ARAGAIN-FALLS — rainbow solidifies
// 1actions.zil:2592–2605
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — SCEPTRE-FUNCTION wave at ARAGAIN-FALLS', () => {
  it('wave sceptre at ARAGAIN-FALLS sets RAINBOW-FLAG=true', async () => {
    const g = setupFalls('ARAGAIN-FALLS');
    expect(getRainbowFlag(g)).toBe(false);
    await g.turn('wave sceptre');
    expect(getRainbowFlag(g)).toBe(true);
  });

  it('wave sceptre prints the rainbow-becomes-solid message', async () => {
    const g = setupFalls('ARAGAIN-FALLS');
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).toContain('rainbow appears to become solid');
  });

  it('wave sceptre clears INVISIBLE on pot-of-gold (1actions.zil:2597)', async () => {
    const g = setupFalls('ARAGAIN-FALLS');
    const pot = g.world.get('POT-OF-GOLD')!;
    expect(pot.has(Flag.Invisible)).toBe(true);
    await g.turn('wave sceptre');
    expect(pot.has(Flag.Invisible)).toBe(false);
  });

  it('pot-of-gold reveal message does NOT appear when waving at ARAGAIN-FALLS (NM-K: only at END-OF-RAINBOW)', async () => {
    // :2601 — the pot-announce fires only if HERE == END-OF-RAINBOW
    const g = setupFalls('ARAGAIN-FALLS');
    const pot = g.world.get('POT-OF-GOLD')!;
    pot.moveTo(g.world.get('END-OF-RAINBOW')!);
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).not.toContain('shimmering pot of gold');
  });
});

// ---------------------------------------------------------------------------
// SCEPTRE-FUNCTION: wave at END-OF-RAINBOW — rainbow solidifies + pot reveal
// 1actions.zil:2592–2605, NM-K
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — SCEPTRE-FUNCTION wave at END-OF-RAINBOW (NM-K)', () => {
  it('wave sceptre at END-OF-RAINBOW sets RAINBOW-FLAG=true', async () => {
    const g = setupFalls('END-OF-RAINBOW');
    await g.turn('wave sceptre');
    expect(getRainbowFlag(g)).toBe(true);
  });

  it('pot-of-gold reveal message appears when waving at END-OF-RAINBOW with pot there', async () => {
    // :2601–2604 — COND: HERE==END-OF-RAINBOW AND pot-of-gold IN END-OF-RAINBOW
    const g = setupFalls('END-OF-RAINBOW');
    const pot = g.world.get('POT-OF-GOLD')!;
    pot.moveTo(g.world.get('END-OF-RAINBOW')!);
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).toContain('shimmering pot of gold');
  });

  it('pot-of-gold reveal message NOT shown if pot already taken (not in END-OF-RAINBOW)', async () => {
    const g = setupFalls('END-OF-RAINBOW');
    const pot = g.world.get('POT-OF-GOLD')!;
    pot.moveTo(g.player);  // player already has the pot
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).not.toContain('shimmering pot of gold');
  });
});

// ---------------------------------------------------------------------------
// SCEPTRE-FUNCTION: wave again (RAINBOW-FLAG=true) dismisses rainbow
// 1actions.zil:2606–2611
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — SCEPTRE-FUNCTION wave again dismisses rainbow (1actions.zil:2606)', () => {
  it('waving again (RAINBOW-FLAG=true) clears RAINBOW-FLAG', async () => {
    const g = setupFalls('ARAGAIN-FALLS');
    setRainbowFlag(g, true);
    await g.turn('wave sceptre');
    expect(getRainbowFlag(g)).toBe(false);
  });

  it('waving again prints the run-of-the-mill message', async () => {
    const g = setupFalls('ARAGAIN-FALLS');
    setRainbowFlag(g, true);
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).toContain('run-of-the-mill');
  });

  it('ROB ON-RAINBOW: items in ON-RAINBOW are moved to WALL on dismiss', async () => {
    // :2607 <ROB ,ON-RAINBOW ,WALL> — treasure on the rainbow gets swept off
    const g = setupFalls('ARAGAIN-FALLS');
    setRainbowFlag(g, true);
    // Put a treasure on the rainbow
    const diamond = g.world.get('DIAMOND')!;
    const onRainbow = g.world.get('ON-RAINBOW')!;
    diamond.moveTo(onRainbow);
    await g.turn('wave sceptre');
    // Diamond should now be in WALL (limbo), not ON-RAINBOW
    expect(diamond.parent?.id).toBe('WALL');
    expect(onRainbow.children.has(diamond)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCEPTRE-FUNCTION: wave on ON-RAINBOW is fatal (NM-K)
// 1actions.zil:2612–2616
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — wave on ON-RAINBOW is fatal (NM-K, 1actions.zil:2612)', () => {
  it('wave sceptre while on ON-RAINBOW triggers JIGS-UP', async () => {
    const g = setupFalls('ON-RAINBOW');
    const out = await (await g.turn('wave sceptre')).output;
    // JIGS-UP fires the death sequence
    expect(out).toContain('You have died');
  });

  it('wave on ON-RAINBOW emits the structural-integrity death message', async () => {
    const g = setupFalls('ON-RAINBOW');
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).toContain('water vapor');
  });

  it('wave on ON-RAINBOW clears RAINBOW-FLAG', async () => {
    // :2613 <SETG RAINBOW-FLAG <>> — rainbow collapses
    const g = setupFalls('ON-RAINBOW');
    setRainbowFlag(g, true);
    await g.turn('wave sceptre');
    expect(getRainbowFlag(g)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCEPTRE-FUNCTION: wave elsewhere → "dazzling display"
// 1actions.zil:2617–2619
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — SCEPTRE-FUNCTION wave elsewhere (1actions.zil:2617)', () => {
  it('wave sceptre in a non-rainbow room prints the dazzling-display message', async () => {
    const g = setupFalls('LIVING-ROOM');
    const out = await (await g.turn('wave sceptre')).output;
    expect(out).toContain('dazzling display');
  });

  it('wave sceptre elsewhere does not change RAINBOW-FLAG', async () => {
    const g = setupFalls('LIVING-ROOM');
    expect(getRainbowFlag(g)).toBe(false);
    await g.turn('wave sceptre');
    expect(getRainbowFlag(g)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RAINBOW-FCN: CROSS when RAINBOW-FLAG=false
// 1actions.zil:2646–2648
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — RAINBOW-FCN CROSS without solid rainbow (1actions.zil:2646)', () => {
  it('crossing without rainbow solid returns "walk on water vapor" message', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    // RAINBOW-FLAG defaults to false
    const out = await (await g.turn('cross rainbow')).output;
    expect(out).toContain('water vapor');
  });

  it('RAINBOW-FLAG stays false after attempted crossing', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    await g.turn('cross rainbow');
    expect(getRainbowFlag(g)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RAINBOW-FCN: CROSS from CANYON-VIEW → "From here?!?"
// 1actions.zil:2636–2638
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — RAINBOW-FCN CROSS from CANYON-VIEW (1actions.zil:2636)', () => {
  it('crossing rainbow from CANYON-VIEW prints "From here?!?"', async () => {
    const g = newGameAt('CANYON-VIEW');
    setRainbowFlag(g, true);
    const out = await (await g.turn('cross rainbow')).output;
    expect(out).toContain('From here');
  });

  it('CANYON-VIEW cross does not move the player', async () => {
    const g = newGameAt('CANYON-VIEW');
    setRainbowFlag(g, true);
    await g.turn('cross rainbow');
    expect(g.player.parent?.id).toBe('CANYON-VIEW');
  });
});

// ---------------------------------------------------------------------------
// RAINBOW-FCN: CROSS when RAINBOW-FLAG=true — teleport
// 1actions.zil:2639–2644
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — RAINBOW-FCN CROSS with solid rainbow (1actions.zil:2639)', () => {
  it('crossing from ARAGAIN-FALLS moves player to END-OF-RAINBOW', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    lamp.set(Flag.OnFire);
    setRainbowFlag(g, true);
    await g.turn('cross rainbow');
    // Player should be at END-OF-RAINBOW (possibly via ON-RAINBOW intermediate, but
    // GOTO END-OF-RAINBOW is the direct destination per :2641)
    expect(g.player.parent?.id).toBe('END-OF-RAINBOW');
  });

  it('crossing from END-OF-RAINBOW moves player to ARAGAIN-FALLS', async () => {
    const g = newGameAt('END-OF-RAINBOW');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    lamp.set(Flag.OnFire);
    setRainbowFlag(g, true);
    await g.turn('cross rainbow');
    expect(g.player.parent?.id).toBe('ARAGAIN-FALLS');
  });
});

// ---------------------------------------------------------------------------
// RAINBOW-FCN: LOOK-UNDER rainbow
// 1actions.zil:2649–2650
// Parser: verb='look', prep='UNDER' (syntax.json prep1 is uppercase)
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — RAINBOW-FCN LOOK-UNDER (1actions.zil:2649)', () => {
  it('look under rainbow prints "Frigid River flows under the rainbow"', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    const out = await (await g.turn('look under rainbow')).output;
    expect(out).toContain('Frigid River');
  });
});

// ---------------------------------------------------------------------------
// V-CROSS fall-through
// gverbs.zil:371–372
// ---------------------------------------------------------------------------

describe('CB-RAINBOW — V-CROSS fall-through (gverbs.zil:371)', () => {
  it("crossing a non-rainbow object returns \"You can't cross that!\"", async () => {
    const g = newGameAt('LIVING-ROOM');
    // "cross rug" — RUG exists in LIVING-ROOM but has no cross handler
    const out = await (await g.turn('cross rug')).output;
    expect(out).toContain("can't cross");
  });
});
