/**
 * Troll-wall tests — reworked at G1 (spec §10.3, §12 G1).
 *
 * Covers:
 *   - attack/kill troll fires real combat (non-empty, non-sign output)
 *   - attack non-troll yields graceful guard deflection
 *   - examine troll output unchanged vs golden
 *   - east/west blocked by authentic fend-off, TROLL-FLAG stays unset
 *   - no-troll context (West of House) falls through to faithful engine response
 *   - real-path reachability: walking the actual route into Troll Room reaches combat path
 *   - PHASE-1 TEMPORARY markers are GONE from both source files
 *   - Phase-2 coexistence guard: combat module present, markers absent
 *   - troll-kill walkthrough (test H): scripted fight → trollFlag=true, exits unblocked
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap';
import { Flag } from '../../src/domain/flags';
import { ScriptedRng } from '../helpers/scripted-rng';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const SIGN_FRAGMENT = 'THANK YOU FOR PLAYING';
const EXAMINE_TROLL_LINE =
  'A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the room.';
const FEND_OFF = 'The troll fends you off with a menacing gesture.';

// Real-world state: lit lantern + sword held; troll keeps the axe (its normal child).
function trollRoom() {
  const g = createGame({ startRoom: 'TROLL-ROOM' });
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

// No-sword variant: player arrives with only a lamp (no held weapon).
function trollRoomNoSword() {
  const g = createGame({ startRoom: 'TROLL-ROOM' });
  g.start();
  const w = (g as unknown as { world: { get(id: string): unknown } }).world;
  const player = w.get('PLAYER') as object | undefined;
  type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
  const lamp = w.get('LAMP') as Obj | undefined;
  if (lamp && player) { lamp.moveTo(player); lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
  return g;
}

describe('attack troll with sword => real combat (not the sign)', () => {
  it('attack troll with sword produces non-empty output', async () => {
    const r = await trollRoom().turn('attack troll with sword');
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });

  it('kill troll with sword produces non-empty output', async () => {
    const r = await trollRoom().turn('kill troll with sword');
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });
});

describe('attack troll without weapon => guard fires', () => {
  it('attack troll bare-handed (no sword) fires bare-hands guard', async () => {
    // No sword held — verbAttack guard 2 fires
    const r = await trollRoomNoSword().turn('attack troll');
    // Either bare-hands guard or parser can't find weapon — either way not the sign
    expect(r.output).not.toContain(SIGN_FRAGMENT);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('no troll present => faithful engine response, NOT the sign', () => {
  it('attack troll at West of House => not the sign', async () => {
    const g = createGame();
    g.start();
    const r = await g.turn('attack troll');
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });

  it('kill troll at West of House => not the sign', async () => {
    const g = createGame();
    g.start();
    const r = await g.turn('kill troll');
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });

  it('attack troll at West of House => engine produces a non-empty response', async () => {
    const g = createGame();
    g.start();
    const r = await g.turn('attack troll');
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });
});

describe('real-path reachability into Troll Room', () => {
  it('attack troll with sword after navigating to Troll Room fires real combat', async () => {
    const g = createGame();
    g.start();

    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const player = w.get('PLAYER') as object | undefined;
    type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
    const lamp = w.get('LAMP') as Obj | undefined;
    const sword = w.get('SWORD') as Obj | undefined;
    if (lamp && player) { lamp.moveTo(player); lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
    if (sword && player) { sword.moveTo(player); }

    await g.turn('north');
    await g.turn('east');
    await g.turn('open window');
    await g.turn('west');
    await g.turn('west');
    await g.turn('move rug');
    await g.turn('open trap door');
    await g.turn('down');
    const arrived = await g.turn('north');

    expect(arrived.output).toContain('troll');

    const r = await g.turn('attack troll with sword');
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });
});

describe('attack non-troll => graceful deflection (not an unimplemented-verb error)', () => {
  it('attack cyclops', async () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const player = w.get('PLAYER') as object | undefined;
    type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
    const lamp = w.get('LAMP') as Obj | undefined;
    const sword = w.get('SWORD') as Obj | undefined;
    if (lamp && player) { lamp.moveTo(player); lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
    if (sword && player) { sword.moveTo(player); }
    const r = await g.turn('attack cyclops');
    expect(r.output).not.toContain("I don't know how to");
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });
});

describe('golden-preserving guards', () => {
  it('examine troll output unchanged', async () => {
    const r = await trollRoom().turn('examine troll');
    expect(r.output).toBe(EXAMINE_TROLL_LINE);
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });

  it('east blocked by authentic fend-off', async () => {
    const r = await trollRoom().turn('east');
    expect(r.output).toBe(FEND_OFF);
  });

  it('west blocked by authentic fend-off', async () => {
    const r = await trollRoom().turn('west');
    expect(r.output).toBe(FEND_OFF);
  });

  it('attack troll does not set TROLL-FLAG when blow misses', async () => {
    // Force MISS: ATT=2, DEF=1 (SWORD vBestAdv), DEF1@1 window.
    // DEF1[1..9] = [M,M,M,S,S,U,U,K,K]; index 0 → MISS.
    // next()=0.1 → nextInt(9)=0 → DEF1[1+0]=MISSED.
    const combatRng = new ScriptedRng([0.1, 0.1, 0.1]);
    const g = createGame({ startRoom: 'TROLL-ROOM', combatRng });
    g.start();
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const player = w.get('PLAYER') as object | undefined;
    type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
    const lamp  = w.get('LAMP')  as Obj | undefined;
    const sword = w.get('SWORD') as Obj | undefined;
    if (lamp  && player) { lamp.moveTo(player);  lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
    if (sword && player) { sword.moveTo(player); }
    await g.turn('attack troll with sword');
    // Missed blow: TROLL-FLAG stays unset, east still fends off.
    // CA1: blocked move now ticks CLOCKER, so the troll's I-FIGHT demon may also
    // fire a counter-attack in the same output — use toContain, not toBe.
    const r = await g.turn('east');
    expect(r.output).toContain(FEND_OFF);
  });
});

describe('Phase-2 coexistence guard — markers gone, combat module present', () => {
  it('PHASE-1 TEMPORARY marker is absent from verbs/index.ts', () => {
    const verbsPath = path.join(REPO_ROOT, 'src/engine/verbs/index.ts');
    const src = fs.readFileSync(verbsPath, 'utf8');
    expect(src).not.toContain('PHASE-1 TEMPORARY');
  });

  it('PHASE-1 TEMPORARY marker is absent from game.ts', () => {
    const gamePath = path.join(REPO_ROOT, 'src/engine/game.ts');
    const src = fs.readFileSync(gamePath, 'utf8');
    expect(src).not.toContain('PHASE-1 TEMPORARY');
  });

  it('PHASE-1 marker does not coexist with a Phase-2 combat module', () => {
    const verbsPath = path.join(REPO_ROOT, 'src/engine/verbs/index.ts');
    const src = fs.readFileSync(verbsPath, 'utf8');
    const hasMarker = src.includes('PHASE-1 TEMPORARY');

    const combatPaths = [
      path.join(REPO_ROOT, 'src/engine/combat.ts'),
      path.join(REPO_ROOT, 'src/engine/combat.js'),
      path.join(REPO_ROOT, 'src/actions/combat.ts'),
    ];
    const hasCombatModule = combatPaths.some(p => fs.existsSync(p));

    expect(hasMarker && hasCombatModule).toBe(false);
  });
});

/**
 * Test H — Troll-kill walkthrough (spec §11.3 H).
 *
 * Scripted sword fight with forced RNG driving the troll to DEF=0.
 * Asserts: F_DEAD fired (trollFlag=true), exits unblocked, non-empty message
 * from HERO_MELEE slot. Structural — no text-match against exact strings.
 *
 * RNG design (score=0 → fightStrength_base=2, player pStrength=0):
 *   SWORD is troll's vBest (vBestAdv=1): villainStrength('TROLL',2,'SWORD')=max(1,2-1)=1
 *   So DEF=1 every round while troll pStrength>=1.
 *   ATT = max(1, fightStrength(true,0,0)) = max(1,2+0) = 2.
 *   selectWindow(ATT=2, DEF=1): DEF==1, ATT=2 → DEF1_RES[1] = DEF1@1
 *     DEF1@1 window = DEF1[1..9] = [M,M,M,S,S,U,U,K,K]
 *     Index 3 → STAGGER (next()=0.34 → floor(0.34*9)=3)
 *     Index 7 → KILLED  (next()=0.80 → floor(0.80*9)=7)
 *
 *   Round 1: nextInt(9)=3 → STAGGER (DEF1[1+3]=DEF1[4]=STAGGER)
 *     STAGGER + dweapon present → prob(25) draw; need ≥0.25 to preserve STAGGER.
 *     → villain staggered, pStrength unchanged; trollFlag stays false
 *     randomElement(HERO_MELEE[STAGGER-1=5], rng): 5 variants → next()=0.1 → variant 0
 *   Clock I-FIGHT (round 1 tick): troll STAGGERED → "regains feet", 0 draws.
 *
 *   east blocked tick: I-FIGHT fires; troll un-staggered; I-FIGHT passes prsiId=null →
 *     att = villainStrength(TROLL,2,entry,null,false,false) = 2 (no vBest reduction)
 *     def = fightStrength(true,35,0) = 2
 *     selectWindow(att=2, def=2, rng): DEF2_RES[1]=DEF2B@0 → DEF2B[0+nextInt(9)]
 *       next()=0.05 → nextInt(9)=0 → DEF2B[0]=MISSED
 *     slot = TROLL_MELEE[MISSED-1=0] has 4 variants → randomElement: nextInt(4)
 *       next()=0.80 → nextInt(4)=3 → variant 3 ("The axe crashes against the rock...")
 *
 *   Round 2: selectWindow(ATT=2,DEF=1): DEF1_RES[1]=DEF1@1 → DEF1[1+nextInt(9)]
 *     next()=0.80 → nextInt(9)=7 → DEF1[1+7]=DEF1[8]=KILLED
 *     → def=0, villainResult fires F_DEAD → trollFlag=true
 *     randomElement(HERO_MELEE[KILLED-1=2], rng): 3 variants → next()=0.1 → variant 0
 */
describe('troll-kill walkthrough (test H)', () => {
  function makeTrollKillRng() {
    // CA1 fix: "east" (blocked move) ticks CLOCKER → I-FIGHT fires an extra villain blow.
    // I-FIGHT uses prsiId=null so troll ATT=2 (no vBest reduction); DEF=2 → DEF2B@0 → MISSED.
    // TROLL_MELEE[MISSED-1=0] has 4 variants, consuming an extra randomElement draw.
    return new ScriptedRng([
      0.34,  // round 1 hero selectWindow: nextInt(9)=3 → STAGGER
      0.90,  // round 1 hero prob(25): 90*100≥25 → false → STAGGER preserved (no LOSE_WEAPON)
      0.1,   // round 1 hero randomElement HERO_MELEE[5] (5 variants): nextInt(5)=0 → variant 0
      // I-FIGHT (round 1 tick): troll STAGGERED → "regains feet", 0 draws
      // east blocked tick: I-FIGHT fires, troll un-staggered; prsiId=null; ATT=2,DEF=2 → DEF2B@0
      0.05,  // east villain selectWindow: nextInt(9)=0 → DEF2B[0]=MISSED
      0.80,  // east villain randomElement TROLL_MELEE[0] (4 variants): nextInt(4)=3 → variant 3
      // round 2 attack: ATT=2,DEF=1 (sword=vBest) → DEF1@1 → DEF1[1+nextInt(9)]
      0.80,  // round 2 hero selectWindow: nextInt(9)=7 → DEF1[8]=KILLED
      0.1,   // round 2 hero randomElement HERO_MELEE[2] (3 variants): nextInt(3)=0 → variant 0
      // I-FIGHT (round 2 tick): troll KILLED (pStrength=0) → no villain blow (FIGHTBIT cleared)
      0.5,   // padding
    ]);
  }

  function makeTrollKillGame() {
    const g = createGame({ startRoom: 'TROLL-ROOM', combatRng: makeTrollKillRng() });
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

  it('scripted sword fight kills troll: trollFlag=true, exits unblocked', async () => {
    const g = makeTrollKillGame();

    // Round 1: STAGGER — troll still alive, trollFlag stays false
    const r1 = await g.turn('attack troll with sword');
    expect(r1.output.length).toBeGreaterThan(0);
    expect(r1.output).not.toContain(SIGN_FRAGMENT);

    // After round 1: troll staggered but alive — exits still blocked.
    // CA1: blocked move now ticks CLOCKER, so the troll's I-FIGHT demon may also fire.
    const eastAfter1 = await g.turn('east');
    expect(eastAfter1.output).toContain(FEND_OFF);

    // Round 2: KILLED — F_DEAD fires
    const r2 = await g.turn('attack troll with sword');
    expect(r2.output.length).toBeGreaterThan(0);
    expect(r2.output).not.toContain(SIGN_FRAGMENT);

    // F_DEAD fired → trollFlag=true → exits now open
    const trollFlagGame = g as unknown as { flags: { get(n: string): boolean } };
    expect(trollFlagGame.flags.get('TROLL-FLAG')).toBe(true);

    // East exit is now unblocked
    const eastAfter2 = await g.turn('east');
    expect(eastAfter2.output).not.toBe(FEND_OFF);
  });

  it('west exit also unblocked after troll kill', async () => {
    const g = makeTrollKillGame();
    await g.turn('attack troll with sword');  // round 1: stagger
    await g.turn('east');                     // just advance turn state, discard output
    await g.turn('attack troll with sword');  // round 2: kill
    const westAfter2 = await g.turn('west');
    expect(westAfter2.output).not.toBe(FEND_OFF);
  });
});
