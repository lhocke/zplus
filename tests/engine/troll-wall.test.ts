/**
 * Phase-1 troll-wall tests (spec §6, test strategy §9 §6).
 *
 * Covers:
 *   - attack/kill troll yields the sign (not an error)
 *   - attack troll with sword also yields the sign (GWIM iobj path)
 *   - attack non-troll yields graceful deflection
 *   - examine troll output unchanged vs golden
 *   - east/west blocked by authentic fend-off, TROLL-FLAG stays unset
 *   - PHASE-1 TEMPORARY marker present in verbs source
 *   - Phase-2 guard: test fails if marker coexists with a Phase-2 combat module
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap';
import { Flag } from '../../src/domain/flags';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const SIGN_FRAGMENT = 'THANK YOU FOR PLAYING';
const EXAMINE_TROLL_LINE =
  'A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the room.';
const FEND_OFF = 'The troll fends you off with a menacing gesture.';

// Give the player a lit lantern and the sword; remove the axe from scope so
// GWIM finds exactly one weapon and bare "attack troll" / "kill troll" resolve.
// The axe is a child of the troll — moving it to a far room keeps scope clean.
function trollRoom() {
  const g = createGame({ startRoom: 'TROLL-ROOM' });
  g.start();
  const w = (g as unknown as { world: { get(id: string): unknown } }).world;
  const player = w.get('PLAYER') as object | undefined;
  type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
  const lamp  = w.get('LAMP')  as Obj | undefined;
  const sword = w.get('SWORD') as Obj | undefined;
  const axe   = w.get('AXE')   as Obj | undefined;
  const away  = w.get('CELLAR') as object | undefined; // out of troll-room scope
  if (lamp  && player) { lamp.moveTo(player);  lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
  if (sword && player) { sword.moveTo(player); }
  if (axe   && away)  { axe.moveTo(away); }   // pull axe out of GWIM candidate set
  return g;
}

describe('attack/kill troll → sign (not an error)', () => {
  it('attack troll', () => {
    const r = trollRoom().turn('attack troll');
    expect(r.output).toContain(SIGN_FRAGMENT);
  });

  it('kill troll', () => {
    const r = trollRoom().turn('kill troll');
    expect(r.output).toContain(SIGN_FRAGMENT);
  });

  it('attack troll with sword (iobj path)', () => {
    // trollRoom() gives the player the sword; "with sword" explicitly names it.
    const r = trollRoom().turn('attack troll with sword');
    expect(r.output).toContain(SIGN_FRAGMENT);
  });
});

describe('attack non-troll → graceful deflection (not an unimplemented-verb error)', () => {
  it('attack cyclops', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    // Give lamp + sword so parser resolves the attack verb
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const player = w.get('PLAYER') as object | undefined;
    type Obj = { set(f: unknown): void; moveTo(d: unknown): void };
    const lamp = w.get('LAMP') as Obj | undefined;
    const sword = w.get('SWORD') as Obj | undefined;
    if (lamp && player) { lamp.moveTo(player); lamp.set(Flag.OnFire); lamp.set(Flag.Light); }
    if (sword && player) { sword.moveTo(player); }
    const r = g.turn('attack cyclops');
    // Should not be the raw "I don't know how to" fallthrough
    expect(r.output).not.toContain("I don't know how to");
    // Should not be the sign (sign is troll-only)
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });
});

describe('golden-preserving guards', () => {
  it('examine troll output unchanged', () => {
    const r = trollRoom().turn('examine troll');
    expect(r.output).toBe(EXAMINE_TROLL_LINE);
    // Sign must not bleed into examine path
    expect(r.output).not.toContain(SIGN_FRAGMENT);
  });

  it('east blocked by authentic fend-off', () => {
    const r = trollRoom().turn('east');
    expect(r.output).toBe(FEND_OFF);
  });

  it('west blocked by authentic fend-off', () => {
    const r = trollRoom().turn('west');
    expect(r.output).toBe(FEND_OFF);
  });

  it('attack troll does not set TROLL-FLAG', () => {
    const g = trollRoom();
    g.turn('attack troll');
    // TROLL-FLAG unset → east still fends off
    const r = g.turn('east');
    expect(r.output).toBe(FEND_OFF);
  });
});

describe('Phase-1 marker and Phase-2 guard', () => {
  it('PHASE-1 TEMPORARY marker present in verbs/index.ts', () => {
    const verbsPath = path.join(REPO_ROOT, 'src/engine/verbs/index.ts');
    const src = fs.readFileSync(verbsPath, 'utf8');
    expect(src).toContain('PHASE-1 TEMPORARY');
  });

  /**
   * Phase-2 guard (spec §6, §9): this test MUST FAIL once real combat lands.
   * It passes now because the Phase-2 combat module does not yet exist.
   * When Phase 2 ships src/engine/combat.ts (or similar), this test turns red —
   * the Phase-1 override and the combat module must not coexist.
   */
  it('PHASE-1 marker does not coexist with a Phase-2 combat module', () => {
    const verbsPath = path.join(REPO_ROOT, 'src/engine/verbs/index.ts');
    const src = fs.readFileSync(verbsPath, 'utf8');
    const hasMarker = src.includes('PHASE-1 TEMPORARY');

    // Candidate Phase-2 combat module paths
    const combatPaths = [
      path.join(REPO_ROOT, 'src/engine/combat.ts'),
      path.join(REPO_ROOT, 'src/engine/combat.js'),
      path.join(REPO_ROOT, 'src/actions/combat.ts'),
    ];
    const hasCombatModule = combatPaths.some(p => fs.existsSync(p));

    // Both must not be true simultaneously
    expect(hasMarker && hasCombatModule).toBe(false);
  });
});
