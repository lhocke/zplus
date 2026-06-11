/**
 * F0 — Globals + verbs + clock-primitive confirm (phase-3-dam-river §9 Wave 0)
 *
 * Done-criteria:
 *   1. Nine dam/river globals round-trip at init values.
 *   2. Eight dam/river verbs route to handlers (not unknown-verb fallback).
 *   3. queue(id, 0, false) is the park idiom — tick-0 disabled slot never fires.
 *   4. D-A data audit: INFLATED-BOAT has Vehicle + VTYPE=NONLANDBIT; reservoir N/S
 *      exits gate on LOW-TIDE only; BAR has Sacred; TRUNK/SCARAB/POT-OF-GOLD have
 *      Invisible; EMERALD is inside BUOY (not separately Invisible).
 *
 * ZIL source refs for init values:
 *   GATE-FLAG=false   1actions.zil:1153
 *   GATES-OPEN=false  1actions.zil:1154
 *   LOW-TIDE=false    1dungeon.zil:1230
 *   LOUD-FLAG=false   1actions.zil:1658
 *   RAINBOW-FLAG=false 1dungeon.zil:1232
 *   DEFLATE=false     1dungeon.zil:1226
 *   BUOY-FLAG=true    1actions.zil:2842
 *   WATER-LEVEL=0     1actions.zil:1295
 *   BEACH-DIG=-1      1actions.zil:2851
 */

import { describe, it, expect } from 'vitest';
import { FlagStore } from '../../src/engine/flag-store.js';
import { Clock } from '../../src/engine/clock.js';
import type { ClockEntry } from '../../src/engine/clock.js';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { newGameAt } from '../helpers/new-game.js';

// ---------------------------------------------------------------------------
// 1. Boolean globals — init values via FlagStore
// ---------------------------------------------------------------------------

describe('F0 — dam/river boolean global init values', () => {
  // The eight false-init globals should all be false at game start.
  const falseInits = [
    'GATE-FLAG',
    'GATES-OPEN',
    'LOW-TIDE',
    'LOUD-FLAG',
    'RAINBOW-FLAG',
    'DEFLATE',
  ] as const;

  for (const name of falseInits) {
    it(`${name} is false at init`, () => {
      const g = newGameAt('DAM-LOBBY');
      const flags = (g as unknown as { flags: FlagStore }).flags;
      expect(flags.get(name)).toBe(false);
    });
  }

  it('BUOY-FLAG is true at init (1actions.zil:2842)', () => {
    const g = newGameAt('DAM-LOBBY');
    const flags = (g as unknown as { flags: FlagStore }).flags;
    expect(flags.get('BUOY-FLAG')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Integer globals — WATER-LEVEL and BEACH-DIG
// ---------------------------------------------------------------------------

describe('F0 — dam/river integer global init values', () => {
  it('WATER-LEVEL is 0 at init (1actions.zil:1295)', () => {
    const g = newGameAt('DAM-LOBBY');
    const wl = (g as unknown as { waterLevel: number }).waterLevel;
    expect(wl).toBe(0);
  });

  it('BEACH-DIG is -1 at init (1actions.zil:2851)', () => {
    const g = newGameAt('DAM-LOBBY');
    const bd = (g as unknown as { beachDig: number }).beachDig;
    expect(bd).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 3. Eight dam/river verbs route to handlers (not unknown-verb fallback)
//
// "I don't know how to" = unknown-verb fallback in executeVerb.
// These verbs must NOT produce that string — they should produce any other
// response (even a stub "Come on, now!" or similar), meaning they are wired.
// ---------------------------------------------------------------------------

function makeMinimalCtx(verb: string): VerbContext {
  const room = new Room('HERE', 'Here', { ldesc: 'A room.' });
  room.set(Flag.On);
  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);
  const world = World.fromObjects([room, player]);
  return { verb, player, here: room, world };
}

describe('F0 — dam/river verbs wired (not unknown-verb fallback)', () => {
  const cases: Array<{ verb: string; action: string }> = [
    { verb: 'inflate',   action: 'V-INFLATE' },
    { verb: 'deflate',   action: 'V-DEFLATE' },
    { verb: 'board',     action: 'V-BOARD' },
    { verb: 'disembark', action: 'V-DISEMBARK' },
    { verb: 'launch',    action: 'V-LAUNCH' },
    { verb: 'land',      action: 'V-LAND' },
    { verb: 'dig',       action: 'V-DIG' },
    { verb: 'wave',      action: 'V-WAVE' },
  ];

  for (const { verb, action } of cases) {
    it(`${action} does not hit unknown-verb fallback`, () => {
      const ctx = makeMinimalCtx(verb);
      const result = executeVerb(ctx, action);
      expect(result.output).not.toContain("I don't know how to");
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Clock primitive — queue(id, 0, false) park idiom never fires
//
// Spec NM-A: tick-0 + disabled = parked, must never fire.
// This test exercises the primitive that I-RFILL/I-REMPTY use.
// ---------------------------------------------------------------------------

describe('F0 — queue(id, 0, false) park idiom: tick-0 disabled slot never fires', () => {
  it('a slot queued with turnsLeft=0 + enabled=false never fires even after many advances', () => {
    const clock = new Clock();
    let fired = false;
    const entry: ClockEntry = {
      id: 'I-TEST-PARK',
      turnsLeft: 0,
      enabled: false,
      tick: () => { fired = true; return true; },
    };
    clock.schedule(entry);
    // Advance 20 turns — parked slot must never fire.
    for (let i = 0; i < 20; i++) {
      clock.advance();
    }
    expect(fired).toBe(false);
  });

  it('queue(id, 0, false) on an enabled entry parks it immediately', () => {
    const clock = new Clock();
    let fireCount = 0;
    const entry: ClockEntry = {
      id: 'I-TEST-ARM',
      turnsLeft: 8,
      enabled: true,
      tick: () => { fireCount++; return false; },
    };
    clock.schedule(entry);
    // Park it before it fires.
    clock.queue('I-TEST-ARM', 0, false);
    for (let i = 0; i < 10; i++) {
      clock.advance();
    }
    expect(fireCount).toBe(0);
  });

  it('queue(id, period, true) re-arms and fires after the period', () => {
    const clock = new Clock();
    let fireCount = 0;
    const entry: ClockEntry = {
      id: 'I-TEST-REARM',
      turnsLeft: 0,
      enabled: false,
      tick: () => { fireCount++; return false; },
    };
    clock.schedule(entry);
    clock.queue('I-TEST-REARM', 3, true);
    // 2 advances: no fire yet.
    clock.advance(); clock.advance();
    expect(fireCount).toBe(0);
    // 3rd advance fires.
    clock.advance();
    expect(fireCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. D-A data audit (read-only fixture assertions)
// ---------------------------------------------------------------------------

describe('D-A — data audit: boat + reservoir exits + key object flags', () => {
  it('INFLATED-BOAT has Vehicle flag (VEHBIT)', () => {
    const g = newGameAt('DAM-BASE');
    const boat = g.world.get('INFLATED-BOAT');
    expect(boat).toBeDefined();
    expect(boat!.has(Flag.Vehicle)).toBe(true);
  });

  it('INFLATED-BOAT has VTYPE=NONLANDBIT prop', () => {
    const g = newGameAt('DAM-BASE');
    const boat = g.world.get('INFLATED-BOAT');
    expect(boat).toBeDefined();
    expect(boat!.props.get('VTYPE')).toBe('NONLANDBIT');
  });

  // D-A: reservoir N/S exits gate on LOW-TIDE only — rooms.json:1424,1502.
  // GATES-OPEN does NOT gate these exits.
  it('RESERVOIR-SOUTH north exit ifFlag is LOW-TIDE (rooms.json:1424)', () => {
    const g = newGameAt('RESERVOIR-SOUTH');
    const room = g.world.get('RESERVOIR-SOUTH') as Room;
    expect(room).toBeDefined();
    const northExit = room.exits.find(e => e.dir === 'north');
    expect(northExit).toBeDefined();
    expect(northExit!.ifFlag).toBe('LOW-TIDE');
    expect(northExit!.ifFlag).not.toBe('GATES-OPEN');
  });

  it('RESERVOIR-NORTH south exit ifFlag is LOW-TIDE (rooms.json:1502)', () => {
    const g = newGameAt('RESERVOIR-NORTH');
    const room = g.world.get('RESERVOIR-NORTH') as Room;
    expect(room).toBeDefined();
    const southExit = room.exits.find(e => e.dir === 'south');
    expect(southExit).toBeDefined();
    expect(southExit!.ifFlag).toBe('LOW-TIDE');
    expect(southExit!.ifFlag).not.toBe('GATES-OPEN');
  });

  it('BAR has Sacred flag (SACREDBIT)', () => {
    const g = newGameAt('LOUD-ROOM');
    const bar = g.world.get('BAR');
    expect(bar).toBeDefined();
    expect(bar!.has(Flag.Sacred)).toBe(true);
  });

  it('TRUNK has Invisible flag', () => {
    const g = newGameAt('RESERVOIR');
    const trunk = g.world.get('TRUNK');
    expect(trunk).toBeDefined();
    expect(trunk!.has(Flag.Invisible)).toBe(true);
  });

  it('SCARAB has Invisible flag', () => {
    const g = newGameAt('SANDY-CAVE');
    const scarab = g.world.get('SCARAB');
    expect(scarab).toBeDefined();
    expect(scarab!.has(Flag.Invisible)).toBe(true);
  });

  it('POT-OF-GOLD has Invisible flag', () => {
    const g = newGameAt('END-OF-RAINBOW');
    const pot = g.world.get('POT-OF-GOLD');
    expect(pot).toBeDefined();
    expect(pot!.has(Flag.Invisible)).toBe(true);
  });

  // EMERALD is not separately Invisible — it is hidden inside a closed BUOY container.
  // ZIL: (IN BUOY) (FLAGS TAKEBIT) — no INVISIBLE flag. 1dungeon.zil:556.
  it('EMERALD is inside BUOY (not independently Invisible — ZIL:1dungeon.zil:556)', () => {
    const g = newGameAt('RIVER-4');
    const emerald = g.world.get('EMERALD');
    expect(emerald).toBeDefined();
    expect(emerald!.parent?.id).toBe('BUOY');
    expect(emerald!.has(Flag.Invisible)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Verb fall-through messages — ZIL fidelity (gverbs.zil HACK-HACK / V-* routines)
//
// Each V-* fall-through must emit the ZIL-canonical message, not a fabricated
// string.  "Nothing happens." is the classic fabricated tell: it appears nowhere
// in V-WAVE's ZIL path (HACK-HACK → "Waving the " + D PRSO + PICK-ONE HO-HUM).
// ---------------------------------------------------------------------------

function makeVerbCtx(verb: string, _action: string, dobj?: Thing, iobj?: Thing): VerbContext {
  const room = new Room('HERE', 'Here', { ldesc: 'A room.' });
  room.set(Flag.On);
  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);
  const objs: (Room | Actor | Thing)[] = [room, player];
  if (dobj) { dobj.moveTo(player); objs.push(dobj); }
  if (iobj) { iobj.moveTo(player); objs.push(iobj); }
  const world = World.fromObjects(objs);
  return { verb, player, here: room, world, dobj, iobj };
}

describe('F0 — verb fall-through ZIL fidelity', () => {
  // V-WAVE: HACK-HACK "Waving the " → "Waving the <name> <HO-HUM suffix>"
  // gverbs.zil:1594-1595, HACK-HACK gverbs.zil:2024-2029, HO-HUM gverbs.zil:2031-2036.
  it('wave <held object>: output starts with "Waving the" (not "Nothing happens.")', () => {
    const leaflet = new Thing('LEAFLET', 'leaflet', { synonyms: ['leaflet'] });
    const ctx = makeVerbCtx('wave', 'V-WAVE', leaflet);
    const out = executeVerb(ctx, 'V-WAVE').output;
    expect(out).toMatch(/^Waving the leaflet/);
    expect(out).not.toBe('Nothing happens.');
  });

  it('wave <held object>: suffix is one of the HO-HUM set (gverbs.zil:2031-2036)', () => {
    const leaflet = new Thing('LEAFLET', 'leaflet', { synonyms: ['leaflet'] });
    const hoHumSuffixes = [" doesn't seem to work.", " isn't notably helpful.", " has no effect."];
    // Seed each rng outcome to exercise all three entries.
    for (let i = 0; i < 3; i++) {
      const idx = i;
      const ctx = makeVerbCtx('wave', 'V-WAVE', leaflet);
      (ctx as unknown as { rng: { next(): number } }).rng = { next: () => idx / 3 };
      const out = executeVerb(ctx, 'V-WAVE').output;
      expect(hoHumSuffixes.some(s => out.endsWith(s))).toBe(true);
    }
  });

  // V-INFLATE fall-through: "How can you inflate that?" (gverbs.zil:758)
  it('inflate fall-through: "How can you inflate that?"', () => {
    const leaflet = new Thing('LEAFLET', 'leaflet', { synonyms: ['leaflet'] });
    const ctx = makeVerbCtx('inflate', 'V-INFLATE', leaflet);
    const out = executeVerb(ctx, 'V-INFLATE').output;
    expect(out).toBe('How can you inflate that?');
  });

  // V-DEFLATE fall-through: "Come on, now!" (gverbs.zil:403)
  it('deflate fall-through: "Come on, now!"', () => {
    const leaflet = new Thing('LEAFLET', 'leaflet', { synonyms: ['leaflet'] });
    const ctx = makeVerbCtx('deflate', 'V-DEFLATE', leaflet);
    const out = executeVerb(ctx, 'V-DEFLATE').output;
    expect(out).toBe('Come on, now!');
  });

  // V-LAUNCH non-vehicle: "That's pretty weird." (gverbs.zil:808)
  it('launch non-vehicle fall-through: "That\'s pretty weird."', () => {
    const leaflet = new Thing('LEAFLET', 'leaflet', { synonyms: ['leaflet'] });
    const ctx = makeVerbCtx('launch', 'V-LAUNCH', leaflet);
    const out = executeVerb(ctx, 'V-LAUNCH').output;
    expect(out).toBe("That's pretty weird.");
  });

  // V-LAUNCH vehicle: "You can't launch that by saying \"launch\"!" (gverbs.zil:806)
  it('launch vehicle fall-through: "You can\'t launch that by saying \\"launch\\"!"', () => {
    const boat = new Thing('BOAT', 'rubber boat', { synonyms: ['boat'] });
    boat.set(Flag.Vehicle);
    const ctx = makeVerbCtx('launch', 'V-LAUNCH', boat);
    const out = executeVerb(ctx, 'V-LAUNCH').output;
    expect(out).toBe('You can\'t launch that by saying "launch"!');
  });

  // V-DIG with shovel iobj: "There's no reason to be digging here." (gverbs.zil:411)
  it('dig with shovel fall-through: "There\'s no reason to be digging here."', () => {
    const shovel = new Thing('SHOVEL', 'shovel', { synonyms: ['shovel'] });
    const ctx = makeVerbCtx('dig', 'V-DIG', undefined, shovel);
    const out = executeVerb(ctx, 'V-DIG').output;
    expect(out).toBe("There's no reason to be digging here.");
  });
});
