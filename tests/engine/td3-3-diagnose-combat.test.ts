/**
 * TD3-3 — verbDiagnose with live combat state (spec §12 e2)
 *
 * Done-criteria:
 *   (a) pStrength < 0 + I-CURE enabled → correct wound tier + survival line
 *   (b) I-CURE ticks player back to 0 → "perfect health" restored
 *   (c) Unwounded baseline byte-identical to existing golden surface
 *
 * ZIL refs:
 *   1actions.zil:3993–4024  V-DIAGNOSE
 *   1actions.zil:3593–3602  I-CURE
 */

import { describe, it, expect } from 'vitest';
import { executeVerb } from '../../src/engine/verbs/index.js';
import { iCure } from '../../src/engine/combat.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';

// ---------------------------------------------------------------------------
// Unit-level helper — drive verbDiagnose with injected state
// ---------------------------------------------------------------------------

interface DiagnoseState {
  score?: number;
  deaths?: number;
  playerPStrength?: number;
  iCureEnabled?: boolean;
  iCureTick?: number;
}

function diagnose(state: DiagnoseState = {}): string {
  const ctx: Partial<VerbContext> = {
    verb: 'diagnose',
    score:           state.score           ?? 0,
    deaths:          state.deaths          ?? 0,
    playerPStrength: state.playerPStrength ?? 0,
    iCureEnabled:    state.iCureEnabled    ?? false,
    iCureTick:       state.iCureTick       ?? 0,
  } as unknown as VerbContext;

  return executeVerb(ctx as VerbContext, 'V-DIAGNOSE').output;
}

// ---------------------------------------------------------------------------
// A. Unwounded baseline — byte-identical to existing golden
// ---------------------------------------------------------------------------

describe('TD3-3-A: unwounded baseline (pStrength=0, I-CURE disabled)', () => {
  it('score=0 → perfect health + "be killed by a serious wound"', () => {
    // MS = 2+floor(0/70)=2, WD=0 (I-CURE disabled), RS=2
    // RS=2 → "be killed by a serious wound"
    expect(diagnose()).toBe(
      'You are in perfect health.\nYou can be killed by a serious wound.',
    );
  });

  it('score=70 → perfect health + "survive one serious wound"', () => {
    // MS = 2+floor(70/70)=3, RS=3 → "survive one serious wound"
    expect(diagnose({ score: 70 })).toBe(
      'You are in perfect health.\nYou can survive one serious wound.',
    );
  });

  it('score=140 → perfect health + "survive several wounds"', () => {
    // MS = 2+floor(140/70)=4, RS=4 → "survive several wounds"
    expect(diagnose({ score: 140 })).toBe(
      'You are in perfect health.\nYou can survive several wounds.',
    );
  });

  it('deaths=1 appends killed-once line', () => {
    const out = diagnose({ deaths: 1 });
    expect(out).toContain('You have been killed once.');
    expect(out).not.toContain('twice');
  });
});

// ---------------------------------------------------------------------------
// B. Wounded player with I-CURE enabled — wound tier lines
// ---------------------------------------------------------------------------
//
// ZIL: when I-CURE IS enabled → WD = -pStrength (negate to get positive depth).
// pStrength is ≤0 when wounded.  WD=1 → light wound.
// Cured-after formula: CURE_WAIT*(WD-1) + iCureTick  (1actions.zil:4011–4014)

describe('TD3-3-B: wounded player (I-CURE enabled)', () => {
  it('pStrength=-1, iCureTick=30 → "a light wound, which will be cured after 30 moves."', () => {
    // WD = -(-1) = 1. CURE_WAIT*(1-1)+30 = 0+30 = 30.
    const out = diagnose({ playerPStrength: -1, iCureEnabled: true, iCureTick: 30 });
    expect(out).toContain('You have a light wound, which will be cured after 30 moves.');
  });

  it('pStrength=-2, iCureTick=15 → "a serious wound, which will be cured after 45 moves."', () => {
    // WD=2. 30*(2-1)+15 = 30+15 = 45.
    const out = diagnose({ playerPStrength: -2, iCureEnabled: true, iCureTick: 15 });
    expect(out).toContain('You have a serious wound, which will be cured after 45 moves.');
  });

  it('pStrength=-3, iCureTick=20 → "several wounds, which will be cured after 80 moves."', () => {
    // WD=3. 30*(3-1)+20 = 60+20 = 80.
    const out = diagnose({ playerPStrength: -3, iCureEnabled: true, iCureTick: 20 });
    expect(out).toContain('You have several wounds, which will be cured after 80 moves.');
  });

  it('pStrength=-4, iCureTick=10 → "serious wounds, which will be cured after 100 moves."', () => {
    // WD=4. 30*(4-1)+10 = 90+10 = 100.
    const out = diagnose({ playerPStrength: -4, iCureEnabled: true, iCureTick: 10 });
    expect(out).toContain('You have serious wounds, which will be cured after 100 moves.');
  });
});

// ---------------------------------------------------------------------------
// C. Survival line with wounds (RS = MS + pStrength)
// ---------------------------------------------------------------------------

describe('TD3-3-C: survival line reflects actual RS (score+pStrength)', () => {
  it('score=0, pStrength=-1 → RS=1 → "be killed by one more light wound"', () => {
    // MS=2, pStrength=-1, RS=2+(-1)=1.
    const out = diagnose({ playerPStrength: -1, iCureEnabled: true, iCureTick: 30 });
    expect(out).toContain('You can be killed by one more light wound.');
  });

  it('score=0, pStrength=-2 → RS=0 → "expect death soon"', () => {
    // MS=2, pStrength=-2, RS=2+(-2)=0.
    const out = diagnose({ playerPStrength: -2, iCureEnabled: true, iCureTick: 30 });
    expect(out).toContain('You can expect death soon.');
  });
});

// ---------------------------------------------------------------------------
// D. I-CURE disabled → WD forced to 0 even when pStrength < 0
// ---------------------------------------------------------------------------

describe('TD3-3-D: I-CURE disabled overrides pStrength', () => {
  it('pStrength=-3 but I-CURE disabled → perfect health (WD=0)', () => {
    // ZIL: if C-ENABLED? is 0 → SET WD 0 regardless of pStrength.
    const out = diagnose({ playerPStrength: -3, iCureEnabled: false, iCureTick: 0 });
    expect(out).toContain('You are in perfect health.');
    expect(out).not.toContain('You have ');  // no wound possession line
    expect(out).not.toContain('cured');
  });
});

// ---------------------------------------------------------------------------
// E. Integration via Game — combat leaves pStrength<0, diagnose reflects it
// ---------------------------------------------------------------------------

describe('TD3-3-E: integration — game.turn("diagnose") reflects live pStrength', () => {
  it('game with manually set pStrength reflects wound in diagnose', () => {
    const emitter = new SimpleEventEmitter();
    const game = createGame({ startRoom: 'WEST-OF-HOUSE', events: emitter });
    game.start();

    // Force pStrength to -1 and queue I-CURE directly on the player/clock.
    const player = (game as unknown as { player: { pStrength: number } }).player;
    player.pStrength = -1;
    // Enable I-CURE with 30 ticks remaining.
    const clock = (game as unknown as { clock: { queue(id: string, period: number, enabled: boolean): void } }).clock;
    clock.queue('I-CURE', 30, true);

    const out = game.turn('diagnose');
    expect(out.output).toContain('You have a light wound,');
    expect(out.output).toContain('which will be cured after');
    expect(out.output).toContain('You can be killed by one more light wound.');
  });

  it('after I-CURE fully heals (pStrength=0, disabled) → back to perfect health', () => {
    const emitter = new SimpleEventEmitter();
    const game = createGame({ startRoom: 'WEST-OF-HOUSE', events: emitter });
    game.start();

    const player = (game as unknown as { player: { pStrength: number } }).player;
    player.pStrength = -1;
    const clock = (game as unknown as { clock: { queue(id: string, period: number, enabled: boolean): void; disable(id: string): void } }).clock;
    clock.queue('I-CURE', 30, true);

    // Heal via iCure logic directly (simulate one tick that heals pStrength to 0).
    let disableCalled = false;
    iCure({
      getPlayerPStrength: () => player.pStrength,
      setPlayerPStrength: (v) => { player.pStrength = v; },
      getLoadAllowed: () => 100,
      setLoadAllowed: () => {},
      getLoadMax: () => 100,
      queueICure: () => {},
      disableICure: () => { disableCalled = true; clock.disable('I-CURE'); },
    });

    expect(player.pStrength).toBe(0);
    expect(disableCalled).toBe(true);

    const out = game.turn('diagnose');
    expect(out.output).toContain('You are in perfect health.');
    expect(out.output).not.toContain('You have ');  // no wound possession line
    expect(out.output).not.toContain('cured');
  });
});
