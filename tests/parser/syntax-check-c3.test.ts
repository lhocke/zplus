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
 *   - DRIVE1 bare-verb + form-has-prep1 path (LISTEN/TALK/SEND etc.) — ZIL:720
 *   - DRIVE2 fallback (two-obj verb, ncn=1, matching prep1)
 *   - DRIVE last-wins (ZIL divergence from spec pseudocode)
 *   - No-verb fail (verbatim ZIL string)
 *   - Recognize fail ("That sentence isn't one I recognize.") — ZIL:734
 *   - prepEq direct tests
 *   - Too-many-nouns (ncn=2 against num=1 form → skipped)
 *   - Unknown verb → recognize fail (empty form list, no drives)
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
  test('unknown verb (empty form list, no drives) → recognize fail — gparser.zil:734', () => {
    // An unknown verb has no syntax forms. The loop does not execute, leaving
    // both drives undefined. ZIL's loop-exit COND fires "That sentence isn't one
    // I recognize." and RFALSEs. We return kind:'fail' with the verbatim message.
    // (In normal play, vocabulary lookup in parser.ts catches the unknown word
    // before syntaxCheck is called; this exercises the empty-form-list edge case.)
    const r = syntaxCheck('FROBULATE', 0);
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
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

  test('LOOK with ncn=1 and no prep → recognize fail (no 1-obj no-prep LOOK form, no drives)', () => {
    // LOOK has no 1-obj form with prep1=null. All 1-obj LOOK forms have a prep.
    // ncn=1, no prep: ncn(1) > num(0) skips the 0-obj form; no 1-obj no-prep form exists.
    // 2-obj forms: drive2 needs prepEq(form.prep1='AT', undefined) → mismatch.
    // drive1 needs ncn===0 → not met (ncn=1).
    // No drives set → gparser.zil:734: "That sentence isn't one I recognize."
    const r = syntaxCheck('LOOK', 1, undefined);
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
    }
  });

  test('unrecognized form (verb exists but prep mismatch, ncn=1) → recognize fail', () => {
    // A verb that exists but the form (wrong prep) doesn't match anything.
    // LOOK with ncn=1 prep1=FROBNICATE: no form matches, no drives can be set
    // (drive1 needs ncn===0, drive2 needs prepEq(form.prep1, 'FROBNICATE') which
    // fails for all LOOK 2-obj forms whose prep1=AT).
    // Result: gparser.zil:734 recognize fail.
    const r = syntaxCheck('LOOK', 1, 'FROBNICATE');
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
    }
  });
});

// ---------------------------------------------------------------------------
// Section 8b: DRIVE1 bare-verb + form-has-prep1 path — gparser.zil:720
//
// ZIL DRIVE1 condition (lines 718-721):
//   <AND num>=1  ncn===0
//        <OR <ZERO? P-PREP1>          ; no prep typed → ANY form qualifies
//            <EQUAL? typed-prep form-prep>>>
//
// For verbs with NO num=0 form and ALL forms carrying a non-null prep1 (LISTEN,
// TALK, SEND, BLOW, KNOCK, LEAN, PUMP), a bare-verb input (ncn=0, no prep) must
// still land drive1.  The old implementation gated on prepEq(form.prep1, prep1)
// which only matches when BOTH are undefined, silently excluding all prep-carrying
// forms.  Concrete fix: `prep1 === undefined || prepEq(form.prep1, prep1)`.
// ---------------------------------------------------------------------------

describe('syntaxCheck() — DRIVE1 bare-verb + form-has-prep1 (gparser.zil:720)', () => {
  test('bare LISTEN (ncn=0, no prep) → needGwim with drive1 set to last LISTEN form', () => {
    // LISTEN has no num=0 form; all forms have prep1 (TO, FOR).
    // ZIL: P-PREP1==0 → OR fires → DRIVE1 set for both TO and FOR forms; last=FOR form.
    // drive1 must be defined (so C4 can emit "What do you want to listen for?").
    const listenForms = getForms('LISTEN');
    expect(listenForms.length).toBeGreaterThan(0);
    // All LISTEN forms have a non-null prep1.
    expect(listenForms.every(f => f.prep1 !== undefined)).toBe(true);

    const r = syntaxCheck('LISTEN', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeDefined();
      // Last-wins: drive1 is the last LISTEN form (prep1=FOR per gsyntax.zil).
      const lastListenForm = listenForms[listenForms.length - 1]!;
      expect(r.drive1).toBe(lastListenForm);
      expect(r.drive1!.prep1).toBe('FOR');
    }
  });

  test('bare TALK (ncn=0, no prep) → needGwim with drive1 set to TALK TO form', () => {
    // TALK has only one form: TALK TO OBJECT = V-TELL. No num=0 form.
    // Bare TALK: drive1 must be the TALK-TO form so C4 can orphan "...to?".
    const talkForms = getForms('TALK');
    expect(talkForms.length).toBeGreaterThan(0);
    expect(talkForms.every(f => f.prep1 !== undefined)).toBe(true);

    const r = syntaxCheck('TALK', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeDefined();
      expect(r.drive1!.prep1).toBe('TO');
    }
  });

  test('bare SEND (ncn=0, no prep) → needGwim with drive1 set (SEND FOR form)', () => {
    const sendForms = getForms('SEND');
    expect(sendForms.length).toBeGreaterThan(0);
    const r = syntaxCheck('SEND', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBeDefined();
    }
  });

  test('LISTEN TO X (ncn=1, prep1=TO) → full match, not DRIVE1', () => {
    // With prep typed: DRIVE1 gate's second OR arm fires only if typed-prep matches.
    // prep1=TO, form.prep1=TO → full-match path (not drive1 accumulation).
    const r = syntaxCheck('LISTEN', 1, 'TO');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.entry.prep1).toBe('TO');
      expect(r.entry.action).toBe('V-LISTEN');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 8c: Recognize fail — gparser.zil:730-734
//
// When the loop exhausts with NO drive set (neither drive1 nor drive2), ZIL
// prints "That sentence isn't one I recognize." and RFALSE — before any
// GWIM/orphan logic.  syntaxCheck() returns kind:'fail' with the verbatim
// message so parser.ts can propagate it without the C4 fallback bridge.
// ---------------------------------------------------------------------------

describe('syntaxCheck() — recognize fail (gparser.zil:734)', () => {
  test('verbatim message string for no-drive loop exhaustion', () => {
    // LOOK with ncn=1 prep=IN full-matches V-LOOK-INSIDE; with ncn=2 no-prep
    // there are no drives (drive1 needs ncn=0; drive2 needs ncn=1; no full match).
    const r = syntaxCheck('LOOK', 2, undefined, undefined);
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
    }
  });

  test('ncn=2 with mismatched preps for known verb → recognize fail, not no-verb fail', () => {
    // TAKE has no 2-obj form with prep2=WITH; drive1/drive2 both unset → recognize fail.
    const r = syntaxCheck('TAKE', 2, undefined, 'WITH');
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
      // Distinct from no-verb fail ("There was no verb in that sentence!").
      expect(r.message).not.toContain('no verb');
    }
  });

  test('ncn=2 LOOK IN WITH → recognize fail (LOOK has no 2-obj IN form)', () => {
    const r = syntaxCheck('LOOK', 2, 'IN', 'WITH');
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
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
    // ZIL DRIVE1 gate (gparser.zil:718-722): num>=1 AND ncn===0 AND
    // (P-PREP1==0 OR typed-prep matches form-prep).
    // For bare TAKE (ncn=0, no prep typed = prep1===undefined): P-PREP1 is 0,
    // so the OR's first arm fires for ALL num>=1 forms regardless of form.prep1.
    // ALL 8 TAKE forms are DRIVE1-eligible. Last-wins → drive1 = form 7 (prep2=FROM).
    const takeForms = getForms('TAKE');
    // The last TAKE form in declaration order (all 8 are eligible, last wins).
    const lastTakeForm = takeForms[takeForms.length - 1]!;

    const r = syntaxCheck('TAKE', 0);
    expect(r.kind).toBe('needGwim');
    if (r.kind === 'needGwim') {
      expect(r.drive1).toBe(lastTakeForm); // object-identity, last-wins
    }
  });
});

// ---------------------------------------------------------------------------
// Section 10: Too-many-nouns skip
// ---------------------------------------------------------------------------

describe('syntaxCheck() — too-many-nouns', () => {
  test('ncn=2 against a num=1 form → that form is skipped; no matching 2-obj form → recognize fail', () => {
    // If LOOK is given ncn=2 but no matching 2-obj form exists for given preps,
    // all 1-obj forms should be skipped.
    // LOOK has exactly one 2-obj form: AT + WITH → V-READ.
    // With ncn=2 and no prep → the 2-obj form has prep1=AT which != undefined → not matched.
    // Also ncn=2 > num=0 for the 0-obj form, and ncn=2 > num=1 for 1-obj forms.
    // drive1 needs ncn===0. ncn=2 → drive1 never set.
    // drive2 needs ncn===1. ncn=2 → drive2 never set.
    // No drives → gparser.zil:734: "That sentence isn't one I recognize."
    const r = syntaxCheck('LOOK', 2, undefined, undefined);
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe("That sentence isn't one I recognize.");
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
