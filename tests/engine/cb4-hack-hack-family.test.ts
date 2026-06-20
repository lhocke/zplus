/**
 * CB4 — HACK-HACK family: V-KICK, V-PUSH, V-RUB, V-WAVE, V-RAISE, V-LOWER
 *
 * ZIL refs:
 *   gverbs.zil:760       V-KICK  — HACK-HACK "Kicking the "
 *   gverbs.zil:1070      V-PUSH  — HACK-HACK "Pushing the "
 *   gverbs.zil:1165      V-RUB   — HACK-HACK "Fiddling with the "
 *   gverbs.zil:1594-1595 V-WAVE  — HACK-HACK "Waving the "
 *   gverbs.zil:902       V-LOWER — HACK-HACK "Playing in this way with the "
 *   gverbs.zil:1131-1132 V-RAISE — delegates to V-LOWER
 *   gverbs.zil:2024-2029 HACK-HACK — global-objects gate: only VERB? WAVE RAISE LOWER
 *                                    gets "isn't here!"; all others fall to HO-HUM.
 *
 * Done-criteria (spec §4.5 + A.1 correction):
 *   - V-KICK normal:  "Kicking the <obj>" + HO-HUM suffix
 *   - V-PUSH normal:  "Pushing the <obj>" + HO-HUM suffix
 *   - V-RUB  normal:  "Fiddling with the <obj>" + HO-HUM suffix
 *   - V-WAVE normal:  "Waving the <obj>" + HO-HUM suffix
 *   - V-WAVE global-objects → "The <obj> isn't here!" (WAVE IS in <VERB? WAVE RAISE LOWER>)
 *   - V-KICK global-objects → HO-HUM (KICK is NOT in <VERB? WAVE RAISE LOWER>)
 *   - V-PUSH global-objects → HO-HUM (PUSH is NOT in <VERB? WAVE RAISE LOWER>)
 *   - V-RUB  global-objects → HO-HUM (RUB  is NOT in <VERB? WAVE RAISE LOWER>)
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
  wall: Thing;  // parentless (GLOBAL-OBJECTS) — "isn't here!" only for WAVE/RAISE/LOWER
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
// KICK is NOT in <VERB? WAVE RAISE LOWER>, so global-objects falls to HO-HUM.
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

  // gverbs.zil:2025-2027: <AND <IN? ,PRSO ,GLOBAL-OBJECTS> <VERB? WAVE RAISE LOWER>>
  // KICK is excluded from VERB? gate → falls to HO-HUM branch, not "isn't here!"
  it('global-objects item → HO-HUM (KICK not in VERB? WAVE RAISE LOWER) — gverbs.zil:2025-2029', () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = executeVerb(
      ctx(fix, { verb: 'kick', action: 'V-KICK', dobj: fix.wall, rng: { next: () => 0 } }),
      'V-KICK',
    );
    expect(r.output).toMatch(/^Kicking the surrounding wall/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });
});

// ---------------------------------------------------------------------------
// V-PUSH — gverbs.zil:1070
// PUSH is NOT in <VERB? WAVE RAISE LOWER>.
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

  it('global-objects item → HO-HUM (PUSH not in VERB? WAVE RAISE LOWER) — gverbs.zil:2025-2029', () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = executeVerb(
      ctx(fix, { verb: 'push', action: 'V-PUSH', dobj: fix.wall, rng: { next: () => 1 } }),
      'V-PUSH',
    );
    expect(r.output).toMatch(/^Pushing the surrounding wall/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });
});

// ---------------------------------------------------------------------------
// V-RUB — gverbs.zil:1165
// RUB is NOT in <VERB? WAVE RAISE LOWER>.
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

  it('global-objects item → HO-HUM (RUB not in VERB? WAVE RAISE LOWER) — gverbs.zil:2025-2029', () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = executeVerb(
      ctx(fix, { verb: 'rub', action: 'V-RUB', dobj: fix.wall, rng: { next: () => 2 } }),
      'V-RUB',
    );
    expect(r.output).toMatch(/^Fiddling with the surrounding wall/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });
});

// ---------------------------------------------------------------------------
// V-WAVE — gverbs.zil:1594-1595
// WAVE IS in <VERB? WAVE RAISE LOWER> → global-objects gets "isn't here!".
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

  it('global-objects item → "The <obj> isn\'t here!" (WAVE in VERB? WAVE RAISE LOWER) — gverbs.zil:2025-2027', () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = executeVerb(
      ctx(fix, { verb: 'wave', action: 'V-WAVE', dobj: fix.wall }),
      'V-WAVE',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });
});
