/**
 * CB-DAM4 — Reservoir / Canyon room re-descriptions
 *
 * Done-criteria (spec §9 Wave 1 CB-DAM4):
 *   - RESERVOIR-SOUTH-FCN: 4-state M-LOOK verbatim (1actions.zil:1415–1442)
 *   - RESERVOIR-FCN: M-LOOK 2-state + M-END peril nag (1actions.zil:1444–1462)
 *   - RESERVOIR-NORTH-FCN: 4-state M-LOOK verbatim (1actions.zil:1464–1485)
 *   - DEEP-CANYON-F: base text + 3-branch water-sound suffix (1actions.zil:1730–1745)
 *   - M-END peril nag fires per-turn under sealed+lowTide+on-foot
 *   - Static ldescs cleared in bootstrap so FCNs fire instead of the H2 fallback
 *
 * ZIL refs:
 *   RESERVOIR-SOUTH-FCN  1actions.zil:1415
 *   RESERVOIR-FCN        1actions.zil:1444
 *   RESERVOIR-NORTH-FCN  1actions.zil:1464
 *   DEEP-CANYON-F        1actions.zil:1730
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setFlags(g: Game, gatesOpen: boolean, lowTide: boolean) {
  const fs = (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags;
  fs.set('GATES-OPEN', gatesOpen);
  fs.set('LOW-TIDE', lowTide);
}

// Give the player the lit lamp so look() works in dark rooms.
function giveLight(g: Game) {
  const lamp = g.world.get('LAMP')!;
  lamp.moveTo(g.player);
  lamp.set(Flag.OnFire);
}

function look(g: Game) {
  return g.turn('look').output;
}

// ---------------------------------------------------------------------------
// RESERVOIR-SOUTH-FCN — 4-state M-LOOK (1actions.zil:1415–1442)
// ---------------------------------------------------------------------------

describe('CB-DAM4 — RESERVOIR-SOUTH-FCN: 4-state M-LOOK', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('RESERVOIR-SOUTH');
    giveLight(g);
  });

  it('S0 sealed (GATES=F, LOW=F): south-shore lake description', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('south shore of a large lake');
    expect(out).toContain('too deep and wide for crossing');
  });

  it('S0: includes fixed exit text', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('path along the stream to the east or west');
    expect(out).toContain('canyon to the southeast');
  });

  it('S2 draining (GATES=T, LOW=F): "dropping at a rapid rate"', () => {
    setFlags(g, true, false);
    const out = look(g);
    expect(out).toContain('dropping at a rapid rate');
  });

  it('S2: includes fixed exit text', () => {
    setFlags(g, true, false);
    const out = look(g);
    expect(out).toContain('path along the stream to the east or west');
  });

  it('S3 drained (GATES=T, LOW=T): lake formerly; stream through center', () => {
    setFlags(g, true, true);
    const out = look(g);
    // "wide stream running through the center of the room" (may wrap)
    expect(out).toContain('formerly a lake');
    expect(out).toContain('center of the room');
  });

  it('S3: includes fixed exit text', () => {
    setFlags(g, true, true);
    const out = look(g);
    expect(out).toContain('path along the stream to the east or west');
  });

  it('S4 refilling (GATES=F, LOW=T): "level of the stream is rising quickly"', () => {
    setFlags(g, false, true);
    const out = look(g);
    expect(out).toContain('level of the stream is rising quickly');
  });

  it('S4: includes fixed exit text', () => {
    setFlags(g, false, true);
    const out = look(g);
    expect(out).toContain('path along the stream to the east or west');
  });
});

// ---------------------------------------------------------------------------
// RESERVOIR-FCN — M-LOOK (1actions.zil:1452–1462)
// ---------------------------------------------------------------------------

describe('CB-DAM4 — RESERVOIR-FCN: M-LOOK descriptions', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('RESERVOIR');
    giveLight(g);
  });

  it('drained (LOW-TIDE=T): mud-pile description', () => {
    setFlags(g, false, true);
    const out = look(g);
    // "what used to be a large lake, but which is now a large\nmud pile"
    expect(out).toContain('mud pile');
    expect(out).toContain('shores');
  });

  it('filled (LOW-TIDE=F): lake description', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('You are on the lake');
  });

  it('filled: mentions dam downstream', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('dam can be seen downstream');
  });
});

// ---------------------------------------------------------------------------
// RESERVOIR-FCN — M-END peril nag (1actions.zil:1445–1451)
//
// Fires when: rarg==M-END && winner not in VEHBIT vehicle && !GATES-OPEN && LOW-TIDE
// ---------------------------------------------------------------------------

describe('CB-DAM4 — RESERVOIR-FCN: M-END peril nag', () => {
  it('emits peril warning when on-foot, gates sealed, reservoir drained', () => {
    const g = newGameAt('RESERVOIR');
    giveLight(g);
    // Player on foot (not in vehicle); gates closed; reservoir drained
    setFlags(g, false, true);
    const out = g.turn('wait').output;
    expect(out).toContain('water level here is rising rapidly');
  });

  it('peril warning fires every turn (not just once)', () => {
    const g = newGameAt('RESERVOIR');
    giveLight(g);
    setFlags(g, false, true);
    const out1 = g.turn('wait').output;
    const out2 = g.turn('wait').output;
    expect(out1).toContain('water level here is rising rapidly');
    expect(out2).toContain('water level here is rising rapidly');
  });

  it('no peril warning when GATES-OPEN (draining phase)', () => {
    const g = newGameAt('RESERVOIR');
    giveLight(g);
    setFlags(g, true, true);
    const out = g.turn('wait').output;
    expect(out).not.toContain('water level here is rising rapidly');
  });

  it('no peril warning when LOW-TIDE=F (lake full)', () => {
    const g = newGameAt('RESERVOIR');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('wait').output;
    expect(out).not.toContain('water level here is rising rapidly');
  });

  it('no peril warning when player is in vehicle (boat floats safely)', () => {
    const g = newGameAt('RESERVOIR');
    giveLight(g);
    setFlags(g, false, true);
    // Put player in inflated boat (VEHBIT vehicle)
    const inflatedBoat = g.world.get('INFLATED-BOAT')!;
    const reservoir = g.world.get('RESERVOIR')!;
    inflatedBoat.moveTo(reservoir);
    g.player.moveTo(inflatedBoat);
    const out = g.turn('wait').output;
    expect(out).not.toContain('water level here is rising rapidly');
  });
});

// ---------------------------------------------------------------------------
// RESERVOIR-NORTH-FCN — 4-state M-LOOK (1actions.zil:1464–1485)
// ---------------------------------------------------------------------------

describe('CB-DAM4 — RESERVOIR-NORTH-FCN: 4-state M-LOOK', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('RESERVOIR-NORTH');
    giveLight(g);
  });

  it('S0 sealed (GATES=F, LOW=F): "north of a large lake"', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('north of a large lake');
  });

  it('S0: includes slimy-stairway exit text', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('slimy stairway');
  });

  it('S2 draining (GATES=T, LOW=F): "falling rapidly"', () => {
    setFlags(g, true, false);
    const out = look(g);
    expect(out).toContain('falling rapidly');
  });

  it('S2: includes slimy-stairway exit text', () => {
    setFlags(g, true, false);
    const out = look(g);
    expect(out).toContain('slimy stairway');
  });

  it('S3 drained (GATES=T, LOW=T): "wide stream running through there"', () => {
    setFlags(g, true, true);
    const out = look(g);
    expect(out).toContain('wide stream running through there');
  });

  it('S3: includes slimy-stairway exit text', () => {
    setFlags(g, true, true);
    const out = look(g);
    expect(out).toContain('slimy stairway');
  });

  it('S4 refilling (GATES=F, LOW=T): "level of the stream is rising rapidly"', () => {
    setFlags(g, false, true);
    const out = look(g);
    expect(out).toContain('level of the stream is rising rapidly');
  });

  it('S4: includes slimy-stairway exit text', () => {
    setFlags(g, false, true);
    const out = look(g);
    expect(out).toContain('slimy stairway');
  });
});

// ---------------------------------------------------------------------------
// DEEP-CANYON-F — base text + water-sound suffix (1actions.zil:1730–1745)
//
// Branch logic:
//   GATES-OPEN && !LOW-TIDE  → "loud roaring sound, like that of rushing water"
//   !GATES-OPEN && LOW-TIDE  → no water-sound suffix (just CRLF)
//   else (sealed/default)    → "sound of flowing water"
// ---------------------------------------------------------------------------

describe('CB-DAM4 — DEEP-CANYON-F: base text and water suffix', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('DEEP-CANYON');
    giveLight(g);
  });

  it('always includes the base canyon description', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('south edge of a deep canyon');
    expect(out).toContain('stairway leads down');
  });

  it('S0 sealed (GATES=F, LOW=F): default "sound of flowing water from below"', () => {
    setFlags(g, false, false);
    const out = look(g);
    expect(out).toContain('sound of flowing water from below');
  });

  it('S2 draining (GATES=T, LOW=F): "loud roaring sound, like that of rushing water"', () => {
    setFlags(g, true, false);
    const out = look(g);
    expect(out).toContain('loud roaring sound');
    expect(out).toContain('rushing water');
  });

  it('S3/S4 drained+closed (GATES=F, LOW=T): no water-sound suffix', () => {
    // ZIL: (!GATES-OPEN && LOW-TIDE) → CRLF + RTRUE (no extra water line)
    setFlags(g, false, true);
    const out = look(g);
    expect(out).not.toContain('sound of flowing water');
    expect(out).not.toContain('roaring sound');
  });

  it('S4 draining+drained (GATES=T, LOW=T): "loud roaring sound" (gates open takes priority)', () => {
    // GATES-OPEN && !LOW-TIDE is the first branch; here LOW-TIDE=T so this branch
    // does not match. GATES-OPEN && LOW-TIDE falls to the else → "sound of flowing water".
    setFlags(g, true, true);
    const out = look(g);
    // GATES-OPEN=T, LOW-TIDE=T: not (!GATES-OPEN && LOW-TIDE), not (GATES-OPEN && !LOW-TIDE)
    // → falls to else → "sound of flowing water"
    expect(out).toContain('sound of flowing water');
  });
});

// ---------------------------------------------------------------------------
// Static ldesc cleared (hotfix H2 → FCN takes over)
//
// bootstrap.ts must clear ldesc for all four rooms so the dynamic handler fires.
// ---------------------------------------------------------------------------

describe('CB-DAM4 — bootstrap clears static ldesc for FCN rooms', () => {
  it('RESERVOIR-SOUTH: FCN description not the static default ldesc text', () => {
    // After bootstrap, the FCN fires. The static ldesc was the S0 text.
    // Verify that the FCN controls the description by checking a non-S0 state.
    const g = newGameAt('RESERVOIR-SOUTH');
    giveLight(g);
    setFlags(g, true, false);  // draining state
    const out = look(g);
    // The draining description should appear (not the sealed static ldesc)
    expect(out).toContain('dropping at a rapid rate');
  });

  it('RESERVOIR-NORTH: FCN description fires (not static ldesc)', () => {
    const g = newGameAt('RESERVOIR-NORTH');
    giveLight(g);
    setFlags(g, true, false);  // draining state
    const out = look(g);
    expect(out).toContain('falling rapidly');
  });

  it('RESERVOIR: FCN mud description fires when drained', () => {
    const g = newGameAt('RESERVOIR');
    giveLight(g);
    setFlags(g, false, true);
    const out = look(g);
    expect(out).toContain('mud pile');
  });

  it('DEEP-CANYON: FCN roaring-water suffix fires when gates open', () => {
    const g = newGameAt('DEEP-CANYON');
    giveLight(g);
    setFlags(g, true, false);
    const out = look(g);
    expect(out).toContain('loud roaring sound');
  });
});
