/**
 * T4 repair — V-LOOK-UNDER / V-LOOK-BEHIND / V-LOOK-ON fall-through
 *
 * ZIL: gverbs.zil:862-900
 *   V-LOOK-BEHIND  → "There is nothing behind the <PRSO>." (:863)
 *   V-LOOK-ON      → SURFACEBIT? look-inside : "Look on a <PRSO>???" (:892-897)
 *   V-LOOK-UNDER   → "There is nothing but dust there." (:900)
 *
 * These actions are DISTINCT from V-LOOK-INSIDE and V-EXAMINE; the ZIL
 * VERB? EXAMINE LOOK-INSIDE guards in ROBBER-FUNCTION and LARGE-BAG-F
 * correctly skip them (returning false), so they reach executeVerb.
 * Without dedicated ACTION_HANDLERS entries they would fall back to verbLook
 * and re-describe the room.
 *
 * Integration tests drive game.turn() with real parsed input (thief in room,
 * Invisible cleared so the object is accessible).
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap';
import { Flag } from '../../src/domain/flags';

// Set up a game with the thief visible in ROUND-ROOM with a lamp so it's lit.
function makeThiefGame() {
  const g = createGame({ startRoom: 'ROUND-ROOM' });
  g.start();
  const w = (g as unknown as { world: { get(id: string): unknown } }).world;
  type Obj = { set(f: Flag): void; clear(f: Flag): void; moveTo(d: unknown): void };
  const lamp   = w.get('LAMP')   as Obj | undefined;
  const player = w.get('PLAYER') as Obj | undefined;
  const thief  = w.get('THIEF')  as Obj | undefined;
  // Light the room by giving the player a lit lamp.
  if (lamp && player) {
    (lamp as Obj).moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
  }
  // Clear INVISIBLE so the thief is a valid parse target.
  thief?.clear(Flag.Invisible);
  return g;
}

// Set up a game where the LARGE-BAG (child of THIEF) is accessible in the room.
function makeBagGame() {
  const g = createGame({ startRoom: 'ROUND-ROOM' });
  g.start();
  const w = (g as unknown as { world: { get(id: string): unknown } }).world;
  type Obj = { set(f: Flag): void; clear(f: Flag): void; moveTo(d: unknown): void };
  const lamp   = w.get('LAMP')   as Obj | undefined;
  const player = w.get('PLAYER') as Obj | undefined;
  const thief  = w.get('THIEF')  as Obj | undefined;
  const bag    = w.get('LARGE-BAG') as Obj | undefined;
  if (lamp && player) {
    (lamp as Obj).moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
  }
  // Thief visible in this room; bag visible too.
  thief?.clear(Flag.Invisible);
  bag?.clear(Flag.Invisible);
  return g;
}

// ---------------------------------------------------------------------------
// look under <obj> — gverbs.zil:899-900
// ---------------------------------------------------------------------------

describe('look under thief — V-LOOK-UNDER (integration)', () => {
  it('emits "There is nothing but dust there." (verbatim dfrotz)', () => {
    const g = makeThiefGame();
    const r = g.turn('look under thief');
    expect(r.output).toBe('There is nothing but dust there.');
  });

  it('does NOT re-describe the room', () => {
    const g = makeThiefGame();
    const r = g.turn('look under thief');
    // Room description would contain "Round Room" or the ldesc text.
    expect(r.output).not.toMatch(/Round Room|ROUND-ROOM/i);
  });
});

describe('look under bag — V-LOOK-UNDER (integration)', () => {
  it('emits "There is nothing but dust there." (verbatim dfrotz)', () => {
    const g = makeBagGame();
    const r = g.turn('look under bag');
    expect(r.output).toBe('There is nothing but dust there.');
  });
});

// ---------------------------------------------------------------------------
// look behind <obj> — gverbs.zil:862-863
// ---------------------------------------------------------------------------

describe('look behind thief — V-LOOK-BEHIND (integration)', () => {
  it('emits "There is nothing behind the thief." (verbatim dfrotz)', () => {
    const g = makeThiefGame();
    const r = g.turn('look behind thief');
    expect(r.output).toBe('There is nothing behind the thief.');
  });

  it('does NOT re-describe the room', () => {
    const g = makeThiefGame();
    const r = g.turn('look behind thief');
    expect(r.output).not.toMatch(/Round Room|ROUND-ROOM/i);
  });
});

describe('look behind bag — V-LOOK-BEHIND (integration)', () => {
  it('emits the correct "nothing behind" message for bag desc', () => {
    const g = makeBagGame();
    const r = g.turn('look behind bag');
    // The desc for LARGE-BAG — check it's the behind response pattern, not room.
    expect(r.output).toMatch(/There is nothing behind the .+\./);
  });
});

// ---------------------------------------------------------------------------
// look on <obj> — gverbs.zil:892-897 (no SURFACEBIT → "Look on a <PRSO>???")
// ---------------------------------------------------------------------------

describe('look on thief — V-LOOK-ON (integration)', () => {
  it('emits "Look on a thief???" (verbatim dfrotz — thief lacks SURFACEBIT)', () => {
    const g = makeThiefGame();
    const r = g.turn('look on thief');
    expect(r.output).toBe('Look on a thief???');
  });

  it('does NOT re-describe the room', () => {
    const g = makeThiefGame();
    const r = g.turn('look on thief');
    expect(r.output).not.toMatch(/Round Room|ROUND-ROOM/i);
  });
});

describe('look on bag — V-LOOK-ON (integration)', () => {
  it('emits the "Look on a ???" message for bag (no SURFACEBIT)', () => {
    const g = makeBagGame();
    const r = g.turn('look on bag');
    // LARGE-BAG has no SURFACEBIT, so this should be the not-a-surface response.
    expect(r.output).toMatch(/Look on a .+\?\?\?/);
  });
});
