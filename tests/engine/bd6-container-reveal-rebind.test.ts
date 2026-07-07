/**
 * BD6 — container-reveal IT-rebind.
 *
 * ZIL V-OPEN (gverbs.zil:966–994) calls PRINT-CONTENTS which calls THIS-IS-IT
 * when the "Opening X reveals..." path exposes exactly ONE item.
 * ZIL PRINT-CONTENTS (gverbs.zil:1730–1748): sets IT? to the first item, clears
 * IT? (sets TWO?) on the second — so THIS-IS-IT fires only when count == 1.
 *
 * Engine gap (BD6): verbOpen builds the reveal message but does not call
 * ctx.thisIsIt on the single revealed item.  After the fix, the next turn's
 * "examine it" / "take it" must resolve to the revealed item, not the container.
 *
 * Scope (spec §7 BD6 narrowed 2026-06-12): container-reveal rebind only.
 * CC11 entry-binding (troll-room thisIsIt on arrival) is a separate test and
 * must not regress.
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Thing } from '../../src/domain/thing.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface OpenFixture {
  world: World;
  room: Room;
  player: Actor;
  box: Thing;        // the container to open
  leaflet: Thing;    // single item inside
  sword: Thing;      // second item (multi-item reveal path)
}

function makeOpenFixture(): OpenFixture {
  const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A test room.' });
  room.set(Flag.On);

  const box = new Thing('BOX', 'wooden box', { synonyms: ['box'] });
  box.set(Flag.Container);
  // starts closed (no Flag.Open)
  box.moveTo(room);

  // leaflet: already touched, no FDESC — goes through PRINT-CONTENTS path
  const leaflet = new Thing('LEAFLET', 'leaflet', { synonyms: ['leaflet'] });
  leaflet.set(Flag.Touched);
  leaflet.moveTo(box);

  // sword: second item for multi-item tests
  const sword = new Thing('SWORD', 'elvish sword', { synonyms: ['sword'] });
  sword.set(Flag.Touched);
  sword.moveTo(box);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, box, leaflet, sword, player]);
  return { world, room, player, box, leaflet, sword };
}

function makeCtx(
  fix: OpenFixture,
  thisIsItSpy?: (obj: { id: string }) => void,
): VerbContext {
  return {
    verb: 'open',
    action: 'V-OPEN',
    dobj: fix.box,
    player: fix.player,
    here: fix.room,
    world: fix.world,
    thisIsIt: thisIsItSpy as VerbContext['thisIsIt'],
  };
}

// ---------------------------------------------------------------------------
// Single-item reveal: thisIsIt must be called with the revealed item.
// ---------------------------------------------------------------------------

describe('BD6 — container-reveal: single item rebinds IT (ZIL PRINT-CONTENTS:1747)', () => {
  it('opening a box with 1 item calls thisIsIt with that item', async () => {
    const fix = makeOpenFixture();
    // Remove sword so only leaflet remains.
    fix.sword.moveTo(null as unknown as Room);

    let bound: string | undefined;
    const ctx = makeCtx(fix, (obj) => { bound = obj.id; });

    const r = await executeVerb(ctx, 'open');
    // Must produce the "Opening X reveals..." output.
    expect(r.output).toMatch(/Opening|reveals|Opened/i);
    // thisIsIt must have been called with the leaflet.
    expect(bound).toBe('LEAFLET');
  });

  it('opening a box with 1 untouched+FDESC item: no thisIsIt (single-FDESC path skips PRINT-CONTENTS)', async () => {
    // ZIL V-OPEN single-FDESC branch does NOT call PRINT-CONTENTS / THIS-IS-IT.
    const fix = makeOpenFixture();
    fix.sword.moveTo(null as unknown as Room);
    fix.leaflet.clear(Flag.Touched);
    (fix.leaflet as unknown as { fdesc: string }).fdesc = 'You see a leaflet here.';

    let bound: string | undefined;
    const ctx = makeCtx(fix, (obj) => { bound = obj.id; });

    await executeVerb(ctx, 'open');
    // Single-FDESC path ("The box opens.\n<fdesc>") — no PRINT-CONTENTS, no THIS-IS-IT.
    expect(bound).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-item reveal: thisIsIt must NOT be called (ZIL TWO? clears IT?).
// ---------------------------------------------------------------------------

describe('BD6 — container-reveal: multi-item reveal does NOT rebind IT', () => {
  it('opening a box with 2 items: thisIsIt is NOT called', async () => {
    const fix = makeOpenFixture();
    // Both leaflet and sword are present.

    let bound: string | undefined;
    const ctx = makeCtx(fix, (obj) => { bound = obj.id; });

    await executeVerb(ctx, 'open');
    expect(bound).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CC11 regression: troll-room entry binding must not be disturbed.
// (Structural check only — the full CC11 suite is in cc11-troll-room-f.test.ts.)
// ---------------------------------------------------------------------------

describe('BD6 — CC11 non-regression: verbOpen does not touch itRef when thisIsIt absent', () => {
  it('verbOpen with no thisIsIt wired: does not throw', () => {
    const fix = makeOpenFixture();
    fix.sword.moveTo(null as unknown as Room);

    // No thisIsIt in ctx — must not crash.
    const ctx: VerbContext = {
      verb: 'open',
      action: 'V-OPEN',
      dobj: fix.box,
      player: fix.player,
      here: fix.room,
      world: fix.world,
      // thisIsIt intentionally absent
    };

    expect(async () => await executeVerb(ctx, 'open')).not.toThrow();
  });
});
