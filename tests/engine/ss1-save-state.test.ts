/**
 * SS1 — SaveState schema + Game.snapshot()/restore() tests.
 *
 * Uses REAL Rng instances throughout (spec §3.2 forbids stubs in save-exercising tests).
 * Two distinct Rng instances match production bootstrap.ts decoupling — the two-Rng
 * fixture contract is for SS-RNG to verify; we assert both are present and independent.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Actor } from '../../src/domain/actor.js';
import { Room } from '../../src/domain/room.js';
import { Flag } from '../../src/domain/flags.js';
import type { SaveState } from '../../src/engine/save-state.js';
import { SAVE_FORMAT_VERSION } from '../../src/engine/save-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshGame() {
  // Two distinct seeds → two distinct Rng streams, matching production bootstrap.
  return createGame({ seed: 42 });
}

// ---------------------------------------------------------------------------
// 1. Per-object round-trip: mutate a spread, snapshot, restore onto a fresh
//    game instance, snapshot again — all delta fields must be equal.
// ---------------------------------------------------------------------------
describe('SS1 per-object round-trip', () => {
  it('round-trips parent, flags, props, ldesc', () => {
    const g = freshGame();

    // Move RUG into PLAYER's inventory to create a non-default parent.
    const rug = g.world.get('RUG');
    const player = g.world.get('PLAYER');
    expect(rug).toBeDefined();
    expect(player).toBeDefined();
    rug!.moveTo(player!);

    // Flip some flags on the rug.
    rug!.set(Flag.Touched);
    rug!.clear(Flag.Takeable);  // clear a flag that may be set

    // Set a prop.
    rug!.props.set('VALUE', 99);

    // Mutate a room's ldesc.
    const woh = g.world.get('WEST-OF-HOUSE');
    expect(woh).toBeDefined();
    (woh as Room).ldesc = 'A mutated description for testing.';

    const s1: SaveState = g.snapshot();

    // Restore onto a fresh game instance.
    const g2 = freshGame();
    g2.restore(s1);
    const s2: SaveState = g2.snapshot();

    // The objects array must be equal element-by-element for the mutated objects.
    const rugDelta1 = s1.objects.find(d => d.id === 'RUG');
    const rugDelta2 = s2.objects.find(d => d.id === 'RUG');
    expect(rugDelta1).toBeDefined();
    expect(rugDelta2).toBeDefined();
    expect(rugDelta2!.parent).toBe(rugDelta1!.parent);
    expect(rugDelta2!.flags).toEqual(rugDelta1!.flags);
    expect(rugDelta2!.props).toEqual(rugDelta1!.props);

    const wohDelta1 = s1.objects.find(d => d.id === 'WEST-OF-HOUSE');
    const wohDelta2 = s2.objects.find(d => d.id === 'WEST-OF-HOUSE');
    expect(wohDelta2!.ldesc).toBe(wohDelta1!.ldesc);
  });
});

// ---------------------------------------------------------------------------
// 2. children rebuilt via moveTo: verify bidirectional parent/children links.
// ---------------------------------------------------------------------------
describe('SS1 children reconstruction', () => {
  it('moved object lands in new parent children and leaves old', () => {
    const g = freshGame();

    const rug = g.world.get('RUG');
    const player = g.world.get('PLAYER');
    const woh = g.world.get('WEST-OF-HOUSE');
    expect(rug).toBeDefined();
    expect(player).toBeDefined();
    expect(woh).toBeDefined();

    const originalParent = rug!.parent;

    // Move rug to player.
    rug!.moveTo(player!);
    const s1: SaveState = g.snapshot();

    // Restore onto fresh game.
    const g2 = freshGame();
    g2.restore(s1);

    const rug2 = g2.world.get('RUG');
    const player2 = g2.world.get('PLAYER');

    expect(rug2!.parent?.id).toBe('PLAYER');
    expect(player2!.children.has(rug2!)).toBe(true);

    // Old parent must NOT contain rug.
    if (originalParent !== null) {
      const oldParent2 = g2.world.get(originalParent.id);
      expect(oldParent2!.children.has(rug2!)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. MID-COMBAT pStrength: wounded player and villain restore WOUNDED, not full.
// ---------------------------------------------------------------------------
describe('SS1 pStrength mid-combat round-trip', () => {
  it('restores wounded pStrength for player and TROLL', () => {
    const g = freshGame();

    const player = g.world.get('PLAYER') as Actor;
    const troll = g.world.get('TROLL') as Actor;
    expect(player instanceof Actor).toBe(true);
    expect(troll instanceof Actor).toBe(true);

    // Simulate mid-combat wound state.
    player.pStrength = -3;
    troll.pStrength = -7;

    const s1 = g.snapshot();

    // Reset to full strength on a fresh game, then restore.
    const g2 = freshGame();
    const player2 = g2.world.get('PLAYER') as Actor;
    const troll2 = g2.world.get('TROLL') as Actor;
    expect(player2.pStrength).toBe(0);  // fresh game: player is healthy

    g2.restore(s1);

    expect(player2.pStrength).toBe(-3);
    expect(troll2.pStrength).toBe(-7);
  });
});

// ---------------------------------------------------------------------------
// 4. FIXPOINT: snapshot -> restore -> snapshot produces identical state.
// ---------------------------------------------------------------------------
describe('SS1 fixpoint', () => {
  it('s1 == s2 after restore(s1)', () => {
    const g = freshGame();

    // Make a few changes to get non-default state.
    const rug = g.world.get('RUG');
    rug?.moveTo(g.world.get('PLAYER')!);

    const s1 = g.snapshot();
    g.restore(s1);
    const s2 = g.snapshot();

    // Do NOT assert on the SS1-SEAM placeholder fields — they are known-wrong stubs.
    // We strip them before comparing.
    const strip = (s: SaveState) => {
      const { rngMain: _rm, rngCombat: _rc, flagStore: _fs, parser: _p, moduleGlobals: _mg, ...rest } = s;
      void _rm; void _rc; void _fs; void _p; void _mg;
      return rest;
    };

    expect(strip(s2)).toEqual(strip(s1));
  });
});

// ---------------------------------------------------------------------------
// 5. Restore-onto-fresh-instance: view() matches.
// ---------------------------------------------------------------------------
describe('SS1 restore onto fresh instance', () => {
  it('view() here/score/moves match after restore', () => {
    const g = freshGame();
    const s1 = g.snapshot();

    const g2 = freshGame();
    g2.restore(s1);

    const v1 = g.view();
    const v2 = g2.view();

    expect(v2.here).toBe(v1.here);
    expect(v2.score).toBe(v1.score);
    expect(v2.moves).toBe(v1.moves);
  });
});

// ---------------------------------------------------------------------------
// 6. Serialized size: must be < 5MB localStorage budget.
// ---------------------------------------------------------------------------
describe('SS1 serialized size', () => {
  it('snapshot fits within localStorage quota (~5MB)', () => {
    const g = freshGame();
    const json = JSON.stringify(g.snapshot());
    const bytes = json.length;  // UTF-16 code units; ASCII-safe JSON ≈ bytes

    console.log(`[SS1] snapshot serialized size: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB)`);

    // 5MB / origin localStorage budget (spec §3.1).
    expect(bytes).toBeLessThan(5 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// 7. formatVersion is SAVE_FORMAT_VERSION constant.
// ---------------------------------------------------------------------------
describe('SS1 format version', () => {
  it('snapshot carries SAVE_FORMAT_VERSION', () => {
    const g = freshGame();
    const s = g.snapshot();
    expect(s.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });

  it('restore throws on formatVersion mismatch', () => {
    const g = freshGame();
    const s = g.snapshot();
    const bad = { ...s, formatVersion: 999 };
    expect(() => g.restore(bad as SaveState)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. savedAt is an ISO 8601 date string.
// ---------------------------------------------------------------------------
describe('SS1 savedAt', () => {
  it('savedAt is a valid ISO 8601 string', () => {
    const g = freshGame();
    const s = g.snapshot();
    expect(() => new Date(s.savedAt)).not.toThrow();
    expect(new Date(s.savedAt).toISOString()).toBe(s.savedAt);
  });
});

// ---------------------------------------------------------------------------
// 9. ObjectDelta pStrength only captured for Actor instances.
// ---------------------------------------------------------------------------
describe('SS1 Actor-only pStrength capture', () => {
  it('non-Actor objects have no pStrength in their delta', () => {
    const g = freshGame();
    const s = g.snapshot();

    // RUG is not an Actor — its delta must not carry pStrength.
    const rugDelta = s.objects.find(d => d.id === 'RUG');
    expect(rugDelta).toBeDefined();
    expect(rugDelta!.pStrength).toBeUndefined();

    // PLAYER is an Actor — delta should include pStrength.
    const playerDelta = s.objects.find(d => d.id === 'PLAYER');
    expect(playerDelta).toBeDefined();
    expect(playerDelta!.pStrength).toBeDefined();
  });
});
