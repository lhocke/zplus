/**
 * CB-SAND — SAND-FUNCTION dig counter + scarab reveal
 *
 * Done-criteria (spec §9 Wave 3 CB-SAND):
 *   - NM-J: BEACH-DIG boundaries: inits -1, increments before branch
 *   - Digs 1/2/3 → BDIGS[0/1/2] progress messages
 *   - Dig 4 (BEACH-DIG == 3) → scarab visible, THIS-IS-IT(SCARAB)
 *   - Dig 5 (BEACH-DIG > 3) → fatal collapse, BEACH-DIG reset to -1
 *   - Collapse re-hides scarab if still in HERE
 *   - Collapse does NOT re-hide scarab taken by player
 *   - Verb guard: non-shovel iobj falls through
 *
 * ZIL source refs:
 *   SAND-FUNCTION   1actions.zil:2855–2869
 *   BDIGS           1actions.zil:2871–2874
 *   BEACH-DIG       1actions.zil:2851
 *   SCARAB          1dungeon.zil:871
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Access beachDig directly from Game private field. */
function beachDig(g: ReturnType<typeof newGameAt>): number {
  return (g as unknown as { beachDig: number }).beachDig;
}

/** Set up: player in SANDY-CAVE (lit), shovel in hand, scarab in room (reset state). */
function setupCave(overrideDig?: number) {
  const g = newGameAt('SANDY-CAVE');

  // SANDY-CAVE is unlit by default; set Flag.On so the parser can see room objects
  const cave = g.world.get('SANDY-CAVE')!;
  cave.set(Flag.On);

  const shovel = g.world.get('SHOVEL')!;
  const scarab = g.world.get('SCARAB')!;

  shovel.moveTo(g.player);
  // Scarab starts invisible in SANDY-CAVE — ensure it's there
  scarab.moveTo(cave);
  scarab.set(Flag.Invisible);

  if (overrideDig !== undefined) {
    (g as unknown as { beachDig: number }).beachDig = overrideDig;
  }
  return g;
}

// ---------------------------------------------------------------------------
// NM-J — BEACH-DIG counter: digs 1/2/3 print BDIGS[0/1/2]
// (1actions.zil:2857–2869, BDIGS table :2871–2874)
// ---------------------------------------------------------------------------

describe('CB-SAND — BDIGS progress messages (1actions.zil:2855)', () => {
  it('dig #1 (BEACH-DIG 0): "digging a hole here"', () => {
    const g = setupCave();
    const out = g.turn('dig sand with shovel').output;
    expect(out).toContain('digging a hole here');
    expect(beachDig(g)).toBe(0);
  });

  it('dig #2 (BEACH-DIG 1): "hole is getting deeper"', () => {
    const g = setupCave(0);   // pre-set to 0; next dig → 1
    const out = g.turn('dig sand with shovel').output;
    expect(out).toContain('getting deeper');
    expect(beachDig(g)).toBe(1);
  });

  it('dig #3 (BEACH-DIG 2): "surrounded by a wall of sand"', () => {
    const g = setupCave(1);   // pre-set to 1; next dig → 2
    const out = g.turn('dig sand with shovel').output;
    expect(out).toContain('wall of sand');
    expect(beachDig(g)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// NM-J — dig #4: scarab revealed (BEACH-DIG == 3, 1actions.zil:2862–2867)
// ---------------------------------------------------------------------------

describe('CB-SAND — dig #4 reveals scarab (1actions.zil:2862)', () => {
  it('BEACH-DIG reaches 3 on dig #4', () => {
    const g = setupCave(2);   // pre-set to 2; next dig → 3
    g.turn('dig sand with shovel');
    expect(beachDig(g)).toBe(3);
  });

  it('scarab INVISIBLE cleared on dig #4', () => {
    const g = setupCave(2);
    expect(g.world.get('SCARAB')!.has(Flag.Invisible)).toBe(true);
    g.turn('dig sand with shovel');
    expect(g.world.get('SCARAB')!.has(Flag.Invisible)).toBe(false);
  });

  it('dig #4 prints scarab-reveal message', () => {
    const g = setupCave(2);
    const out = g.turn('dig sand with shovel').output;
    expect(out).toContain('scarab');
  });

  it('dig #4 when scarab already visible does nothing extra (FSET? guard)', () => {
    // 1actions.zil:2863: <COND (<FSET? ,SCARAB ,INVISIBLE> ...)> — only if still invisible
    const g = setupCave(2);
    const scarab = g.world.get('SCARAB')!;
    scarab.clear(Flag.Invisible);  // already visible
    // Should not crash; no reveal message expected
    const out = g.turn('dig sand with shovel').output;
    expect(out).not.toContain('You can see a scarab');
    expect(beachDig(g)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// NM-J — dig #5: fatal collapse (BEACH-DIG > 3, 1actions.zil:2858–2861)
// ---------------------------------------------------------------------------

describe('CB-SAND — dig #5 fatal collapse (1actions.zil:2858)', () => {
  it('dig #5 (BEACH-DIG > 3) outputs the smothering death message', () => {
    const g = setupCave(3);   // pre-set to 3; next dig → 4 (> 3 → death)
    const out = g.turn('dig sand with shovel').output;
    expect(out).toContain('smothering');
  });

  it('BEACH-DIG resets to -1 after fatal collapse', () => {
    const g = setupCave(3);
    g.turn('dig sand with shovel');
    expect(beachDig(g)).toBe(-1);
  });

  it('scarab re-hidden when still in room at dig #5', () => {
    // <AND <IN? ,SCARAB ,HERE> <FSET ,SCARAB ,INVISIBLE>> — :2860
    const g = setupCave(3);
    const scarab = g.world.get('SCARAB')!;
    const cave = g.world.get('SANDY-CAVE')!;
    // Reveal it first so we can verify it gets re-hidden
    scarab.clear(Flag.Invisible);
    scarab.moveTo(cave);

    g.turn('dig sand with shovel');
    expect(scarab.has(Flag.Invisible)).toBe(true);
  });

  it('scarab NOT re-hidden when player is carrying it at dig #5', () => {
    // <IN? ,SCARAB ,HERE> is false when player carries scarab — :2860
    const g = setupCave(3);
    const scarab = g.world.get('SCARAB')!;
    scarab.clear(Flag.Invisible);
    scarab.moveTo(g.player);   // player took it

    g.turn('dig sand with shovel');
    // Scarab is not in HERE, so the re-hide guard must NOT trigger
    expect(scarab.has(Flag.Invisible)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NM-J — verb guard: non-shovel falls through to V-DIG
// ---------------------------------------------------------------------------

describe('CB-SAND — non-shovel does not trigger SAND-FUNCTION (1actions.zil:2856)', () => {
  it('dig with hands falls through (no BDIGS message)', () => {
    const g = setupCave();
    // Shovel not in inventory; bare "dig sand" → V-DIG fallback
    const shovel = g.world.get('SHOVEL')!;
    shovel.moveTo(g.world.get('SANDY-CAVE')!);   // leave shovel in room, not hand

    const out = g.turn('dig sand').output;
    // V-DIG fallback for hands: "Digging with the pair of hands is slow and tedious."
    // or "There's no reason to be digging here." — neither is a BDIGS message
    expect(out).not.toContain('digging a hole here');
    expect(out).not.toContain('scarab');
    expect(beachDig(g)).toBe(-1);   // counter unchanged
  });
});
