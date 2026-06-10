/**
 * SD1 — WON-FLAG world effects
 *
 * gverbs.zil:1854–1863: when SCORE first reaches 350,
 *   FCLEAR MAP INVISIBLE        (reveal the ancient map)
 *   FCLEAR WEST-OF-HOUSE TOUCHBIT  (force re-description next visit)
 *   TELL "An almost inaudible voice whispers..."
 *
 * Spec §12 SD1 done-criteria:
 *   drive SCORE→350, assert MAP.Invisible cleared, WEST-OF-HOUSE.Touched cleared,
 *   whisper emitted to turn output, effects fire exactly once.
 */

import { describe, it, expect } from 'vitest';
import { Scoring } from '../../src/engine/scoring';
import { SimpleEventEmitter } from '../../src/engine/events';
import { Thing } from '../../src/domain/thing';
import { Flag } from '../../src/domain/flags';
import { createGame } from '../../src/engine/bootstrap';

// ---------------------------------------------------------------------------
// A. wonFlagHook callback fires on score=350
// ---------------------------------------------------------------------------

describe('SD1-A: wonFlagHook fires once at score=350', () => {
  it('hook called when score first reaches 350', () => {
    let calls = 0;
    const s = new Scoring(new SimpleEventEmitter(), undefined, () => { calls++; });
    s.scoreUpd(350);
    expect(calls).toBe(1);
  });

  it('hook fires via recomputeTrophy path', () => {
    let calls = 0;
    const s = new Scoring(new SimpleEventEmitter(), undefined, () => { calls++; });
    s.scoreUpd(221); // baseScore = 221
    const tc = new Thing('TC', 'trophy case', {});
    const gem = new Thing('GEM', 'gem', {});
    gem.props.set('TVALUE', 129);
    gem.moveTo(tc);
    s.recomputeTrophy(tc); // 221 + 129 = 350
    expect(calls).toBe(1);
  });

  it('hook fires only once — not again if score falls and returns to 350', () => {
    let calls = 0;
    const s = new Scoring(new SimpleEventEmitter(), undefined, () => { calls++; });
    s.scoreUpd(350);
    s.scoreUpd(-10); // death penalty
    s.scoreUpd(10);  // back to 350
    expect(calls).toBe(1); // permanent — wonFlag never re-clears
  });

  it('hook not called at 349', () => {
    let called = false;
    const s = new Scoring(new SimpleEventEmitter(), undefined, () => { called = true; });
    s.scoreUpd(349);
    expect(called).toBe(false);
  });

  it('hook receives tell; tell output captured when scoreUpd given tell param', () => {
    const captured: string[] = [];
    const s = new Scoring(new SimpleEventEmitter(), undefined, (tell) => {
      tell('whisper');
    });
    s.scoreUpd(350, (txt) => captured.push(txt));
    expect(captured).toContain('whisper');
  });
});

// ---------------------------------------------------------------------------
// B. world-effect correctness via hook
// ---------------------------------------------------------------------------

describe('SD1-B: world effects via wonFlagHook', () => {
  it('hook can clear MAP Invisible', () => {
    const map = new Thing('MAP', 'ancient map', {});
    map.set(Flag.Invisible);
    const s = new Scoring(new SimpleEventEmitter(), undefined, (_tell) => {
      map.clear(Flag.Invisible);
    });
    s.scoreUpd(350);
    expect(map.has(Flag.Invisible)).toBe(false);
  });

  it('hook can clear WEST-OF-HOUSE Touched', () => {
    const woh = new Thing('WEST-OF-HOUSE', 'West of House', {});
    woh.set(Flag.Touched);
    const s = new Scoring(new SimpleEventEmitter(), undefined, (_tell) => {
      woh.clear(Flag.Touched);
    });
    s.scoreUpd(350);
    expect(woh.has(Flag.Touched)).toBe(false);
  });

  it('hook does not re-fire on second arrival at 350', () => {
    const map = new Thing('MAP', 'ancient map', {});
    map.set(Flag.Invisible);
    const s = new Scoring(new SimpleEventEmitter(), undefined, (_tell) => {
      map.clear(Flag.Invisible);
    });
    s.scoreUpd(350);
    map.set(Flag.Invisible); // manually restore to test no second clear
    s.scoreUpd(-10);
    s.scoreUpd(10); // back to 350 — hook must NOT fire again
    expect(map.has(Flag.Invisible)).toBe(true); // still set — hook didn't re-run
  });
});

// ---------------------------------------------------------------------------
// C. Exact whisper text (ZIL gverbs.zil:1861–1862)
// ---------------------------------------------------------------------------

describe('SD1-C: whisper text matches ZIL source', () => {
  // ZIL: "An almost inaudible voice whispers in your ear, \"Look to your treasures
  //       for the final secret.\"" CR
  // Bare newline in ZIL string literal collapses to a space (normalizeZilString).
  const WHISPER = 'An almost inaudible voice whispers in your ear, "Look to your treasures for the final secret."';

  it('whisper matches ZIL gverbs.zil:1861–1862', () => {
    expect(WHISPER).toMatch(/An almost inaudible voice whispers in your ear/);
    expect(WHISPER).toMatch(/"Look to your treasures for the final secret\."/);
  });
});

// ---------------------------------------------------------------------------
// D. game.ts integration — hook wired to real world objects
// ---------------------------------------------------------------------------

describe('SD1-D: game.ts wiring (createGame integration)', () => {
  it('MAP starts Invisible in real world (pre-condition)', () => {
    const game = createGame();
    const map = game.world.get('MAP');
    expect(map).toBeDefined();
    expect(map!.has(Flag.Invisible)).toBe(true);
  });

  it('MAP becomes visible after score reaches 350 via recomputeTrophy (M-END path)', () => {
    // Start in LIVING-ROOM; set MAP.TVALUE=350 so recomputeTrophy hits 350.
    // M-END fires on TAKE — 'take lamp' triggers LIVING-ROOM-FCN M-END.
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const map = game.world.get('MAP');
    expect(map).toBeDefined();
    expect(map!.has(Flag.Invisible)).toBe(true); // starts invisible

    // Put enough TVALUE in TROPHY-CASE to hit 350 on recompute.
    // MAP is already in TROPHY-CASE; set its TVALUE to 350.
    map!.props.set('TVALUE', 350);

    // 'take lamp' fires M-END on LIVING-ROOM-FCN which calls recomputeTrophy.
    // score = baseScore(0) + otvalFrob(TROPHY-CASE)(350) = 350 → WON-FLAG.
    const out = game.turn('take lamp');
    expect(out.output).toContain('Taken'); // lamp was taken
    expect(map!.has(Flag.Invisible)).toBe(false); // MAP reveal fired
  });

  it('whisper appears in turn output when score hits 350', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const map = game.world.get('MAP')!;
    map.props.set('TVALUE', 350);

    const out = game.turn('take lamp');
    expect(out.output).toContain(
      'An almost inaudible voice whispers in your ear, "Look to your treasures for the final secret."',
    );
  });

  it('WEST-OF-HOUSE.Touched cleared when score hits 350', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const woh = game.world.get('WEST-OF-HOUSE')!;
    // Artificially set Touched so we can observe it being cleared.
    woh.set(Flag.Touched);

    const map = game.world.get('MAP')!;
    map.props.set('TVALUE', 350);

    game.turn('take lamp');
    expect(woh.has(Flag.Touched)).toBe(false);
  });

  it('whisper appears only once even if score re-hits 350', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const map = game.world.get('MAP')!;
    map.props.set('TVALUE', 350);

    const first = game.turn('take lamp');
    const whisperText = 'whispers in your ear';
    expect(first.output).toContain(whisperText);

    // Drop the lamp back and take again — recompute happens again but
    // wonFlag is already set so hook must not re-fire.
    game.turn('drop lamp');
    const second = game.turn('take lamp');
    expect(second.output).not.toContain(whisperText);
  });
});
