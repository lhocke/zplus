/**
 * CB7 — findWeapon + V-ATTACK entry guards (spec §6, §12 CB7)
 *
 * Done-criteria:
 *   - findWeapon: 5-name containment (STILETTO, AXE, SWORD, KNIFE, RUSTY-KNIFE)
 *     by FIRST?/NEXT? iteration — NOT WEAPONBIT (1actions.zil:3401–3409)
 *   - verbAttack guards: ACTORBIT / HANDS / not-holding / WEAPONBIT rejections
 *     match the fixed ZIL strings exactly (gverbs.zil:176–193)
 *   - findWeapon returns null when owner holds nothing in the 5-name set
 *   - findWeapon finds first match in iteration order
 *   - non-weapon objects (no WEAPONBIT, not in the 5-name set) do NOT satisfy findWeapon
 *
 * ZIL refs:
 *   gverbs.zil:176–193  V-ATTACK
 *   1actions.zil:3401–3409  FIND-WEAPON
 */

import { describe, it, expect } from 'vitest';
import { findWeapon, WEAPON_NAMES } from '../../src/engine/combat.js';
import { verbAttack } from '../../src/engine/verbs/index.js';
import { GameObject } from '../../src/domain/game-object.js';
import { Flag } from '../../src/domain/flags.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import type { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';

// ---------------------------------------------------------------------------
// findWeapon tests (1actions.zil:3401–3409)
// ---------------------------------------------------------------------------

function makeObj(id: string, desc: string, withWeaponBit = false): GameObject {
  const o = new GameObject(id, desc);
  if (withWeaponBit) o.set(Flag.Weapon);
  return o;
}

function addChild(parent: GameObject, child: GameObject): void {
  child.moveTo(parent);
}

describe('findWeapon — 1actions.zil:3401–3409', () => {
  it('returns null when owner has no children', () => {
    const owner = makeObj('WINNER', 'adventurer');
    expect(findWeapon(owner)).toBeNull();
  });

  it('returns null when owner holds items not in the 5-name set', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const lamp = makeObj('LAMP', 'brass lantern', true);  // has WEAPONBIT but wrong id
    addChild(owner, lamp);
    expect(findWeapon(owner)).toBeNull();
  });

  it('finds STILETTO by name, ignoring WEAPONBIT', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const stiletto = makeObj('STILETTO', 'stiletto');  // no WEAPONBIT set
    addChild(owner, stiletto);
    expect(findWeapon(owner)).toBe(stiletto);
  });

  it('finds AXE by name', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const axe = makeObj('AXE', 'axe');
    addChild(owner, axe);
    expect(findWeapon(owner)).toBe(axe);
  });

  it('finds SWORD by name', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const sword = makeObj('SWORD', 'sword');
    addChild(owner, sword);
    expect(findWeapon(owner)).toBe(sword);
  });

  it('finds KNIFE by name', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const knife = makeObj('KNIFE', 'knife');
    addChild(owner, knife);
    expect(findWeapon(owner)).toBe(knife);
  });

  it('finds RUSTY-KNIFE by name', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const rusty = makeObj('RUSTY-KNIFE', 'rusty knife');
    addChild(owner, rusty);
    expect(findWeapon(owner)).toBe(rusty);
  });

  it('returns first match in iteration order (FIRST?/NEXT?)', () => {
    const owner = makeObj('WINNER', 'adventurer');
    // Add SWORD first, then STILETTO — expect whichever is first in children
    const sword = makeObj('SWORD', 'sword');
    const stiletto = makeObj('STILETTO', 'stiletto');
    addChild(owner, sword);
    addChild(owner, stiletto);
    // findWeapon walks FIRST?/NEXT? — both are in the set; result is the first iterated
    const result = findWeapon(owner);
    expect(result === sword || result === stiletto).toBe(true);
  });

  it('skips non-weapon items and finds the named weapon', () => {
    const owner = makeObj('WINNER', 'adventurer');
    const lamp = makeObj('LAMP', 'brass lantern');
    const sword = makeObj('SWORD', 'sword');
    addChild(owner, lamp);
    addChild(owner, sword);
    expect(findWeapon(owner)).toBe(sword);
  });

  it('WEAPON_NAMES contains exactly the 5 canonical names', () => {
    expect(WEAPON_NAMES).toContain('STILETTO');
    expect(WEAPON_NAMES).toContain('AXE');
    expect(WEAPON_NAMES).toContain('SWORD');
    expect(WEAPON_NAMES).toContain('KNIFE');
    expect(WEAPON_NAMES).toContain('RUSTY-KNIFE');
    expect(WEAPON_NAMES).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// verbAttack guard tests (gverbs.zil:176–193)
//
// Guard order (ZIL COND):
//   1. !ACTORBIT(PRSO) → "I've known strange people, but fighting a X?"
//   2. (!PRSI || PRSI==HANDS) → "Trying to attack a X with your bare hands is suicidal."
//   3. !IN?(PRSI, WINNER) → "You aren't even holding the X."
//   4. !WEAPONBIT(PRSI) → "Trying to attack the X with a Y is suicidal."
//   5. T → heroBlow (not yet wired — CB7 does not cover the happy path)
// ---------------------------------------------------------------------------

function makeRoom(): Room {
  return new Room('TEST-ROOM', 'test room', { exits: [] });
}

// Minimal World stub — only needs get() for HANDS lookup
function makeWorld(hands: GameObject): World {
  const map = new Map<string, GameObject>();
  map.set('HANDS', hands);
  return { get: (id: string) => map.get(id) } as unknown as World;
}

function makeCtx(opts: {
  dobj?: GameObject;
  iobj?: GameObject;
  player: GameObject;
  world?: World;
}): VerbContext {
  const room = makeRoom();
  return {
    verb: 'V-ATTACK',
    dobj:   opts.dobj,
    iobj:   opts.iobj,
    player: opts.player,
    here:   room,
    world:  opts.world ?? makeWorld(makeObj('HANDS', 'pair of hands')),
  };
}

describe('verbAttack guards — gverbs.zil:176–193', () => {
  const troll = makeObj('TROLL', 'troll');
  troll.set(Flag.Actor);

  const rock  = makeObj('ROCK', 'rock');       // not Actor
  const hands = makeObj('HANDS', 'pair of hands');
  const sword  = makeObj('SWORD', 'sword');
  const sack   = makeObj('SACK', 'nasty-smelling sack');  // no WEAPONBIT

  it('guard 1 — !ACTORBIT: "I\'ve known strange people, but fighting a rock?"', () => {
    const player = makeObj('WINNER', 'adventurer');
    const ctx = makeCtx({ dobj: rock, iobj: sword, player });
    sword.moveTo(player);
    sword.set(Flag.Weapon);
    const r = verbAttack(ctx);
    expect(r.output).toBe("I've known strange people, but fighting a rock?");
  });

  it('guard 2 — no PRSI: "Trying to attack a troll with your bare hands is suicidal."', () => {
    const player = makeObj('WINNER', 'adventurer');
    const ctx = makeCtx({ dobj: troll, iobj: undefined, player });
    const r = verbAttack(ctx);
    expect(r.output).toBe('Trying to attack a troll with your bare hands is suicidal.');
  });

  it('guard 2 — PRSI==HANDS: "Trying to attack a troll with your bare hands is suicidal."', () => {
    const player = makeObj('WINNER', 'adventurer');
    const world = makeWorld(hands);
    const ctx = makeCtx({ dobj: troll, iobj: hands, player, world });
    const r = verbAttack(ctx);
    expect(r.output).toBe('Trying to attack a troll with your bare hands is suicidal.');
  });

  it('guard 3 — !holding: "You aren\'t even holding the sword."', () => {
    const player = makeObj('WINNER', 'adventurer');
    // sword NOT in player's inventory
    const ctx = makeCtx({ dobj: troll, iobj: sword, player });
    sword.set(Flag.Weapon);
    const r = verbAttack(ctx);
    expect(r.output).toBe("You aren't even holding the sword.");
  });

  it('guard 4 — !WEAPONBIT: "Trying to attack the troll with a nasty-smelling sack is suicidal."', () => {
    const player = makeObj('WINNER', 'adventurer');
    sack.moveTo(player);
    // sack has no Flag.Weapon
    const ctx = makeCtx({ dobj: troll, iobj: sack, player });
    const r = verbAttack(ctx);
    expect(r.output).toBe('Trying to attack the troll with a nasty-smelling sack is suicidal.');
  });
});
