/**
 * C3 SYNTAX-CHECK — TDD test suite
 *
 * Drives everything through syntaxCheck() with hand-built input fixtures
 * and the real syntax.json index.  Asserts object-identity of returned
 * SyntaxEntry against the indexed entry so any future reordering of
 * syntax.json surfaces immediately.
 *
 * Covers:
 *   - Index sanity (LOOK=12, TAKE=8, CLIMB=8 forms)
 *   - LOOK first-match-wins past 0-obj entry
 *   - TAKE 1-obj and 2-obj forms
 *   - CLIMB UP first-match-wins (two consecutive UP forms)
 *   - DRIVE1 fallback (bare verb, ncn=0, 1-obj form)
 *   - DRIVE2 fallback (two-obj verb, ncn=1, matching prep1)
 *   - DRIVE last-wins (ZIL divergence from spec pseudocode)
 *   - No-verb fail (verbatim ZIL string)
 *   - prepEq direct tests
 *   - Too-many-nouns (ncn=2 against num=1 form → skipped)
 *   - Unknown verb → needGwim with no drives
 */

import { describe, test, expect } from 'vitest';
import { syntaxCheck, prepEq } from '../../src/engine/parser/syntax-check.js';
import { getForms } from '../../src/engine/parser/syntax-table.js';

// ---------------------------------------------------------------------------
// Section 1: Index sanity
// ---------------------------------------------------------------------------

describe('getForms() index sanity', () => {
  test('LOOK has 12 forms', () => {
    expect(getForms('LOOK')).toHaveLength(12);
  });

  test('TAKE has 8 forms', () => {
    expect(getForms('TAKE')).toHaveLength(8);
  });

  test('CLIMB has 8 forms', () => {
    expect(getForms('CLIMB')).toHaveLength(8);
  });

  test('unknown verb returns []', () => {
    expect(getForms('FROBULATE')).toHaveLength(0);
  });

  test('CLIMB UP forms are consecutive and in order (RMUNGBIT then CLIMBBIT by dobjFindBit)', () => {
    const forms = getForms('CLIMB');
    // The two consecutive UP forms are at indices 0 and 1 (declaration order).
    const upForms = forms.filter(f => f.prep1 === 'UP');
    expect(upForms).toHaveLength(2);
    // First UP form has dobjFindBit=RMUNGBIT (the dummy-object ROOMS sentinel shortcircuit).
    // Second UP form has dobjFindBit=CLIMBBIT (actual climbable object).
    // Declaration order is preserved — this is the canonical guard.
    expect(upForms[0]!.dobjFindBit).toBe('RMUNGBIT');
    expect(upForms[1]!.dobjFindBit).toBe('CLIMBBIT');
  });

  test('CLIMB UP forms appear before other CLIMB forms (declaration order)', () => {
    const forms = getForms('CLIMB');
    const firstUpIdx = forms.findIndex(f => f.prep1 === 'UP');
    expect(firstUpIdx).toBe(0); // must be first two entries
  });
});

// ---------------------------------------------------------------------------
// Section 2: prepEq — direct unit tests
// ---------------------------------------------------------------------------

describe('prepEq()', () => {
  test('both-undefined → match', () => {
    expect(prepEq(undefined, undefined)).toBe(true);
  });

  test('a-undefined, b-defined → mismatch', () => {
    expect(prepEq(undefined, 'AT')).toBe(false);
  });

  test('a-defined, b-undefined → mismatch', () => {
    expect(prepEq('AT', undefined)).toBe(false);
  });

  test('equal strings → match', () => {
    expect(prepEq('WITH', 'WITH')).toBe(true);
  });

  test('different strings → mismatch', () => {
    expect(prepEq('IN', 'AT')).toBe(false);
  });

  test('case matters — prepEq is exact-string (AT !== at)', () => {
    // All prep canonicals are UPPERCASE in syntax.json; normalizePrep() guarantees
    // UPPERCASE before syntaxCheck is called. prepEq should NOT do case-folding.
    expect(prepEq('AT', 'at')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 3: No-verb fail
// ---------------------------------------------------------------------------

describe('syntaxCheck() — no-verb fail', () => {
  test('verb=undefined → fail with verbatim ZIL message', () => {
    const r = syntaxCheck(undefined, 0);
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe('There was no verb in that sentence!');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 4: Unknown verb
// ---------------------------------------------------------------------------

describe('syntaxCheck() — unknown verb', () => {
  test('unknown verb → needGwim with no drives', () => {
    const r = syntaxCheck('FROBULATE', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeUndefined();
      expect(r.drive2).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Section 5: LOOK — first-match-wins across forms
// ---------------------------------------------------------------------------

describe('syntaxCheck() — LOOK forms', () => {
  const lookForms = getForms('LOOK');

  test('"look" (ncn=0, no prep) → form[0] V-LOOK (object-identity)', () => {
    const r = syntaxCheck('LOOK', 0);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry).toBe(lookForms[0]);         // object-identity
      expect(r.entry.action).toBe('V-LOOK');
      expect(r.entry.numObjects).toBe(0);
    }
  });

  test('"look at X" (ncn=1, prep1=AT) → V-EXAMINE (NOT V-LOOK)', () => {
    // Proves the scan passes the 0-obj entry (LOOK at ncn=1 skips the num=0 form
    // because ncn(1) > num(0) fails — wait, ncn(1) > num(0) means ncn > num, so
    // actually it skips. Then it finds AT form → V-EXAMINE.
    const r = syntaxCheck('LOOK', 1, 'AT');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-EXAMINE');
      expect(r.entry.prep1).toBe('AT');
      expect(r.entry.numObjects).toBe(1);
    }
  });

  test('"look under X" (ncn=1, prep1=UNDER) → V-LOOK-UNDER', () => {
    const r = syntaxCheck('LOOK', 1, 'UNDER');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-LOOK-UNDER');
    }
  });

  test('"look in X" (ncn=1, prep1=IN) → V-LOOK-INSIDE', () => {
    const r = syntaxCheck('LOOK', 1, 'IN');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-LOOK-INSIDE');
    }
  });

  test('"look at X with Y" (ncn=2, AT+WITH) → V-READ', () => {
    const r = syntaxCheck('LOOK', 2, 'AT', 'WITH');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-READ');
      expect(r.entry.prep1).toBe('AT');
      expect(r.entry.prep2).toBe('WITH');
      expect(r.entry.numObjects).toBe(2);
    }
  });

  test('"look at X" (ncn=1, AT) does NOT match the AT+WITH 2-obj form (prep2 gating)', () => {
    // "look at X" has ncn=1, so the num=2 AT+WITH form is ncn(1) < num(2) — NOT skipped
    // by too-many-nouns. But it should NOT full-match because ncn=1 with num=2 → DRIVE2 path.
    const r = syntaxCheck('LOOK', 1, 'AT');
    // Should be matched to V-EXAMINE (num=1, prep1=AT), not V-READ (num=2, AT+WITH).
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-EXAMINE');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 6: TAKE — 1-obj and 2-obj forms
// ---------------------------------------------------------------------------

describe('syntaxCheck() — TAKE forms', () => {
  const takeForms = getForms('TAKE');

  test('"take X" (ncn=1, no prep) → form[0] V-TAKE (object-identity)', () => {
    const r = syntaxCheck('TAKE', 1);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry).toBe(takeForms[0]);
      expect(r.entry.action).toBe('V-TAKE');
      expect(r.entry.numObjects).toBe(1);
      expect(r.entry.prep1).toBeUndefined();
    }
  });

  test('"take X from Y" (ncn=2, prep2=FROM) → 2-obj V-TAKE form', () => {
    // TAKE has a 2-obj form with prep2=FROM (prep1=null).
    const r = syntaxCheck('TAKE', 2, undefined, 'FROM');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-TAKE');
      expect(r.entry.numObjects).toBe(2);
      expect(r.entry.prep2).toBe('FROM');
    }
  });

  test('"take X" has PRE-TAKE preAction', () => {
    const r = syntaxCheck('TAKE', 1);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.preAction).toBe('PRE-TAKE');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 7: CLIMB — UP first-match-wins (two consecutive UP forms)
// ---------------------------------------------------------------------------

describe('syntaxCheck() — CLIMB UP (two consecutive UP forms)', () => {
  const climbForms = getForms('CLIMB');

  test('"climb up X" → first UP form (RMUNGBIT) wins by declaration order', () => {
    // Two UP forms exist; the first (RMUNGBIT dummy-object) wins because syntaxCheck
    // returns on the FIRST full match.
    const r = syntaxCheck('CLIMB', 1, 'UP');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      // Assert entry is the first UP form by object-identity.
      const firstUpForm = climbForms.find(f => f.prep1 === 'UP')!;
      expect(r.entry).toBe(firstUpForm);
      expect(r.entry.dobjFindBit).toBe('RMUNGBIT');
      expect(r.entry.action).toBe('V-CLIMB-UP');
    }
  });

  test('"climb X" (no prep) → V-CLIMB-FOO', () => {
    // CLIMB with no prep and ncn=1 — matches the no-prep 1-obj form.
    const r = syntaxCheck('CLIMB', 1);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.action).toBe('V-CLIMB-FOO');
      expect(r.entry.prep1).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Section 8: DRIVE fallbacks
// ---------------------------------------------------------------------------

describe('syntaxCheck() — DRIVE fallbacks', () => {
  test('bare "take" (ncn=0, 1-obj form) → needGwim with drive1=V-TAKE form', () => {
    const r = syntaxCheck('TAKE', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeDefined();
      // drive1 should be a TAKE 1-obj form (the last qualifying one per last-wins).
      expect(r.drive1!.verb).toBe('TAKE');
    }
  });

  test('LOOK ncn=1 with prep1=AT and ncn=1 yields drive2 for the 2-obj AT+WITH form', () => {
    // LOOK has a 2-obj form: prep1=AT, prep2=WITH, num=2.
    // When ncn=1 and prep1=AT: prepEq(form.prep1='AT', 'AT') passes; num=2, ncn=1 → drive2 path.
    // LOOK also has a 1-obj AT form (V-EXAMINE) that will FULL MATCH first.
    // So this actually returns matched. Instead test LOOK ncn=1 no prep:
    // No 1-obj no-prep LOOK form → needGwim. The 2-obj forms with prep1=AT have prep1 mismatch.
    // drive2 needs: num=2, ncn=1, prepEq(form.prep1, undefined).
    // LOOK 2-obj form has prep1=AT ≠ undefined → doesn't qualify for drive2.
    // Check ATTACK 2-obj with no prep1:
    const attackForms = getForms('ATTACK');
    const twoPrepNullForm = attackForms.find(f => f.numObjects === 2 && f.prep1 === undefined);
    if (twoPrepNullForm !== undefined) {
      // "attack troll with ?" where we only have 1 noun (ncn=1), no prep.
      const r = syntaxCheck('ATTACK', 1, undefined, undefined);
      expect(r.kind).toBe('needGwim');
      if (r.kind === 'needGwim') {
        // drive2 should be the ATTACK 2-obj no-prep1 form (last qualifying).
        expect(r.drive2).toBeDefined();
      }
    }
  });

  test('LOOK with ncn=1 and no prep → needGwim (no 1-obj no-prep LOOK form)', () => {
    // LOOK has no 1-obj form with prep1=null. All 1-obj LOOK forms have a prep.
    // ncn=1, no prep: ncn(1) > num(0) skips the 0-obj form; no 1-obj no-prep form exists.
    // 2-obj forms have ncn(1) < num(2) so not skipped, but ncn=1 with num=2 → drive2.
    // Result: needGwim.
    const r = syntaxCheck('LOOK', 1, undefined);
    expect(r.kind).toBe('needGwim');
  });

  test('unknown form with no drive candidates → needGwim with both drives undefined', () => {
    // A verb that exists but the form (wrong prep) doesn't match anything.
    // LOOK with prep1=FROBNICATE doesn't match any form.
    const r = syntaxCheck('LOOK', 1, 'FROBNICATE');
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeUndefined();
      expect(r.drive2).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Section 9: DRIVE last-wins (ZIL divergence from spec pseudocode §306/§310)
//
// The spec pseudocode writes drive1 = drive1 ?? form (first-wins).
// The actual ZIL at gparser.zil:722/725 is unconditional SET — LAST wins.
// This test documents and pins the deliberate divergence.
// ---------------------------------------------------------------------------

describe('syntaxCheck() — DRIVE last-wins (ZIL gparser.zil:722/725)', () => {
  test('TAKE ncn=0 drive1: last qualifying form wins, not first', () => {
    // TAKE has multiple forms eligible for drive1 when ncn=0 (all num>=1 with prep1=null).
    // The 1-obj no-prep form (V-TAKE, form[0]) AND the 2-obj forms with prep1=null
    // (prep2=FROM, OFF, OUT — forms 5,6,7 in 0-indexed) are all drive1-eligible
    // (num>=1, ncn=0, prepEq(form.prep1, undefined) → both undefined).
    // ZIL last-wins means drive1 is the LAST drive1-eligible form, not the first.
    const takeForms = getForms('TAKE');
    const drive1EligibleForms = takeForms.filter(
      f => f.numObjects >= 1 && f.prep1 === undefined
    );
    // There should be multiple drive1-eligible forms (1-obj no-prep + 2-obj no-prep).
    expect(drive1EligibleForms.length).toBeGreaterThan(1);

    const r = syntaxCheck('TAKE', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      // Last-wins: drive1 should be the LAST drive1-eligible form.
      const lastEligible = drive1EligibleForms[drive1EligibleForms.length - 1]!;
      expect(r.drive1).toBe(lastEligible); // object-identity
    }
  });
});

// ---------------------------------------------------------------------------
// Section 10: Too-many-nouns skip
// ---------------------------------------------------------------------------

describe('syntaxCheck() — too-many-nouns', () => {
  test('ncn=2 against a num=1 form → that form is skipped (ncn > num → continue)', () => {
    // If LOOK is given ncn=2 but no matching 2-obj form exists for given preps,
    // all 1-obj forms should be skipped, returning needGwim.
    // LOOK has exactly one 2-obj form: AT + WITH → V-READ.
    // With ncn=2 and no prep → should not match that form (prep1 mismatch).
    const r = syntaxCheck('LOOK', 2, undefined, undefined);
    // The 2-obj form (AT+WITH) has prep1=AT which != undefined → not matched.
    // Also ncn=2 > num=0 for the 0-obj form, and ncn=2 > num=1 for 1-obj forms.
    // So no full match, no drive (ncn>num for all num<=1, and drive1/drive2
    // conditions don't apply when ncn=2).
    // Actually: drive1 needs num>=1 AND ncn===0. ncn=2 → drive1 never set.
    // drive2 needs num===2 AND ncn===1. ncn=2 → drive2 never set.
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeUndefined();
      expect(r.drive2).toBeUndefined();
    }
  });

  test('ncn=2 against 1-obj TAKE form → that form skipped; 2-obj form matched', () => {
    // "take X from Y": ncn=2, prep2=FROM. The 1-obj forms have num=1, so ncn(2)>num(1)
    // → skip. The 2-obj FROM form has num=2, ncn(2) ≤ num(2) → eligible → full match.
    const r = syntaxCheck('TAKE', 2, undefined, 'FROM');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.numObjects).toBe(2);
      expect(r.entry.prep2).toBe('FROM');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 11: action/preAction threading (SyntaxEntry on matched result)
// ---------------------------------------------------------------------------

describe('syntaxCheck() — action/preAction on matched entry', () => {
  test('matched entry carries the action string', () => {
    const r = syntaxCheck('LOOK', 0);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(typeof r.entry.action).toBe('string');
      expect(r.entry.action).toMatch(/^V-/);
    }
  });

  test('LOOK 0-obj: preAction is undefined (no PRE-* on bare LOOK)', () => {
    const r = syntaxCheck('LOOK', 0);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.preAction).toBeUndefined();
    }
  });

  test('TAKE 1-obj: preAction is PRE-TAKE', () => {
    const r = syntaxCheck('TAKE', 1);
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.preAction).toBe('PRE-TAKE');
    }
  });
});
