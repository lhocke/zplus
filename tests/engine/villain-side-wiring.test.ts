/**
 * Villain-side wiring integration tests (spec §6.5, §7.1, §10, task "WIRE THE VILLAIN SIDE").
 *
 * TDD for the live-game villain path that was confirmed unconnected:
 *   - I-FIGHT registered in bootstrap (turnsLeft=-1 demon)
 *   - troll initiates within bounded turns when player idles
 *   - sustained fight accumulates wounds (pStrength < 0)
 *   - villain blow killing → jigsUp fires from clock context (fatalPending)
 *   - FIGHTBIT cleared after villain death (not set)
 *   - GWIM auto-selects held sword for bare "attack troll"
 *   - weapon desc (real desc) used in REMARK messages, not id-derived string
 *   - death banner has 4-space indent + blank lines (ZIL form)
 *   - TRAP-DOOR TOUCHBIT cleared on death
 *
 * ZIL refs:
 *   1actions.zil:3810–3841  I-FIGHT
 *   1actions.zil:3331–3357  DO-FIGHT
 *   1actions.zil:3566–3580  VILLAIN-RESULT
 *   1actions.zil:4046–4099  JIGS-UP
 *   1dungeon.zil:2644–2649  window offsets
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';
import type { Game } from '../../src/engine/game.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a game in TROLL-ROOM with sword in player inventory. */
function makeGame(combatRng?: ScriptedRng): Game {
  const g = createGame({ startRoom: 'TROLL-ROOM', combatRng });
  const sword = g.world.get('SWORD');
  expect(sword, 'SWORD must exist in world').toBeDefined();
  sword!.moveTo(g.player);
  return g;
}


// ---------------------------------------------------------------------------
// 1. I-FIGHT registered in bootstrap
// ---------------------------------------------------------------------------

describe('I-FIGHT bootstrap registration', () => {
  it('demon fires every turn (troll in room, FIGHTBIT set within 5 idle turns)', () => {
    // F_FIRST in troll-fcn fires with prob(33) — 0.1 will always succeed.
    const rng = new ScriptedRng([0.1]);
    const g = makeGame(rng);

    // Confirm troll is in troll-room
    const troll = g.world.get('TROLL');
    expect(troll).toBeDefined();
    expect(troll?.parent?.id).toBe('TROLL-ROOM');

    let fightBitSet = false;
    for (let i = 0; i < 5; i++) {
      g.turn('wait');
      if (troll?.has(Flag.Fight)) {
        fightBitSet = true;
        break;
      }
    }
    expect(fightBitSet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Sustained fight wounds player (pStrength < 0)
// ---------------------------------------------------------------------------

describe('sustained fight wounds player', () => {
  it('pStrength goes negative after villain blow landing a wound', () => {
    // Force LIGHT_WOUND (RES=4). DEF2_RES[0] = DEF2A@0 window; position 7 = LIGHT_WOUND.
    // nextInt(9) → 7 means draw 7/9 ≈ 0.777.  Use 0.78 to land on index 7 (LIGHT_WOUND).
    // But selectWindow draws depend on ATT/DEF.  Use a draw sequence that will produce
    // a wound.  Troll pStrength=2, player fightStrength at score=0 → base=2 (DEF tier 2).
    // DEF2_RES[ATT-1] with ATT=2 → DEF2_RES[1] = DEF2B@0 → [MISSED,MISSED,MISSED,STAGGER,STAGGER,
    //  LIGHT_WOUND,LIGHT_WOUND,LIGHT_WOUND,UNCONSCIOUS]. Index 5 = LIGHT_WOUND → draw 5/9 ≈ 0.556.
    //
    // For F_FIRST(prob 33) to fire: draw < 0.33.
    // Then selectWindow roll: 0.556 * 9 = 5.0 → floor=5 → index 5 = LIGHT_WOUND.
    // Then zprob check (STAGGER would need this, but LIGHT_WOUND doesn't) → not needed.
    // Then REMARK: randomElement → 0.x doesn't matter much.
    //
    // Simplified: use 0.2 for F_FIRST trigger, then 0.556 for the blow index.
    // After that the pattern repeats.
    const rng = new ScriptedRng([0.2, 0.556, 0.1, 0.1, 0.1, 0.1]);
    const g = makeGame(rng);

    // Wait several turns for I-FIGHT to fire and deal wounds
    for (let i = 0; i < 5; i++) {
      g.turn('wait');
    }
    // pStrength should have gone negative from wounds
    expect(g.player.pStrength).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. FIGHTBIT cleared after villain death
// ---------------------------------------------------------------------------

describe('FIGHTBIT cleared after villain death', () => {
  it('villain FIGHTBIT is clear (not set) after dying', () => {
    // In heroBlow: FSET villain FIGHTBIT at start.
    // villainResult with DEF==0 must FCLEAR it.
    // We test through the game: kill troll with a forced-kill sequence.
    // Force KILLED (RES=3). Troll pStrength=2. With player at score=0, ATT=max(1,2)=2.
    // DEF=2 → DEF2_RES[1] = DEF2B@0. Index 8 = UNCONSCIOUS... need KILLED.
    // DEF2B@0 = [MISSED,MISSED,MISSED,STAGGER,STAGGER,LIGHT_WOUND,LIGHT_WOUND,LIGHT_WOUND,UNCONSCIOUS]
    // That window has no KILLED... need higher ATT.
    // ATT clamped: DEF==2, ATT>3 → ATT=4. DEF2_RES[3]=DEF2B@2.
    // DEF2B = [MISSED,MISSED,MISSED,STAGGER,STAGGER,LIGHT_WOUND,LIGHT_WOUND,LIGHT_WOUND,UNCONSCIOUS,KILLED,KILLED,KILLED]
    // DEF2B@2: offset 2, takes elements [2..10] = [MISSED,STAGGER,STAGGER,LIGHT_WOUND,LIGHT_WOUND,LIGHT_WOUND,UNCONSCIOUS,KILLED,KILLED]
    // Index 7 = KILLED → draw 7/9 ≈ 0.778.
    //
    // But player score=0 → fightStrength=2 which is also the troll strength.
    // ATT = max(1, fightStrength(true=2)) = 2. clamp: ATT>3? No. ATT=2 → DEF2_RES[1]=DEF2B@0.
    // So we can't get KILLED from ATT=2/DEF=2 window directly...
    // Use a wound approach: set troll pStrength low first.
    // Actually, we can test this directly in isolation without full game.
    // This test uses the game to verify the flag is cleared, by first knocking troll to
    // pStrength=1 via wounds, then one more hit kills.
    //
    // Simpler: set troll's pStrength to 1 directly, then attack.
    // Force KILLED: player ATT=2 (score=0), villain DEF=1 → DEF1_RES[1]=DEF1@1.
    // DEF1 = [MISSED,MISSED,MISSED,MISSED,STAGGER,STAGGER,UNCONSCIOUS,UNCONSCIOUS,KILLED,KILLED,KILLED,KILLED,KILLED]
    // DEF1@1: elements [1..9] = [MISSED,MISSED,MISSED,STAGGER,STAGGER,UNCONSCIOUS,UNCONSCIOUS,KILLED,KILLED]
    // Index 7 = KILLED → draw 7/9 ≈ 0.778
    // Then randomElement: picks from HERO_MELEE slot 2 (KILLED has 3 variants) → 0.x
    const combatRng = new ScriptedRng([0.778, 0.1]);
    const g2 = createGame({ startRoom: 'TROLL-ROOM', combatRng });
    const sword2 = g2.world.get('SWORD');
    expect(sword2, 'SWORD must exist in world').toBeDefined();
    sword2!.moveTo(g2.player); sword2!.set(Flag.Weapon);
    const troll2 = g2.world.get('TROLL');
    expect(troll2, 'TROLL must exist in world').toBeDefined();
    (troll2 as unknown as { pStrength: number }).pStrength = 1;

    g2.turn('attack troll with sword');

    // After villain dies, FIGHTBIT must be cleared (not set)
    expect(troll2!.has(Flag.Fight)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Villain blow killing → jigsUp fires from clock context (fatalPending)
// ---------------------------------------------------------------------------

describe('clock-context death aborts turn', () => {
  it('jigsUp from I-FIGHT (clock context) ends turn cleanly without extra output', () => {
    // Force player to be killable: give them very negative pStrength (nearly dead).
    // Then a KILLED blow finishes them.
    // Set player pStrength to -1 (wounded near death).
    // KILLED sets DEF=0 → winnerResult → jigsUp.
    //
    // The key assertion: the turn() call returns a result (doesn't throw or hang),
    // and the output contains the death message.
    //
    // To force KILLED villain blow: troll pStrength=2 (ATT), player FS=1 (DEF tier 1).
    // Player at score=0 + pStrength=-1 → FS=2+(-1)=1. DEF1_RES[ATT-1=1] = DEF1@1.
    // DEF1@1 window = DEF1[1..9] = [M,M,M,S,S,U,U,K,K]
    // Index 7 = KILLED → draw 7/9 ≈ 0.778.
    // F_FIRST check: prob(33) → draw < 0.33. Use 0.2.
    // Then I-FIGHT triggers doFight → villainBlow roll: 0.778 → KILLED.
    // Then REMARK randomElement: 0.1.
    const rng = new ScriptedRng([0.2, 0.778, 0.1, 0.1]);
    const g = makeGame(rng);
    g.player.pStrength = -1;  // near death

    const result = g.turn('wait');
    expect(result.output).toContain('You have died');
  });
});

// ---------------------------------------------------------------------------
// 5. GWIM bare "attack troll" auto-selects held sword
// ---------------------------------------------------------------------------

describe('GWIM locBits — bare attack troll', () => {
  it('ARMED: bare "attack troll" with held sword → "(with the sword)" (dfrotz anchored)', () => {
    // dfrotz (release 119/880429): "attack troll" with sword in inventory →
    //   "(with the sword)"
    //   The troll takes a fatal blow and slumps to the floor dead.
    // GWIM searches room (P-SLOCBITS=-1 during match) AND inventory, finds sword.
    // ITAKE-CHECK: sword IS held → passes. Action proceeds.
    //
    // gparser.zil:1068-1078: GET-OBJECT always sets P-SLOCBITS=-1 before DO-SL HERE
    // and DO-SL PLAYER; locBits=194 (SH|SC|SHAVE) is the *post-match* ITAKE-CHECK
    // constraint, not the search gate.
    const g = createGame({ startRoom: 'TROLL-ROOM' });
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist in world').toBeDefined();
    sword!.moveTo(g.player); sword!.set(Flag.Weapon);
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist in world').toBeDefined();
    lamp!.moveTo(g.player); lamp!.set(Flag.OnFire); lamp!.set(Flag.Light);

    const result = g.turn('attack troll');
    expect(result.output).toContain('(with the sword)');
    expect(result.output).not.toContain("What do you want to");
  });

  it('UNARMED: bare "attack troll" lamp-only → "(with the bloody axe)" then "You don\'t have the bloody axe." (dfrotz anchored)', () => {
    // dfrotz (release 119/880429): "attack troll" with lamp only (no held weapon) →
    //   "(with the bloody axe)"
    //   You don't have the bloody axe.
    // GWIM finds axe in room (inside open troll). ITAKE-CHECK: axe not held, SHAVE bit
    // set → prints "You don't have the bloody axe." and aborts. Parenthetical printed
    // first because GWIM ran and found a single candidate.
    //
    // gparser.zil:1074-1078: DO-SL HERE SOG SIR runs unconditionally when LIT;
    // locBits gate only applies at ITAKE-CHECK (gparser.zil:1252-1290).
    const g = createGame({ startRoom: 'TROLL-ROOM' });
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist in world').toBeDefined();
    lamp!.moveTo(g.player); lamp!.set(Flag.OnFire); lamp!.set(Flag.Light);
    // sword stays in LIVING-ROOM; axe is in troll's inventory (troll in room)

    const result = g.turn('attack troll');
    expect(result.output).toContain('(with the bloody axe)');
    expect(result.output).toContain("You don't have the bloody axe.");
    expect(result.output).not.toContain("What do you want to");
  });
});

// ---------------------------------------------------------------------------
// 6. Weapon desc uses object's real desc, not id-derived string
// ---------------------------------------------------------------------------

describe('REMARK weapon desc', () => {
  it('weapon message uses real object desc, not id-derived string', () => {
    // When troll blows and LOSE_WEAPON fires, message should say "nasty knife"
    // not "KNIFE" (id-derived, uppercased) or bare "knife" without the adjective.
    // Use KNIFE (which has desc "nasty knife") in player's hand.
    // Force STAGGER → LOSE_WEAPON path in villainBlow.
    // Troll ATT=2 (pStrength), player DEF=2 (score=0 → FS=2).
    // DEF2_RES[1]=DEF2B@0. Index 3 = STAGGER → draw 3/9 ≈ 0.334.
    // Then zprob(25, denom): 0.1 * 100 < 25 → LOSE_WEAPON.
    // Then REMARK pick from TROLL_MELEE slot 6 (LOSE_WEAPON): 0.1.
    // F_FIRST: 0.2 fires.
    const combatRng = new ScriptedRng([0.2, 0.334, 0.1, 0.1, 0.1]);
    const g = createGame({ startRoom: 'TROLL-ROOM', combatRng });
    const knife = g.world.get('KNIFE');
    expect(knife, 'KNIFE must exist in world').toBeDefined();
    knife!.moveTo(g.player); knife!.set(Flag.Weapon);

    const result = g.turn('wait');
    // LOSE_WEAPON must fire: the RNG was scripted to force STAGGER → LOSE_WEAPON.
    // The REMARK message must use the real object desc "nasty knife", not the id.
    expect(result.output.toLowerCase(), 'knife must appear in output — LOSE_WEAPON did not fire').toContain('knife');
    expect(result.output).toContain('nasty knife');
    expect(result.output).not.toContain('KNIFE');
  });
});

// ---------------------------------------------------------------------------
// 7. Death banner format — 4-space indent + blank lines
// ---------------------------------------------------------------------------

describe('death banner format', () => {
  it('jigsUp output contains "    ****  You have died  ****" (4-space indent)', () => {
    // Trigger death via grue (simplest path)
    const g = createGame({ startRoom: 'CELLAR' });
    // Turn off lamp so it's dark, then move south (grue)
    // In CELLAR there's no lamp by default. Player is in dark.
    const result = g.turn('south');
    // Grue must kill in dark CELLAR — if not, the grue path is broken.
    expect(result.output, 'grue must kill the player in dark CELLAR').toContain('You have died');
    expect(result.output).toContain('    ****  You have died  ****');
  });
});

// ---------------------------------------------------------------------------
// 8. TRAP-DOOR TOUCHBIT cleared on death
// ---------------------------------------------------------------------------

describe('TRAP-DOOR TOUCHBIT cleared on death', () => {
  it('trap door TOUCHBIT cleared after jigsUp', () => {
    // Open the trap door (which sets TOUCHBIT), then die.
    const g = createGame({ startRoom: 'LIVING-ROOM' });
    const trapDoor = g.world.get('TRAP-DOOR');
    expect(trapDoor, 'TRAP-DOOR must exist in world').toBeDefined();

    // Manually set TOUCHBIT on trap door (simulates it being opened)
    trapDoor!.set(Flag.Touched);
    expect(trapDoor!.has(Flag.Touched)).toBe(true);

    // Trigger death (move to cellar → dark → grue)
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist in world').toBeDefined();
    lamp!.moveTo(g.player);
    g.turn('move rug');
    g.turn('open trap door');
    g.turn('down');
    // Now in cellar with lamp. Turn off lamp and go south.
    g.turn('turn off lamp');
    const dieResult = g.turn('south');

    // Grue must kill in dark CELLAR — if not, the grue path is broken.
    expect(dieResult.output, 'grue must kill player in dark CELLAR').toContain('You have died');
    // TRAP-DOOR TOUCHBIT must be cleared after death
    expect(trapDoor!.has(Flag.Touched)).toBe(false);
  });
});
