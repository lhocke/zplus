/**
 * SS5 — Parser.snapshotState() / Parser.restoreState()
 *
 * Spec §3.6: itRef round-trips; save is refused mid-continuation and
 * mid-disambiguation-await (OQ-5).
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Parser } from '../../src/engine/parser/parser.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { World } from '../../src/domain/world.js';

// ---------------------------------------------------------------------------
// Minimal world helpers
// ---------------------------------------------------------------------------

function litRoom(id: string): Room {
  const r = new Room(id, id);
  r.set(Flag.On);
  return r;
}

function makeThing(id: string, synonyms: string[], adjectives: string[] = []): Thing {
  const t = new Thing(id, id.toLowerCase(), { synonyms, adjectives });
  t.set(Flag.Takeable);
  return t;
}

function makeActor(id: string): Actor {
  return new Actor(id, 'actor', { synonyms: [id.toLowerCase()] });
}

/** One-lamp world: enough to trigger IT binding on a take command. */
function oneLampWorld(): { room: Room; player: Actor; lamp: Thing; world: World } {
  const room = litRoom('ROOM');
  const player = makeActor('PLAYER');
  player.moveTo(room);
  const lamp = makeThing('LAMP', ['lamp', 'lantern'], ['brass']);
  lamp.moveTo(room);
  const world = World.fromObjects([room, player, lamp]);
  return { room, player, lamp, world };
}

/** Two-lamp world: triggers disambiguation orphan. */
function twoLampWorld(): { room: Room; player: Actor; world: World } {
  const room = litRoom('ROOM');
  const player = makeActor('PLAYER');
  player.moveTo(room);
  const lamp1 = makeThing('BRASS-LAMP', ['lamp'], ['brass']);
  lamp1.moveTo(room);
  const lamp2 = makeThing('SILVER-LAMP', ['lamp'], ['silver']);
  lamp2.moveTo(room);
  const world = World.fromObjects([room, player, lamp1, lamp2]);
  return { room, player, world };
}

// ---------------------------------------------------------------------------
// 1. snapshotState / restoreState: itRef round-trips
// ---------------------------------------------------------------------------

describe('SS5 snapshotState / restoreState', () => {
  it('captures undefined itRef when no command has run', () => {
    const parser = new Parser();
    const snap = parser.snapshotState();
    expect(snap.itRef).toBeUndefined();
  });

  it('captures itRef after bindPronouns is called', () => {
    const { room, player, world } = oneLampWorld();  // lamp stays in room for scope
    const parser = new Parser();
    // Parse a take command so we have a resolved dobjId, then bind pronouns.
    const result = parser.parseSegment('take lamp', room, player, world);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      parser.bindPronouns(result.command);
    }
    const snap = parser.snapshotState();
    expect(snap.itRef).toBe('LAMP');
  });

  it('restores itRef so "it" resolves correctly after restore', () => {
    const { room, player, lamp, world } = oneLampWorld();
    const src = new Parser();

    // Bind IT to the lamp.
    const r1 = src.parseSegment('take lamp', room, player, world);
    expect(r1.kind).toBe('ok');
    if (r1.kind === 'ok') src.bindPronouns(r1.command);

    const snap = src.snapshotState();

    // Fresh parser with no prior history.
    const dst = new Parser();
    dst.restoreState(snap);

    // After restore, "drop it" should resolve "it" to the lamp.
    lamp.moveTo(player);  // put it in inventory so drop can find it
    const r2 = dst.parseSegment('drop it', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.dobjIds?.[0]).toBe('LAMP');
    }
  });

  it('restoreState with itRef=undefined clears any prior binding', () => {
    const { room, player, world } = oneLampWorld();
    const parser = new Parser();

    // Bind IT first.
    const r = parser.parseSegment('take lamp', room, player, world);
    if (r.kind === 'ok') parser.bindPronouns(r.command);
    expect(parser.snapshotState().itRef).toBe('LAMP');

    // Restore a snapshot with no itRef.
    parser.restoreState({});
    expect(parser.snapshotState().itRef).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Mid-continuation save: snapshotState() throws (OQ-5)
// ---------------------------------------------------------------------------

describe('SS5 mid-continuation guard', () => {
  it('snapshotState throws when hasContinuation() is true', () => {
    const { room, player, world } = oneLampWorld();
    const parser = new Parser();
    // A THEN-separated input seeds a continuation after the first segment pops.
    // parseSegment consumes segment 0; segment 1 stays queued.
    parser.parseSegment('look. look', room, player, world);
    expect(parser.hasContinuation()).toBe(true);
    expect(() => parser.snapshotState()).toThrow(/mid-continuation/i);
  });

  it('snapshotState succeeds after continuation is drained', () => {
    const { room, player, world } = oneLampWorld();
    const parser = new Parser();
    parser.parseSegment('look. look', room, player, world);
    expect(parser.hasContinuation()).toBe(true);
    // Drain the continuation.
    parser.parseSegment('', room, player, world);
    expect(parser.hasContinuation()).toBe(false);
    // Should not throw now.
    expect(() => parser.snapshotState()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Mid-disambiguation-await save: snapshotState() throws (OQ-5)
// ---------------------------------------------------------------------------

describe('SS5 mid-disambiguation guard', () => {
  it('snapshotState throws when isAwaitingInput() is true (orphan pending)', () => {
    const { room, player, world } = twoLampWorld();
    const parser = new Parser();
    // Two lamps in scope — "take lamp" returns a disambig result and sets orphan.
    const result = parser.parseSegment('take lamp', room, player, world);
    expect(result.kind).toBe('disambig');
    expect(parser.isAwaitingInput()).toBe(true);
    expect(() => parser.snapshotState()).toThrow(/mid-disambiguation/i);
  });

  it('snapshotState succeeds after orphan is resolved', () => {
    const { room, player, world } = twoLampWorld();
    const parser = new Parser();
    parser.parseSegment('take lamp', room, player, world);
    expect(parser.isAwaitingInput()).toBe(true);
    // Resolve with an adjective that disambiguates.
    parser.parseSegment('brass', room, player, world);
    expect(parser.isAwaitingInput()).toBe(false);
    expect(() => parser.snapshotState()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Game-level round-trip: parser.itRef survives snapshot() → restore()
// ---------------------------------------------------------------------------

describe('SS5 Game-level itRef round-trip', () => {
  it('itRef is preserved through Game.snapshot() / Game.restore()', () => {
    const g1 = createGame({ seed: 42 });
    g1.start();

    // Find the lantern id so we can assert the itRef after restore.
    const lanternId = 'LANTERN';

    // Inject a known itRef on the parser via the public seam.
    // The parser is private, so we go through snapshot/restore symmetry:
    // first set it via the game-level path, then verify via restore.
    //
    // Approach: snapshot the game, manually inject itRef, restore, snapshot again.
    const s1 = g1.snapshot();
    s1.parser = { itRef: lanternId };

    const g2 = createGame({ seed: 42 });
    g2.restore(s1);
    const s2 = g2.snapshot();

    expect(s2.parser.itRef).toBe(lanternId);
  });
});
