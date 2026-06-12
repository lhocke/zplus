/**
 * CB4 — HACK-HACK family: V-KICK, V-PUSH, V-RUB, V-WAVE
 *
 * ZIL refs:
 *   gverbs.zil:760       V-KICK  — HACK-HACK "Kicking the "
 *   gverbs.zil:1070      V-PUSH  — HACK-HACK "Pushing the "
 *   gverbs.zil:1165      V-RUB   — HACK-HACK "Fiddling with the "
 *   gverbs.zil:1594-1595 V-WAVE  — HACK-HACK "Waving the "
 *   gverbs.zil:2024-2029 HACK-HACK — global-objects "isn't here!" + HO-HUM suffix
 *
 * Done-criteria (spec §4.5 + §11 CB4):
 *   - V-KICK normal:  "Kicking the <obj>" + HO-HUM suffix
 *   - V-PUSH normal:  "Pushing the <obj>" + HO-HUM suffix
 *   - V-RUB normal:   "Fiddling with the <obj>" + HO-HUM suffix
 *   - V-WAVE normal:  "Waving the <obj>" + HO-HUM suffix
 *   - All four: global-objects item → "The <obj> isn't here!"
 *   - WAVE global-objects branch routes through hackHackVerb (not inline copy)
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

interface Fix {
  world: World;
  room: Room;
  player: Actor;
  box: Thing;   // normal room object — HO-HUM branch
  wall: Thing;  // parentless (GLOBAL-OBJECTS) — "isn't here!" branch
}

function makeFixture(): Fix {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A plain room.', exits: [] });
  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const box = new Thing('BOX', 'wooden box', { synonyms: ['box'], adjectives: ['wooden'], ldesc: 'A box.' });
  box.moveTo(room);

  // Parentless → GLOBAL-OBJECTS member (no parent, not a room, not LOCAL-GLOBALS)
  const wall = new Thing('WALL', 'surrounding wall', { synonyms: ['wall'], adjectives: ['surrounding'], ldesc: 'Solid walls.' });
  // Do NOT moveTo anything

  const world = World.fromObjects([room, player, box, wall]);
  return { world, room, player, box, wall };
}

function ctx(fix: Fix, overrides: Partial<VerbContext> & { verb: string }): VerbContext {
  return { player: fix.player, here: fix.room, world: fix.world, ...overrides };
}

// ---------------------------------------------------------------------------
// V-KICK — gverbs.zil:760
// ---------------------------------------------------------------------------

describe('V-KICK', () => {
  it('normal object → "Kicking the <obj>" + HO-HUM suffix — gverbs.zil:760', () => {
    const fix = makeFixture();
    const r = executeVerb(
      ctx(fix, { verb: 'kick', action: 'V-KICK', dobj: fix.box, rng: { next: () => 0 } }),
      'V-KICK',
    );
    expect(r.output).toMatch(/^Kicking the wooden box/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });

  it('global-objects item → "The <obj> isn\'t here!" — gverbs.zil:2027', () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = executeVerb(
      ctx(fix, { verb: 'kick', action: 'V-KICK', dobj: fix.wall }),
      'V-KICK',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });
});

// ---------------------------------------------------------------------------
// V-PUSH — gverbs.zil:1070
// ---------------------------------------------------------------------------

describe('V-PUSH', () => {
  it('normal object → "Pushing the <obj>" + HO-HUM suffix — gverbs.zil:1070', () => {
    const fix = makeFixture();
    const r = executeVerb(
      ctx(fix, { verb: 'push', action: 'V-PUSH', dobj: fix.box, rng: { next: () => 1 } }),
      'V-PUSH',
    );
    expect(r.output).toMatch(/^Pushing the wooden box/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });

  it('global-objects item → "The <obj> isn\'t here!" — gverbs.zil:2027', () => {
    const fix = makeFixture();
    const r = executeVerb(
      ctx(fix, { verb: 'push', action: 'V-PUSH', dobj: fix.wall }),
      'V-PUSH',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });
});

// ---------------------------------------------------------------------------
// V-RUB — gverbs.zil:1165
// ---------------------------------------------------------------------------

describe('V-RUB', () => {
  it('normal object → "Fiddling with the <obj>" + HO-HUM suffix — gverbs.zil:1165', () => {
    const fix = makeFixture();
    const r = executeVerb(
      ctx(fix, { verb: 'rub', action: 'V-RUB', dobj: fix.box, rng: { next: () => 2 } }),
      'V-RUB',
    );
    expect(r.output).toMatch(/^Fiddling with the wooden box/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });

  it('global-objects item → "The <obj> isn\'t here!" — gverbs.zil:2027', () => {
    const fix = makeFixture();
    const r = executeVerb(
      ctx(fix, { verb: 'rub', action: 'V-RUB', dobj: fix.wall }),
      'V-RUB',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });
});

// ---------------------------------------------------------------------------
// V-WAVE — gverbs.zil:1594-1595 (uses hackHackVerb, not an inline copy)
// ZIL: HACK-HACK "Waving the "; same GLOBAL-OBJECTS branch as RAISE/LOWER/KICK/PUSH/RUB.
// ---------------------------------------------------------------------------

describe('V-WAVE', () => {
  it('normal object → "Waving the <obj>" + HO-HUM suffix — gverbs.zil:1594', () => {
    const fix = makeFixture();
    const r = executeVerb(
      ctx(fix, { verb: 'wave', action: 'V-WAVE', dobj: fix.box, rng: { next: () => 0 } }),
      'V-WAVE',
    );
    expect(r.output).toMatch(/^Waving the wooden box/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });

  it('global-objects item → "The <obj> isn\'t here!" — gverbs.zil:2025-2027', () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = executeVerb(
      ctx(fix, { verb: 'wave', action: 'V-WAVE', dobj: fix.wall }),
      'V-WAVE',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });
});
