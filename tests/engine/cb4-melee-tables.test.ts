/**
 * CB4 — REMARK + all four MELEE tables (spec §8 + §12 CB4).
 *
 * ZIL refs:
 *   1actions.zil:3363–3370  REMARK / RANDOM-ELEMENT
 *   1actions.zil:3611–3648  HERO_MELEE   (7 slots)
 *   1actions.zil:3654–3683  CYCLOPS_MELEE (9 slots)
 *   1actions.zil:3689–3729  TROLL_MELEE  (9 slots)
 *   1actions.zil:3735–3788  THIEF_MELEE  (9 slots)
 *
 * Data model (§8.1):
 *   Each MELEE slot is a "frob" — a length-prefixed LTABLE of variant LTABLEs:
 *     slot[0]     = variant count N
 *     slot[1..N]  = variant LTABLE arrays
 *   Each variant LTABLE is [length, token0, token1, ...] where tokens are
 *   string literals or F_WEP / F_DEF sentinels.
 *
 * randomElement(frob, rng): returns frob[1 + rng.nextInt(frob[0])]
 * remark(ltable, defender, weapon, emit): renders each token[1..ltable[0]]
 *
 * Done-criteria (spec §12 CB4):
 *   - test I: remark() renders F_WEP/F_DEF tokens; randomElement indexes [1..N]
 *   - slot/variant counts asserted per §8.2
 *   - 96-message total
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/engine/rng.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';
import {
  F_WEP, F_DEF,
  HERO_MELEE, CYCLOPS_MELEE, TROLL_MELEE, THIEF_MELEE,
  remark, randomElement,
} from '../../src/engine/combat.js';

// ScriptedRng satisfies the Rng interface structurally (same public methods),
// but the class check fails because Rng has private state.  Cast once here.
function asRng(s: ScriptedRng): Rng { return s as unknown as Rng; }

// Helpers — extract variant count and variants from a frob-style slot.
// slot[0] = count; slot[1..count] = variant LTABLEs.
function slotCount(slot: readonly (number | readonly (string | number)[])[]) {
  return slot[0] as number;
}
function slotVariant(slot: readonly (number | readonly (string | number)[])[],  i: number) {
  return slot[1 + i] as readonly (string | number)[];
}

// ---------------------------------------------------------------------------
// Test I — remark() assembly and randomElement indexing (spec §11.3 / §8.1)
// ---------------------------------------------------------------------------

describe('remark() and randomElement() — test I', () => {
  it('renders a plain string literal verbatim', () => {
    // ltable = [1, "msg"]
    const ltable = [1, 'The troll misses.'];
    const parts: string[] = [];
    remark(ltable, 'troll', 'axe', s => parts.push(s));
    expect(parts).toEqual(['The troll misses.']);
  });

  it('renders F_WEP token to weapon desc', () => {
    const ltable = [1, F_WEP];
    const parts: string[] = [];
    remark(ltable, 'defender', 'sword', s => parts.push(s));
    expect(parts).toEqual(['sword']);
  });

  it('renders F_DEF token to defender desc', () => {
    const ltable = [1, F_DEF];
    const parts: string[] = [];
    remark(ltable, 'troll', 'axe', s => parts.push(s));
    expect(parts).toEqual(['troll']);
  });

  it('renders mixed LTABLE in order', () => {
    // "The " F-DEF " swings at " F-WEP "."
    const ltable = [5, 'The ', F_DEF, ' swings at ', F_WEP, '.'];
    const parts: string[] = [];
    remark(ltable, 'giant', 'axe', s => parts.push(s));
    expect(parts.join('')).toBe('The giant swings at axe.');
  });

  it('emits empty string for F_WEP when weapon is empty', () => {
    const ltable = [2, 'Unarmed: ', F_WEP];
    const parts: string[] = [];
    remark(ltable, 'troll', '', s => parts.push(s));
    // empty weapon → empty string emitted, not skipped
    expect(parts.join('')).toBe('Unarmed: ');
  });

  it('randomElement returns frob[1 + nextInt(frob[0])] — index 0 → frob[1]', () => {
    // frob[0]=3, frob[1]=v1, frob[2]=v2, frob[3]=v3
    const v1 = [1, 'one'];
    const v2 = [1, 'two'];
    const v3 = [1, 'three'];
    const frob = [3, v1, v2, v3];
    // nextInt(3)=0 → frob[1]=v1
    expect(randomElement(frob as any, asRng(new ScriptedRng([0 / 3])))).toBe(v1);
  });

  it('randomElement returns frob[1 + nextInt(frob[0])] — index 2 → frob[3]', () => {
    const v1 = [1, 'one'];
    const v2 = [1, 'two'];
    const v3 = [1, 'three'];
    const frob = [3, v1, v2, v3];
    // nextInt(3)=2 → frob[3]=v3
    expect(randomElement(frob as any, asRng(new ScriptedRng([2.9 / 3])))).toBe(v3);
  });

  it('randomElement never returns frob[0] (the length prefix)', () => {
    const v1 = [1, 'msg'];
    const frob = [1, v1];
    for (let i = 0; i < 10; i++) {
      const result = randomElement(frob as any, asRng(new ScriptedRng([i / 10])));
      expect(result).not.toBe(1);
      expect(result).toBe(v1);
    }
  });
});

// ---------------------------------------------------------------------------
// HERO_MELEE — 1actions.zil:3611 — 7 slots, variants [6,5,3,4,4,5,2] = 29
// ---------------------------------------------------------------------------

describe('HERO_MELEE structure (1actions.zil:3611–3648)', () => {
  it('has exactly 7 slots (NM-6: HERO-BLOW never indexes slots 7/8)', () => {
    expect(HERO_MELEE.length).toBe(7);
  });

  it('slot 0 (MISSED): 6 variants', () => {
    expect(slotCount(HERO_MELEE[0]!)).toBe(6);
  });

  it('slot 1 (UNCONSCIOUS): 5 variants', () => {
    expect(slotCount(HERO_MELEE[1]!)).toBe(5);
  });

  it('slot 2 (KILLED): 3 variants', () => {
    expect(slotCount(HERO_MELEE[2]!)).toBe(3);
  });

  it('slot 3 (LIGHT_WOUND): 4 variants', () => {
    expect(slotCount(HERO_MELEE[3]!)).toBe(4);
  });

  it('slot 4 (SERIOUS_WOUND): 4 variants', () => {
    expect(slotCount(HERO_MELEE[4]!)).toBe(4);
  });

  it('slot 5 (STAGGER): 5 variants', () => {
    expect(slotCount(HERO_MELEE[5]!)).toBe(5);
  });

  it('slot 6 (LOSE_WEAPON): 2 variants', () => {
    expect(slotCount(HERO_MELEE[6]!)).toBe(2);
  });

  it('total variant count is 29', () => {
    const total = HERO_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    expect(total).toBe(29);
  });

  it('slot 0 variant 0 contains "misses" (1actions.zil:3614)', () => {
    const ltable = slotVariant(HERO_MELEE[0]!, 0);
    const text = ltable.slice(1).filter(t => typeof t === 'string').join('');
    expect(text).toContain('misses');
  });

  it('slot 2 variant 0 contains "removes his head" (1actions.zil:3627)', () => {
    const ltable = slotVariant(HERO_MELEE[2]!, 0);
    const text = ltable.slice(1).filter(t => typeof t === 'string').join('');
    expect(text).toContain('removes his head');
  });

  it('slot 6 variant 1 contains "disarmed" (1actions.zil:3648)', () => {
    const ltable = slotVariant(HERO_MELEE[6]!, 1);
    const text = ltable.slice(1).filter(t => typeof t === 'string').join('');
    expect(text).toContain('disarmed');
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS_MELEE — 1actions.zil:3654 — 9 slots, variants [2,1,1,2,2,2,2,1,1] = 14
// ---------------------------------------------------------------------------

describe('CYCLOPS_MELEE structure (1actions.zil:3654–3683)', () => {
  it('has exactly 9 slots', () => {
    expect(CYCLOPS_MELEE.length).toBe(9);
  });

  it('slot 0 (MISSED): 2 variants', () => {
    expect(slotCount(CYCLOPS_MELEE[0]!)).toBe(2);
  });

  it('slot 1 (UNCONSCIOUS): 1 variant', () => {
    expect(slotCount(CYCLOPS_MELEE[1]!)).toBe(1);
  });

  it('slot 2 (KILLED): 1 variant', () => {
    expect(slotCount(CYCLOPS_MELEE[2]!)).toBe(1);
  });

  it('slot 3 (LIGHT_WOUND): 2 variants', () => {
    expect(slotCount(CYCLOPS_MELEE[3]!)).toBe(2);
  });

  it('slot 4 (SERIOUS_WOUND): 2 variants', () => {
    expect(slotCount(CYCLOPS_MELEE[4]!)).toBe(2);
  });

  it('slot 5 (STAGGER): 2 variants', () => {
    expect(slotCount(CYCLOPS_MELEE[5]!)).toBe(2);
  });

  it('slot 6 (LOSE_WEAPON): 2 variants', () => {
    expect(slotCount(CYCLOPS_MELEE[6]!)).toBe(2);
  });

  it('slot 7 (HESITATE): 1 variant', () => {
    expect(slotCount(CYCLOPS_MELEE[7]!)).toBe(1);
  });

  it('slot 8 (SITTING_DUCK): 1 variant', () => {
    expect(slotCount(CYCLOPS_MELEE[8]!)).toBe(1);
  });

  it('total variant count is 14', () => {
    const total = CYCLOPS_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    expect(total).toBe(14);
  });

  it('slot 0 variant 0 contains "Cyclops misses" (1actions.zil:3657)', () => {
    const ltable = slotVariant(CYCLOPS_MELEE[0]!, 0);
    const text = ltable.slice(1).filter(t => typeof t === 'string').join('');
    expect(text).toContain('Cyclops misses');
  });

  it('slot 6 variant 0 uses F_WEP token (1actions.zil:3675)', () => {
    const ltable = slotVariant(CYCLOPS_MELEE[6]!, 0);
    expect(ltable.slice(1)).toContain(F_WEP);
  });
});

// ---------------------------------------------------------------------------
// TROLL_MELEE — 1actions.zil:3689 — 9 slots, variants [4,1,3,4,3,4,3,2,1] = 25
// ---------------------------------------------------------------------------

describe('TROLL_MELEE structure (1actions.zil:3689–3729)', () => {
  it('has exactly 9 slots', () => {
    expect(TROLL_MELEE.length).toBe(9);
  });

  it('slot 0 (MISSED): 4 variants', () => {
    expect(slotCount(TROLL_MELEE[0]!)).toBe(4);
  });

  it('slot 1 (UNCONSCIOUS): 1 variant', () => {
    expect(slotCount(TROLL_MELEE[1]!)).toBe(1);
  });

  it('slot 2 (KILLED): 3 variants', () => {
    expect(slotCount(TROLL_MELEE[2]!)).toBe(3);
  });

  it('slot 3 (LIGHT_WOUND): 4 variants', () => {
    expect(slotCount(TROLL_MELEE[3]!)).toBe(4);
  });

  it('slot 4 (SERIOUS_WOUND): 3 variants', () => {
    expect(slotCount(TROLL_MELEE[4]!)).toBe(3);
  });

  it('slot 5 (STAGGER): 4 variants', () => {
    expect(slotCount(TROLL_MELEE[5]!)).toBe(4);
  });

  it('slot 6 (LOSE_WEAPON): 3 variants', () => {
    expect(slotCount(TROLL_MELEE[6]!)).toBe(3);
  });

  it('slot 7 (HESITATE): 2 variants', () => {
    expect(slotCount(TROLL_MELEE[7]!)).toBe(2);
  });

  it('slot 8 (SITTING_DUCK): 1 variant', () => {
    expect(slotCount(TROLL_MELEE[8]!)).toBe(1);
  });

  it('total variant count is 25', () => {
    const total = TROLL_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    expect(total).toBe(25);
  });

  it('slot 0 variant 0: "The troll swings his axe, but it misses." (1actions.zil:3692)', () => {
    const ltable = slotVariant(TROLL_MELEE[0]!, 0);
    const text = ltable.slice(1).filter(t => typeof t === 'string').join('');
    expect(text).toBe('The troll swings his axe, but it misses.');
  });

  it('slot 4 variant 0 uses F_WEP token (1actions.zil:3710)', () => {
    const ltable = slotVariant(TROLL_MELEE[4]!, 0);
    expect(ltable.slice(1)).toContain(F_WEP);
  });

  it('slot 6 variant 0 uses F_WEP token (1actions.zil:3721)', () => {
    const ltable = slotVariant(TROLL_MELEE[6]!, 0);
    expect(ltable.slice(1)).toContain(F_WEP);
  });
});

// ---------------------------------------------------------------------------
// THIEF_MELEE — 1actions.zil:3735 — 9 slots, variants [4,2,3,4,4,3,3,3,2] = 28
// ---------------------------------------------------------------------------

describe('THIEF_MELEE structure (1actions.zil:3735–3788)', () => {
  it('has exactly 9 slots', () => {
    expect(THIEF_MELEE.length).toBe(9);
  });

  it('slot 0 (MISSED): 4 variants', () => {
    expect(slotCount(THIEF_MELEE[0]!)).toBe(4);
  });

  it('slot 1 (UNCONSCIOUS): 2 variants', () => {
    expect(slotCount(THIEF_MELEE[1]!)).toBe(2);
  });

  it('slot 2 (KILLED): 3 variants', () => {
    expect(slotCount(THIEF_MELEE[2]!)).toBe(3);
  });

  it('slot 3 (LIGHT_WOUND): 4 variants', () => {
    expect(slotCount(THIEF_MELEE[3]!)).toBe(4);
  });

  it('slot 4 (SERIOUS_WOUND): 4 variants', () => {
    expect(slotCount(THIEF_MELEE[4]!)).toBe(4);
  });

  it('slot 5 (STAGGER): 3 variants', () => {
    expect(slotCount(THIEF_MELEE[5]!)).toBe(3);
  });

  it('slot 6 (LOSE_WEAPON): 3 variants', () => {
    expect(slotCount(THIEF_MELEE[6]!)).toBe(3);
  });

  it('slot 7 (HESITATE): 3 variants', () => {
    expect(slotCount(THIEF_MELEE[7]!)).toBe(3);
  });

  it('slot 8 (SITTING_DUCK): 2 variants', () => {
    expect(slotCount(THIEF_MELEE[8]!)).toBe(2);
  });

  it('total variant count is 28', () => {
    const total = THIEF_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    expect(total).toBe(28);
  });

  it('slot 0 variant 0: thief stabs nonchalantly (1actions.zil:3738)', () => {
    const ltable = slotVariant(THIEF_MELEE[0]!, 0);
    const text = ltable.slice(1).filter(t => typeof t === 'string').join('');
    expect(text).toContain('stabs nonchalantly');
  });

  it('slot 6 variant 0 uses F_WEP token (1actions.zil:3775)', () => {
    const ltable = slotVariant(THIEF_MELEE[6]!, 0);
    expect(ltable.slice(1)).toContain(F_WEP);
  });
});

// ---------------------------------------------------------------------------
// Verbatim string rendering — catches length-prefix bugs (1actions.zil:3623,3634,3722)
// ---------------------------------------------------------------------------

describe('MELEE variant verbatim text rendering via remark()', () => {
  function render(ltable: readonly (string | number)[], def: string, wep: string): string {
    const parts: string[] = [];
    remark(ltable, def, wep, s => parts.push(s));
    return parts.join('');
  }

  // HERO_MELEE[1] variant 3 — 1actions.zil:3623
  // "The haft of your " F-WEP " knocks out the " F-DEF "."  (5 tokens, not 4)
  it('HERO_MELEE slot 1 (UNCONSCIOUS) variant 3: renders trailing period (1actions.zil:3623)', () => {
    const ltable = slotVariant(HERO_MELEE[1]!, 3);
    expect(render(ltable, 'thief', 'sword'))
      .toBe('The haft of your sword knocks out the thief.');
  });

  // HERO_MELEE[3] variant 3 — 1actions.zil:3634
  // "The blow lands, making a shallow gash in the " F-DEF "'s arm!"  (3 tokens, not 4)
  it('HERO_MELEE slot 3 (LIGHT_WOUND) variant 3: no trailing undefined (1actions.zil:3634)', () => {
    const ltable = slotVariant(HERO_MELEE[3]!, 3);
    const parts: (string | undefined | null)[] = [];
    remark(ltable, 'troll', 'sword', s => parts.push(s));
    // Must emit exactly 3 real tokens with no undefined/null past the end
    expect(parts.every(p => typeof p === 'string')).toBe(true);
    expect(parts.join('')).toBe("The blow lands, making a shallow gash in the troll's arm!");
  });

  // TROLL_MELEE[6] variant 1 — 1actions.zil:3722
  // "The troll swings, you parry, but the force of his blow knocks your " F-WEP " away."
  // (3 tokens, not 5)
  it('TROLL_MELEE slot 6 (LOSE_WEAPON) variant 1: no trailing undefined (1actions.zil:3722)', () => {
    const ltable = slotVariant(TROLL_MELEE[6]!, 1);
    const parts: (string | undefined | null)[] = [];
    remark(ltable, 'player', 'sword', s => parts.push(s));
    // Must emit exactly 3 real tokens with no undefined/null past the end
    expect(parts.every(p => typeof p === 'string')).toBe(true);
    expect(parts.join('')).toBe('The troll swings, you parry, but the force of his blow knocks your sword away.');
  });
});

// ---------------------------------------------------------------------------
// Grand total: 96 messages across all four tables
// ---------------------------------------------------------------------------

describe('96-message total across all four MELEE tables (spec §8.2)', () => {
  it('HERO(29) + CYCLOPS(14) + TROLL(25) + THIEF(28) = 96', () => {
    const heroTotal    = HERO_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    const cyclopsTotal = CYCLOPS_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    const trollTotal   = TROLL_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    const thiefTotal   = THIEF_MELEE.reduce((s, slot) => s + slotCount(slot), 0);
    expect(heroTotal).toBe(29);
    expect(cyclopsTotal).toBe(14);
    expect(trollTotal).toBe(25);
    expect(thiefTotal).toBe(28);
    expect(heroTotal + cyclopsTotal + trollTotal + thiefTotal).toBe(96);
  });
});
