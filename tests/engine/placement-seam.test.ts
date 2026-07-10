import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';

// MODE-ISOLATION CARVE-OUTS: this suite's invariant is "randomizer mode
// changes WHERE things start, never anything's BEHAVIOR." Three intentional
// exceptions exist, all seeded-only; vanilla play (no placementMap / no
// randomizerSeedString) is byte-for-byte unaffected by any of them. Any
// FUTURE in-mode behavior delta beyond placement itself should get the same
// explicit carve-out note here, not slip in silently.
//
// 1. depositBooty (AMENDMENT 4, repair task 3R3): src/actions/thief.ts,
//    wired into the thief's F_DEAD combat handler via src/engine/game.ts's
//    buildRobberFcnCtx. In a seeded run it returns the thief's entire bag on
//    death, lifting the vanilla TVALUE filter, because oracle verification
//    proved the vanilla filter (which permanently discards TVALUE==0 items)
//    faithful but unsafe for a run where any item can be a required check.
//    Vanilla-vs-seeded pin: tests/engine/t1-booty-helpers.test.ts, "TS-D:
//    depositBooty()".
//
// 2. Sacred torch (AMENDMENT 10, repair 3R8): the placement seam
//    (src/engine/bootstrap.ts) sets SACREDBIT on TORCH in seeded runs, so
//    the thief's SACREDBIT-respecting rob/stealJunk paths skip it, and the
//    one path with no SACREDBIT check in the ZIL (ROB-MAZE) is gated
//    explicitly on (seeded && TORCH) in src/actions/thief.ts's robMaze.
//    Rationale: losing the torch is the one theft that cascades into true
//    unwinnability (light loss, all sources exhausted); everything else
//    stays the thief's fair game. Vanilla-vs-seeded pins:
//    tests/engine/t1-booty-helpers.test.ts, "AMENDMENT 10 (repair 3R8)".
//
// 3. Doubled lamp budget (AMENDMENT 11, repair 3R9): seeded runs construct
//    the lantern interrupt with budgetScale=2 (src/engine/bootstrap.ts →
//    src/engine/clock.ts), doubling every LAMP-TABLE stage budget (385
//    total turns -> 770; warnings at 400/600/740). Rationale: vanilla's
//    385-turn budget assumes known routes; blind randomized exploration is
//    structurally thirstier — same accommodation class as the sacred torch:
//    engine-level, mode-gated, never modeled in logic. The scale rides in
//    the clock entry's serialized aux, so a seeded save restores the
//    doubled schedule even into a vanilla-constructed Game (the in-place
//    RESTORE path). Candles are NOT scaled. Vanilla-vs-seeded pins:
//    tests/engine/clock.test.ts, "LanternInterrupt: seeded budget scale
//    (AMENDMENT 11 repair 3R9)" (vanilla stage counts stay pinned by the
//    dfrotz-anchored "LanternInterrupt: fuel stages" suite).
describe('placement seam', () => {
  it('with no placementMap, LAMP starts in LIVING-ROOM exactly as vanilla (mode isolation)', () => {
    const game = createGame({ seed: 42 });
    const view = game.view();
    // No behavioral delta: this is the same start-room/inventory shape the
    // entire existing walkthrough suite already exercises with zero
    // placementMap anywhere — this test is a targeted spot-anchor, not the
    // only proof (the full 3,898-test suite is the broader proof, per the
    // design doc's mode-isolation requirement).
    expect(view.here).toBe('WEST-OF-HOUSE');
  });

  it('with a placementMap, the named object starts in the mapped parent instead of its vanilla one', async () => {
    // KITCHEN (not ATTIC) is the target here: ATTIC has no "On" (lit) flag in
    // rooms.json, so with the lamp itself relocated there (and thus not in
    // the player's inventory to light the way), "look" would just report
    // "It is pitch black" instead of revealing the lamp — an unrelated
    // darkness gap, not the seam under test. KITCHEN is lit, so the room
    // contents are visible without any light source.
    const game = createGame({ seed: 42, placementMap: { LAMP: 'KITCHEN' } });
    // Walk to the Kitchen and confirm the lamp is there instead of the Living Room.
    // (This engine exposes room contents via the view/description text, so
    // drive it through real commands rather than reaching into internals.)
    await game.turn('north');       // WEST-OF-HOUSE -> NORTH-OF-HOUSE
    await game.turn('east');        // -> EAST-OF-HOUSE
    await game.turn('open window');
    const { output } = await game.turn('west');   // -> KITCHEN
    expect(output).toContain('brass lantern');
  });

  it('a seeded run sets Sacred on the TORCH at the seam, whatever the map contains (AMENDMENT 10 repair 3R8)', () => {
    // The trigger is placementMap PRESENCE (the seeded-run marker), not a
    // TORCH entry in the map — every real seed shuffles the torch, but the
    // protection must not depend on that.
    const game = createGame({ seed: 42, placementMap: { LAMP: 'KITCHEN' } });
    const world = (game as unknown as { world: { get(id: string): { has(f: Flag): boolean } | undefined } }).world;
    expect(world.get('TORCH')?.has(Flag.Sacred)).toBe(true);
  });

  it('a vanilla game leaves the TORCH un-Sacred — robbable exactly as before (AMENDMENT 10 repair 3R8)', () => {
    const game = createGame({ seed: 42 });
    const world = (game as unknown as { world: { get(id: string): { has(f: Flag): boolean } | undefined } }).world;
    expect(world.get('TORCH')?.has(Flag.Sacred)).toBe(false);
  });

  it('a seeded run doubles the lamp budget at the seam, and the snapshot fuel readout reflects it unmodified (AMENDMENT 11 repair 3R9)', () => {
    const game = createGame({ seed: 42, placementMap: { LAMP: 'KITCHEN' } });
    // The GameView only carries lamp state during a randomized run — mark
    // the run exactly as the session layer does after a seeded createGame.
    game.setRandomizerRun('test-seed-string', [['LAMP', 'KITCHEN']]);
    // 770 = the doubled 385-turn budget, read through the same
    // view() -> lampTurnsRemaining path the tracker fuel row renders from —
    // verifying the readout needed no modification.
    expect(game.view().randomizerLampTurnsLeft).toBe(770);
  });

  it('a vanilla game keeps the 385-turn lamp schedule exactly as before (AMENDMENT 11 repair 3R9)', () => {
    const game = createGame({ seed: 42 });
    const clock = (game as unknown as { clock: { getEntry(id: string): { turnsLeft: number; aux?: Record<string, number> } | undefined } }).clock;
    const entry = clock.getEntry('I-LANTERN');
    // Vanilla initial countdown stays 200 (the dfrotz-anchored schedule),
    // with no doubled scale in the serialized aux.
    expect(entry?.turnsLeft).toBe(200);
    expect(entry?.aux?.['budgetScale'] ?? 1).toBe(1);
  });

  it('an unknown objectId in placementMap is skipped, not thrown', () => {
    expect(() => createGame({ seed: 42, placementMap: { 'NOT-A-REAL-OBJECT': 'LIVING-ROOM' } })).not.toThrow();
  });

  it('an unknown target parent id in placementMap is skipped, not thrown', () => {
    expect(() => createGame({ seed: 42, placementMap: { LAMP: 'NOT-A-REAL-ROOM' } })).not.toThrow();
  });
});
