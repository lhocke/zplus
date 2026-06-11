/**
 * CB-LOUD — LOUD-ROOM-FCN + loud-room input mode
 *
 * Done-criteria (spec §9 Wave 1 CB-LOUD):
 *   - M-LOOK: base text + quiet or loud suffix keyed on state
 *   - M-END: loud + gates-open + !low-tide → panic scramble to LOUD-RUNS dest
 *   - Loud-room input mode: all non-whitelist input → "echo echo ..." (NM-D)
 *   - Whitelist: W/E/U exits and SAVE/RESTORE/QUIT pass through; ECHO solves
 *   - ECHO sets LOUD-FLAG + clears BAR.SACREDBIT (bar takeable after)
 *   - Mode exits when player leaves LOUD-ROOM
 *   - pickOne(LOUD-RUNS) panic destination ∈ {DAMP-CAVE, ROUND-ROOM, DEEP-CANYON}
 *
 * ZIL refs:
 *   LOUD-ROOM-FCN  1actions.zil:1660–1728
 *   LOUD-RUNS      1actions.zil:1261
 *   V-ECHO         gverbs.zil:526–548
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

function setFlags(g: Game, gatesOpen: boolean, lowTide: boolean) {
  flags(g).set('GATES-OPEN', gatesOpen);
  flags(g).set('LOW-TIDE', lowTide);
}

function giveLight(g: Game) {
  const lamp = g.world.get('LAMP')!;
  lamp.moveTo(g.player);
  lamp.set(Flag.OnFire);
}

const LOUD_RUNS = new Set(['DAMP-CAVE', 'ROUND-ROOM', 'DEEP-CANYON']);

// ---------------------------------------------------------------------------
// M-LOOK — 1actions.zil:1661–1673
//
// In loud mode, `look` is intercepted by the whitelist gate (echoes).
// Test M-LOOK via start() (initial room description on world start)
// and via quiet state where look is not intercepted.
// ---------------------------------------------------------------------------

describe('CB-LOUD — LOUD-ROOM-FCN M-LOOK: loud suffix (default state S0)', () => {
  // start() calls describeCurrentRoom() directly — fires M-LOOK without going
  // through the loudRoomDispatch whitelist gate.
  it('contains the base room description (via start)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.start();
    expect(out).toContain('large room with a ceiling');
    expect(out).toContain('narrow passage from east to west');
    expect(out).toContain('stairway leading upward');
  });

  it('S0 (gates closed, not low tide): room is deafeningly loud (via start)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.start();
    expect(out).toContain('deafeningly loud');
  });

  it('S2 (gates open, not low tide): room is deafeningly loud (via start)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, true, false);
    const out = g.start();
    expect(out).toContain('deafeningly loud');
  });
});

describe('CB-LOUD — LOUD-ROOM-FCN M-LOOK: quiet suffix', () => {
  it('LOUD-FLAG set: room is eerie in its quietness (via look)', () => {
    // Quiet state — loudRoomDispatch does not intercept, look fires M-LOOK normally.
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    flags(g).set('LOUD-FLAG', true);
    const out = g.turn('look').output;
    expect(out).toContain('eerie in its quietness');
    expect(out).not.toContain('deafeningly loud');
  });

  it('gates closed + low tide (S4): room is quiet (via look)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, true);
    const out = g.turn('look').output;
    expect(out).toContain('eerie in its quietness');
    expect(out).not.toContain('deafeningly loud');
  });
});

// ---------------------------------------------------------------------------
// M-END — 1actions.zil:1674–1680: loud panic scramble
// ---------------------------------------------------------------------------

describe('CB-LOUD — LOUD-ROOM-FCN M-END: panic scramble to LOUD-RUNS set', () => {
  it('when loud (gates open, !low-tide): scrambles player out of LOUD-ROOM', () => {
    // M-END fires after each turn; player ends up NOT in LOUD-ROOM
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, true, false);  // S2: gates open, not drained — loud
    // A wait will trigger M-END
    g.turn('wait');
    expect(g.world.get('PLAYER')!.parent?.id).not.toBe('LOUD-ROOM');
  });

  it('when loud: destination is one of LOUD-RUNS', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, true, false);
    g.turn('wait');
    const dest = g.world.get('PLAYER')!.parent?.id ?? '';
    expect(LOUD_RUNS.has(dest)).toBe(true);
  });

  it('when gates closed (M-END condition false): no panic scramble, player stays put', () => {
    // M-END condition: GATES-OPEN && !LOW-TIDE. With gates closed, no scramble.
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);  // gates closed → M-END does not fire scramble
    g.turn('wait');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });

  it('when quiet (gates closed + low tide): no panic scramble', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, true);
    g.turn('wait');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });
});

// ---------------------------------------------------------------------------
// Loud-room input mode (NM-D) — ratified OQ-1 seam
// ---------------------------------------------------------------------------

describe('CB-LOUD — loud-room input mode: whitelist gate (NM-D)', () => {
  it('non-whitelist input echoes the last word (V-ECHO behavior, gverbs.zil:529–545)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);  // S0: loud (default state)
    // "take bar" → last word is "bar" → "bar bar ..."
    const out = g.turn('take bar').output;
    expect(out).toMatch(/bar bar \.\.\./);
  });

  it('W exit passes through (moves west to ROUND-ROOM)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('west');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('ROUND-ROOM');
  });

  it('E exit passes through (moves east to DAMP-CAVE)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('east');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('DAMP-CAVE');
  });

  it('U exit passes through (moves up to DEEP-CANYON)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('up');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('DEEP-CANYON');
  });

  it('ECHO in loud mode sets LOUD-FLAG', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('echo');
    expect(flags(g).get('LOUD-FLAG')).toBe(true);
  });

  it('ECHO in loud mode prints "acoustics of the room change subtly"', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('echo').output;
    expect(out).toContain('acoustics of the room change subtly');
  });

  it('ECHO clears BAR.SACREDBIT (bar becomes takeable)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const bar = g.world.get('BAR')!;
    expect(bar.has(Flag.Sacred)).toBe(true);  // starts sacred
    g.turn('echo');
    expect(bar.has(Flag.Sacred)).toBe(false); // cleared by ECHO
  });

  it('after ECHO (LOUD-FLAG set), normal verbs work', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('echo');
    // Now quiet — take bar should succeed (no echo gate)
    const out = g.turn('take bar').output;
    expect(out).not.toContain('echo');
  });

  it('bar untakeable while loud (SACREDBIT blocks take)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const bar = g.world.get('BAR')!;
    expect(bar.has(Flag.Sacred)).toBe(true);
    // In loud mode, take bar echoes; bar stays in room
    g.turn('take bar');
    expect(bar.parent?.id).toBe('LOUD-ROOM');
  });

  it('mode exits when player leaves: non-whitelist input works after leaving', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('west');  // exit to ROUND-ROOM
    // Now in ROUND-ROOM (not loud mode); examine should work normally
    const out = g.turn('look').output;
    expect(out).not.toContain('echo');
  });
});

// ---------------------------------------------------------------------------
// ECHO action in quiet mode — falls through to V-ECHO (gverbs.zil:526)
// ---------------------------------------------------------------------------

describe('CB-LOUD — ECHO in quiet room: V-ECHO fallback', () => {
  it('ECHO outside LOUD-ROOM: "echo echo ..." (V-ECHO fallback)', () => {
    const g = newGameAt('LIVING-ROOM');
    giveLight(g);
    const out = g.turn('echo').output;
    expect(out).toContain('echo');
  });
});

// ---------------------------------------------------------------------------
// Observable faithfulness bugs (repair CB-LOUD)
// ---------------------------------------------------------------------------

describe('CB-LOUD — whitelist: only W/E/U pass; N/S/D echo (1actions.zil:1711–1716)', () => {
  // ZIL whitelist only passes W?W/W?WEST, W?E/W?EAST, W?U/W?UP.
  // N, S, D are NOT in the whitelist → fall to T → V-ECHO ("north north ...").
  it('north in loud mode echoes, player stays in LOUD-ROOM', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('north').output;
    expect(out).toContain('north north');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });

  it('south in loud mode echoes, player stays in LOUD-ROOM', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('south').output;
    expect(out).toContain('south south');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });

  it('down in loud mode echoes, player stays in LOUD-ROOM', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('down').output;
    expect(out).toContain('down down');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });
});

describe('CB-LOUD — echo text: last-word-twice + "..." (gverbs.zil:526–548)', () => {
  // V-ECHO echoes the LAST lexed word twice + "...".
  // Only falls back to "echo echo ..." when P-LEXWORDS == 0 (empty input).
  it('take bar → "bar bar ..." (last word is "bar")', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('take bar').output;
    expect(out).toMatch(/bar bar \.\.\./);
    expect(out).not.toMatch(/^echo echo/m);
  });

  it('diagnose → "diagnose diagnose ..."', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('diagnose').output;
    expect(out).toMatch(/diagnose diagnose \.\.\./);
  });

  it('xyzzy → "xyzzy xyzzy ..."', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('xyzzy').output;
    expect(out).toMatch(/xyzzy xyzzy \.\.\./);
  });

  it('read the ancient leaflet → "leaflet leaflet ..." (no normal parser error)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('read the ancient leaflet').output;
    expect(out).toMatch(/leaflet leaflet \.\.\./);
    expect(out).not.toContain("can't see");
  });
});

describe('CB-LOUD — unparseable input echoes; no parser errors escape (1actions.zil:1693–1728)', () => {
  // ZIL reads raw P-LEXV words; parser errors never surface inside the loud room.
  // "say xyzzy" → WRD=slot5="xyzzy", matches nothing → V-ECHO → "xyzzy xyzzy ..."
  it('say xyzzy → echoes "xyzzy xyzzy ..." (no "I recognize" error)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('say xyzzy').output;
    expect(out).toMatch(/xyzzy xyzzy \.\.\./);
    expect(out).not.toContain("recognize");
  });

  it('press red button → echoes last word, no "can\'t see" error', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('press red button').output;
    expect(out).toMatch(/button button \.\.\./);
    expect(out).not.toContain("can't see");
  });

  it('flibber the wuggle → echoes "wuggle wuggle ...", no unknown-word error', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('flibber the wuggle').output;
    expect(out).toMatch(/wuggle wuggle \.\.\./);
    expect(out).not.toContain("don't know the word");
  });
});

describe('CB-LOUD — V-BUG whitelist branch (1actions.zil:1717–1718)', () => {
  // W?BUG is a named special case in the ZIL whitelist:
  //   (<EQUAL? .WRD ,W?BUG> <TELL "That's only your opinion." CR>)
  it('bug → "That\'s only your opinion." (not an echo)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('bug').output;
    expect(out).toContain("That's only your opinion.");
    expect(out).not.toContain('echo');
  });

  it('bug: player stays in LOUD-ROOM', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    g.turn('bug');
    expect(g.world.get('PLAYER')!.parent?.id).toBe('LOUD-ROOM');
  });
});

describe('CB-LOUD — ECHO solve: room re-description follows (1actions.zil:1719–1728)', () => {
  // After <RETURN> from the ZIL REPEAT loop, M-ENTER finishes and the game
  // fires a normal turn: LOUD-FLAG is set → room is now quiet → M-LOOK fires,
  // producing the "eerie in its quietness" description.
  it('ECHO solve output includes the room re-description', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('echo').output;
    // Message first, then blank line, then room name / description
    expect(out).toContain('acoustics of the room change subtly');
    expect(out).toContain('Loud Room');
  });

  it('ECHO solve room description shows quiet suffix', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    setFlags(g, false, false);
    const out = g.turn('echo').output;
    expect(out).toContain('eerie in its quietness');
  });
});
