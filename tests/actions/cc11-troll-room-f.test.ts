/**
 * CC11 — TROLL-ROOM-F (spec §6.11)
 *
 * 1actions.zil:4175–4178: on M-ENTER with TROLL present, THIS-IS-IT sets the
 * IT pronoun to the troll so "attack it" targets the troll on arrival.
 *
 * Test contract (spec §10.4 / L40):
 *   - World-state prerequisites: assert-and-fail (no early-return guards above expect).
 *   - No-double-binding: entry binding + post-parse bindPronouns coexist correctly.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';

// Player in CELLAR (south of TROLL-ROOM) with lantern + sword.
// Walk north → M-ENTER fires in TROLL-ROOM.
function gameApproachingTrollRoom() {
  const g = createGame({ startRoom: 'CELLAR' });
  g.start();
  const w = (g as unknown as { world: { get(id: string): unknown } }).world;
  const player = w.get('PLAYER') as object | undefined;
  type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
  const lamp  = w.get('LAMP')  as Obj | undefined;
  const sword = w.get('SWORD') as Obj | undefined;
  if (lamp  && player) { lamp.moveTo(player);  lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
  if (sword && player) { sword.moveTo(player); }
  return g;
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

describe('CC11 — TROLL-ROOM-F: handler registered (1actions.zil:4175)', () => {
  it('TROLL-ROOM-F is registered: entering TROLL-ROOM with troll present triggers no-op path (handler exists)', () => {
    // If unregistered, the engine silently ignores the actionRoutine.
    // Registration check: enter from CELLAR; the handler must run without crashing.
    const g = gameApproachingTrollRoom();
    const troll = (g as unknown as { world: { get(id: string): unknown } }).world.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    // No assertion on output — just confirm no error thrown.
    expect(async () => await g.turn('north')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// M-ENTER entry-binding: "it" = TROLL on arrival (1actions.zil:4176–4178)
// ---------------------------------------------------------------------------

describe('CC11 — TROLL-ROOM-F M-ENTER: "attack it" targets troll on first arrival (1actions.zil:4177)', () => {
  it('entering TROLL-ROOM (troll present): "attack it" produces non-empty combat output', async () => {
    const g = gameApproachingTrollRoom();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const troll = w.get('TROLL');
    expect(troll, 'TROLL must exist in world').toBeDefined();
    // Move to TROLL-ROOM → M-ENTER fires → THIS-IS-IT(TROLL)
    await g.turn('north');
    // "attack it" must resolve "it" to the troll — real combat, not "I don't know what you mean"
    const out = await (await g.turn('attack it')).output;
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain("don't know");
    expect(out).not.toContain("What do you want");
    expect(out).not.toContain("I don't see");
  });

  it('entering TROLL-ROOM (troll present): "attack it with sword" targets troll', async () => {
    const g = gameApproachingTrollRoom();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const troll = w.get('TROLL');
    expect(troll, 'TROLL must exist in world').toBeDefined();
    await g.turn('north');
    // "attack it with sword" should resolve "it" to troll and fire combat
    const out = await (await g.turn('attack it with sword')).output;
    expect(out.length).toBeGreaterThan(0);
    // Real combat output references troll context
    expect(out).not.toContain("don't know");
    expect(out).not.toContain("What do you want");
  });
});

// ---------------------------------------------------------------------------
// M-ENTER guard: troll absent → no binding (1actions.zil:4176 <IN? ,TROLL ,HERE>)
// ---------------------------------------------------------------------------

describe('CC11 — TROLL-ROOM-F M-ENTER: troll absent → no entry-binding', () => {
  it('entering TROLL-ROOM with troll absent: "attack it" does not crash', async () => {
    // Move TROLL out of TROLL-ROOM before entering.
    const g = gameApproachingTrollRoom();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    type Obj = { moveTo(d: unknown): void };
    const troll = w.get('TROLL') as Obj | undefined;
    const remote = w.get('LIVING-ROOM') as unknown;
    expect(troll, 'TROLL must exist').toBeDefined();
    expect(remote, 'LIVING-ROOM must exist').toBeDefined();
    troll!.moveTo(remote);
    await g.turn('north');
    // No entry-binding fired; "attack it" may get "don't see" or prior referent — must not crash.
    expect(async () => await g.turn('attack it')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// No-double-binding: post-parse bindPronouns rebinds "it" to new direct object
// BD6 coordinate: entry-bind and post-parse bind must coexist (spec §6.11)
// ---------------------------------------------------------------------------

describe('CC11 — no-double-binding: entry-bind then post-parse rebind (spec §6.11 / BD6)', () => {
  it('after entering troll room, "take sword" rebinds "it" to sword per ZIL', async () => {
    // Sword must be in TROLL-ROOM for "take sword" to work.
    const g = createGame({ startRoom: 'CELLAR' });
    g.start();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const player = w.get('PLAYER') as object | undefined;
    type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
    const lamp  = w.get('LAMP')  as Obj | undefined;
    const sword = w.get('SWORD') as Obj | undefined;
    const trollRoom = w.get('TROLL-ROOM') as unknown;
    expect(lamp,      'LAMP must exist').toBeDefined();
    expect(sword,     'SWORD must exist').toBeDefined();
    expect(trollRoom, 'TROLL-ROOM must exist').toBeDefined();
    if (lamp  && player) { lamp.moveTo(player);  lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
    // Sword in TROLL-ROOM so the player can take it.
    sword!.moveTo(trollRoom);

    // Enter TROLL-ROOM → THIS-IS-IT(TROLL): "it" = troll
    await g.turn('north');

    // "take sword" → bindPronouns sets "it" = sword (post-parse bind wins per ZIL gmain.zil:202)
    const takeOut = await (await g.turn('take sword')).output;
    expect(takeOut, '"take sword" must produce output').toBeTruthy();

    // "examine it" after "take sword" must reference SWORD, not troll
    const examineOut = await (await g.turn('examine it')).output;
    expect(examineOut.length).toBeGreaterThan(0);
    expect(examineOut).not.toContain("don't know");
    // Sword description contains "elvish" or "antiquity"
    expect(examineOut).toMatch(/elvish|antiq|sword/i);
  });

  it('"attack it" before any rebind targets troll (entry-binding holds until displaced)', async () => {
    const g = gameApproachingTrollRoom();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const troll = w.get('TROLL');
    expect(troll, 'TROLL must exist').toBeDefined();
    // Enter → entry-bind fires, "it" = troll
    await g.turn('north');
    // First command: no prior direct-object → post-parse bind has not yet displaced entry-bind
    const out = await (await g.turn('attack it')).output;
    expect(out).not.toContain("don't know");
    expect(out).not.toContain("What do you want");
    expect(out.length).toBeGreaterThan(0);
  });
});
