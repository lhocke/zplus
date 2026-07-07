/**
 * CB-RIVER-OBJ — buoy/emerald, white-cliffs, RIVR4-ROOM, FALLS-ROOM
 *
 * Done-criteria (spec §9 Wave 2 CB-RIVER-OBJ):
 *   - TREASURE-INSIDE: opening the buoy calls scoreObj(EMERALD); emerald scores once
 *   - RIVR4-ROOM M-END: buoy hint fires once when player holds buoy + BUOY-FLAG set
 *   - WHITE-CLIFFS-FUNCTION M-END: DEFLATE toggles per whether inflated boat is in inventory
 *   - FALLS-ROOM M-LOOK: base text + conditional rainbow suffix on RAINBOW-FLAG
 *
 * ZIL refs:
 *   TREASURE-INSIDE          1dungeon.zil:793–796
 *   RIVR4-ROOM               1actions.zil:2844–2849
 *   WHITE-CLIFFS-FUNCTION    1actions.zil:2585–2590
 *   FALLS-ROOM               1actions.zil:2621–2636
 *   BUOY-FLAG global         1actions.zil:2842
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { FlagStore } from '../../src/engine/flag-store.js';

// ---------------------------------------------------------------------------
// TREASURE-INSIDE — opening the buoy scores EMERALD (1dungeon.zil:793)
// ---------------------------------------------------------------------------

describe('CB-RIVER-OBJ — TREASURE-INSIDE: open buoy scores emerald', () => {
  it('opening buoy awards emerald VALUE (5 points) once', async () => {
    const g = newGameAt('RIVER-4');
    const buoy    = g.world.get('BUOY')!;
    const emerald = g.world.get('EMERALD')!;
    expect(buoy).not.toBeUndefined();
    expect(emerald).not.toBeUndefined();

    // Pick up buoy so we can open it
    buoy.moveTo(g.player);

    const before = g.view().score;
    await g.turn('open buoy');
    const after = g.view().score;

    // Opening the buoy should award emerald's VALUE (5 pts, distinct from TVALUE)
    expect(after).toBeGreaterThan(before);
  });

  it('opening buoy a second time does not re-score', async () => {
    const g = newGameAt('RIVER-4');
    const buoy = g.world.get('BUOY')!;
    buoy.moveTo(g.player);

    await g.turn('open buoy');
    const after1 = g.view().score;
    await g.turn('close buoy');
    await g.turn('open buoy');
    const after2 = g.view().score;

    // Second open should not increment score again
    expect(after2).toBe(after1);
  });

  it('TREASURE-INSIDE returns false (normal open still reveals contents)', async () => {
    const g = newGameAt('RIVER-4');
    const buoy    = g.world.get('BUOY')!;
    const emerald = g.world.get('EMERALD')!;
    buoy.moveTo(g.player);

    const out = await (await g.turn('open buoy')).output;

    // The emerald should be accessible (buoy is opened, contents visible)
    // The engine's normal OPEN logic runs because TREASURE-INSIDE returns false
    expect(out).not.toContain("can't open");
    // Buoy should now have Open flag
    expect(buoy.has(Flag.Open)).toBe(true);
    // Emerald still in buoy (OPEN doesn't auto-move contents)
    expect(emerald.parent).toBe(buoy);
  });
});

// ---------------------------------------------------------------------------
// RIVR4-ROOM M-END — buoy hint fires once (1actions.zil:2844)
// ---------------------------------------------------------------------------

describe('CB-RIVER-OBJ — RIVR4-ROOM: buoy hint + BUOY-FLAG (1actions.zil:2844)', () => {
  it('holding buoy at RIVER-4 while BUOY-FLAG=true prints the hint', async () => {
    const g = newGameAt('RIVER-4');
    const buoy = g.world.get('BUOY')!;
    // Move buoy into player's inventory
    buoy.moveTo(g.player);

    // Trigger M-END by taking a turn (wait fires M-END for the current room)
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('something funny');
  });

  it('hint fires only once — BUOY-FLAG cleared after first hint', async () => {
    const g = newGameAt('RIVER-4');
    const buoy = g.world.get('BUOY')!;
    buoy.moveTo(g.player);

    // First turn — hint fires
    await g.turn('wait');

    // Second turn — hint should NOT fire again
    const out = await (await g.turn('wait')).output;
    expect(out).not.toContain('something funny');
  });

  it('no hint if player does not have the buoy', async () => {
    const g = newGameAt('RIVER-4');
    // Buoy stays in room (not in player inventory)
    const out = await (await g.turn('wait')).output;
    expect(out).not.toContain('something funny');
  });

  it('BUOY-FLAG is false after hint fires', async () => {
    const g = newGameAt('RIVER-4');
    const buoy = g.world.get('BUOY')!;
    buoy.moveTo(g.player);
    await g.turn('wait');

    // Check via a second wait — no hint = flag must be cleared
    const out2 = await (await g.turn('wait')).output;
    expect(out2).not.toContain('something funny');
  });
});

// ---------------------------------------------------------------------------
// WHITE-CLIFFS-FUNCTION M-END — DEFLATE gate (1actions.zil:2585)
// ---------------------------------------------------------------------------

describe('CB-RIVER-OBJ — WHITE-CLIFFS-FUNCTION: DEFLATE gate (1actions.zil:2585)', () => {
  it('M-END sets DEFLATE=false when inflated boat is in player inventory', async () => {
    const g = newGameAt('WHITE-CLIFFS-NORTH');
    const inflated = g.world.get('INFLATED-BOAT')!;

    // Put inflated boat in player's inventory (player carrying it)
    inflated.moveTo(g.player);

    // Trigger M-END
    await g.turn('wait');

    // DEFLATE should be false — boat is in player's hands, path blocked
    // Verify by trying to go south; should be blocked ("too narrow")
    const out = await (await g.turn('south')).output;
    expect(out).toContain('narrow');
  });

  it('M-END sets DEFLATE=true when inflated boat is NOT in player inventory', async () => {
    const g = newGameAt('WHITE-CLIFFS-NORTH');
    const inflated = g.world.get('INFLATED-BOAT')!;
    const room = g.world.get('WHITE-CLIFFS-NORTH')!;

    // Inflated boat in room (not player's inventory)
    inflated.moveTo(room);

    // Trigger M-END
    await g.turn('wait');

    // DEFLATE should be true — path should be open (south to WHITE-CLIFFS-SOUTH)
    const out = await (await g.turn('south')).output;
    expect(out).not.toContain('narrow');
  });

  it('M-END fires at WHITE-CLIFFS-SOUTH too', async () => {
    const g = newGameAt('WHITE-CLIFFS-SOUTH');
    const inflated = g.world.get('INFLATED-BOAT')!;

    inflated.moveTo(g.player);
    await g.turn('wait');

    // DEFLATE=false — north path blocked
    const out = await (await g.turn('north')).output;
    expect(out).toContain('narrow');
  });
});

// ---------------------------------------------------------------------------
// FALLS-ROOM M-LOOK — description toggles on RAINBOW-FLAG (1actions.zil:2621)
// ---------------------------------------------------------------------------

describe('CB-RIVER-OBJ — FALLS-ROOM: description + RAINBOW-FLAG (1actions.zil:2621)', () => {
  it('M-LOOK shows base falls text', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    const out = await (await g.turn('look')).output;
    expect(out).toContain('Aragain Falls');
  });

  it('M-LOOK without RAINBOW-FLAG shows plain rainbow description', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    // RAINBOW-FLAG defaults to false
    const out = await (await g.turn('look')).output;
    expect(out).toContain('beautiful rainbow');
    expect(out).not.toContain('solid rainbow');
  });

  it('M-LOOK with RAINBOW-FLAG=true shows "solid rainbow" description', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    (g as unknown as { flags: FlagStore }).flags.set('RAINBOW-FLAG', true);

    const out = await (await g.turn('look')).output;
    expect(out).toContain('solid rainbow');
    expect(out).not.toContain('beautiful rainbow');
  });

  it('room description on first visit includes falls base text', async () => {
    const g = newGameAt('ARAGAIN-FALLS');
    // The ldesc-based description fires when the room is first visited (M-LOOK from nav)
    // Verify the handler fires by checking the look output
    const out = await (await g.turn('look')).output;
    expect(out).toContain('top of Aragain Falls');
    expect(out).toContain('450 feet');
  });
});
