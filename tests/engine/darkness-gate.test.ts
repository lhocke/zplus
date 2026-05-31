/**
 * Darkness gate tests — P0-2 from enable-first-mechanics-audit.md.
 *
 * Verifies that describeCurrentRoom() / describeRoom() / describeRoomObjects()
 * are gated on lit(here, player, world):
 *   - when dark → emit verbatim pitch-black / grue message; skip room desc +
 *     object listing
 *   - when lit  → normal room description + object listing (unchanged)
 *
 * ZIL reference: gverbs.zil:1635-1686 (DESCRIBE-ROOM, DESCRIBE-OBJECTS).
 * Message strings: messages.json "describeRoom" block (darkNoSpray, darkSprayed).
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { World } from '../../src/domain/world.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function worldOf(g: ReturnType<typeof createGame>): World {
  return (g as unknown as { world: World }).world;
}

// ---------------------------------------------------------------------------
// 1. describeCurrentRoom() — gated via game.ts start() and post-move look
// ---------------------------------------------------------------------------

describe('darkness gate — describeCurrentRoom (game.ts start)', () => {
  it('starting in a dark room emits pitch-black message, not the room desc', () => {
    // CELLAR has no Flag.Light and no light sources present; player has no lamp.
    const g = newGameAt('CELLAR');
    const out = g.start();

    // Verbatim ZIL: "It is pitch black. You are likely to be eaten by a grue."
    expect(out).toContain('It is pitch black.');
    // Room name "Cellar" should NOT appear in the dark description
    expect(out).not.toContain('Cellar\n');
    // The static ldesc of CELLAR should not appear
    expect(out).not.toContain('The trap door');
  });

  it('starting in a dark room does not list room objects', () => {
    // CELLAR contains the TRAP-DOOR (or a slide) — they must not be listed
    const g = newGameAt('CELLAR');
    const out = g.start();

    // Should not contain object listing preamble
    expect(out).not.toContain('There is');
    expect(out).not.toContain('You can see');
  });

  it('starting in a lit room shows room description normally', () => {
    // WEST-OF-HOUSE has Flag.On (ONBIT always-lit) set — should render normally
    const g = newGameAt('WEST-OF-HOUSE');
    const out = g.start();

    expect(out).toContain('West of House');
    expect(out).not.toContain('pitch black');
  });
});

// ---------------------------------------------------------------------------
// 2. verbLook in a dark room (verbs/index.ts describeRoom)
// ---------------------------------------------------------------------------

describe('darkness gate — verbLook ("look") in dark room', () => {
  it('"look" in a dark room returns pitch-black message, no room name', () => {
    const g = newGameAt('CELLAR');
    g.start();

    const r = g.turn('look');

    expect(r.output).toContain('It is pitch black.');
    expect(r.output).not.toContain('Cellar\n');
    expect(r.output).not.toContain('The trap door');
  });

  it('"look" in a lit room returns full description', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    const r = g.turn('look');
    expect(r.output).toContain('West of House');
    expect(r.output).not.toContain('pitch black');
  });
});

// ---------------------------------------------------------------------------
// 3. Moving into a dark room (verbGo path, verbs/index.ts describeRoom)
// ---------------------------------------------------------------------------

describe('darkness gate — entering a dark room via movement', () => {
  it('moving from KITCHEN (lit) up into ATTIC (dark) shows moved-into-dark message', () => {
    // KITCHEN has Flag.On (ONBIT always-lit); ATTIC has no Flag.On and no light source nearby.
    // Player has no lamp.
    //
    // ZIL GOTO (gverbs.zil:2117-2120): when old room was lit and new room is dark
    // (lit→dark, first step into darkness), emit "You have moved into a dark place."
    // and stop — do NOT also call describeRoom.  On the NEXT turn, looking gives
    // the pitch-black message.  This matches ZIL: the grue gate fires only on
    // dark→dark; the lit→dark transition just warns.
    const g = newGameAt('KITCHEN');
    g.start();

    const r = g.turn('up');

    // First step into ATTIC: moved-into-dark notice (not pitch-black yet).
    expect(r.output).toContain('You have moved into a dark place.');
    expect(r.output).not.toContain('This is the attic');

    // Subsequent LOOK gives the pitch-black message.
    const look = g.turn('look');
    expect(look.output).toContain('It is pitch black.');
  });
});

// ---------------------------------------------------------------------------
// 4. SPRAYED? global: darkSprayed vs darkNoSpray
// ---------------------------------------------------------------------------

describe('darkness gate — SPRAYED? flag determines grue suffix', () => {
  it('when SPRAYED? is false, dark message includes grue warning', () => {
    const g = newGameAt('CELLAR');
    const out = g.start();

    // ZIL darkNoSpray: "It is pitch black. You are likely to be eaten by a grue."
    expect(out).toContain('You are likely to be eaten by a grue.');
  });

  it('when SPRAYED? is true, dark message omits grue warning', () => {
    const g = newGameAt('CELLAR');
    // Set the SPRAYED? global via the flag store (private — access via bracket)
    const flags = (g as unknown as { flags: { set(k: string, v: boolean): void } }).flags;
    flags.set('SPRAYED?', true);

    const out = g.start();

    // ZIL darkSprayed: "It is pitch black." (no grue)
    expect(out).toContain('It is pitch black.');
    expect(out).not.toContain('grue');
  });
});

// ---------------------------------------------------------------------------
// 5. Lamp on → room becomes lit
// ---------------------------------------------------------------------------

describe('darkness gate — lamp restores normal description', () => {
  it('starting in CELLAR with lit lamp shows room description, not pitch-black', () => {
    // Place the lamp in the player's inventory and turn it on BEFORE start()
    // so that describeCurrentRoom() is called with a lit scope.
    const g = newGameAt('CELLAR');
    const w = worldOf(g);
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire); // lit lamp

    const out = g.start();

    // Room should be described normally (not pitch black)
    expect(out).not.toContain('pitch black');
    expect(out).toContain('Cellar');
  });

  it('turning lamp off in CELLAR makes the next look return pitch-black', () => {
    const g = newGameAt('CELLAR');
    const w = worldOf(g);
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire); // lit lamp

    g.start(); // CELLAR description shown (lit)

    // Turn off lamp; look should show dark
    g.turn('turn off lantern');
    const r = g.turn('look');

    expect(r.output).toContain('It is pitch black.');
    expect(r.output).not.toContain('Cellar\n');
  });
});
