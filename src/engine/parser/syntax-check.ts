/**
 * SYNTAX-CHECK — C3
 *
 * Pure, World-free, side-effect-free port of gparser.zil:707–775.
 *
 * Given a verb (UPPERCASE canonical), noun-clause count (ncn: 0|1|2), and
 * up to two UPPERCASE canonical prepositions, iterates the SyntaxEntry forms in
 * declaration order and returns:
 *   - { kind:'matched', entry } on the first full match
 *   - { kind:'needGwim', drive1?, drive2? } when the loop exhausts without a
 *     full match (C4 owns GWIM, orphan prompting, etc.)
 *   - { kind:'fail', message } only for the no-verb case
 *
 * Defers ALL object resolution, GWIM, and orphan/CANT-ORPHAN prompting to C4.
 *
 * ─── DRIVE NOTE (observable first-wins behavior) ─────────────────────────────
 * The spec pseudocode (algorithm §306/§310) writes drive1 = drive1 ?? form
 * (first-wins). The ZIL source at gparser.zil:722/725 uses an unconditional
 * <SET DRIVE1 .SYN> (last-wins over the byte table), BUT the ZIL compiler
 * stores syntax forms in REVERSE declaration order in the byte table — so the
 * last form processed by the ZIL loop is the first form declared in gsyntax.zil.
 * Net observable effect: first-declared form wins for DRIVE1/DRIVE2.
 *
 * Verified against dfrotz (ground truth):
 *   > listen  → "What do you want to listen to?"   (LISTEN TO declared first)
 *   > knock   → "What do you want to knock at?"    (KNOCK AT declared first)
 * Both confirm first-declared wins.
 *
 * This implementation uses drive1 = drive1 ?? form (first-wins in declaration
 * order), matching observable behavior.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SyntaxEntry } from './types.js';
import { getForms } from './syntax-table.js';

// ---------------------------------------------------------------------------
// Discriminated union returned by syntaxCheck.
// ---------------------------------------------------------------------------

export type SyntaxCheckResult =
  | { kind: 'matched'; entry: SyntaxEntry }
  | { kind: 'needGwim'; drive1?: SyntaxEntry; drive2?: SyntaxEntry }
  | { kind: 'fail'; message: string };

// ---------------------------------------------------------------------------
// prepEq — the load-bearing helper (gparser.zil:723/726, algorithm §324).
//
// both-undefined → MATCH (0 vs 0 in ZIL byte compare)
// one-undefined  → MISMATCH
// else            → string equality
//
// Normalize JSON null → undefined at index-build time so this helper NEVER
// sees null.  A wrong implementation silently breaks every prepositional form.
// ---------------------------------------------------------------------------

/**
 * Compare two optional UPPERCASE prep strings.
 * Mirrors the ZIL byte compare where 0 = "no prep".
 */
export function prepEq(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a === b;
}

// ---------------------------------------------------------------------------
// syntaxCheck — port of gparser.zil:707–775.
// ---------------------------------------------------------------------------

/**
 * Match a tokenized command against the SyntaxEntry table.
 *
 * @param verb   UPPERCASE canonical verb (e.g. "LOOK"); undefined triggers the
 *               verbatim no-verb fail message.
 * @param ncn    Noun-clause count: 0 (verb-only), 1 (one noun), 2 (two nouns).
 * @param prep1  First UPPERCASE canonical prep (e.g. "AT"), or undefined.
 * @param prep2  Second UPPERCASE canonical prep (e.g. "WITH"), or undefined.
 *
 * @returns SyntaxCheckResult discriminated union.
 */
export function syntaxCheck(
  verb: string | undefined,
  ncn: 0 | 1 | 2,
  prep1?: string,
  prep2?: string,
): SyntaxCheckResult {
  // gparser.zil:709-711 — no verb in sentence.
  if (verb === undefined) {
    return { kind: 'fail', message: 'There was no verb in that sentence!' };
  }

  const forms = getForms(verb); // [] for unknown verbs

  // DRIVE state: first-wins in declaration order (see DRIVE NOTE above).
  let drive1: SyntaxEntry | undefined;
  let drive2: SyntaxEntry | undefined;

  for (const form of forms) {
    const num = form.numObjects;

    // gparser.zil:717 — ncn > num: too many nouns for this form; skip.
    if (ncn > num) continue;

    // gparser.zil:718-722 — DRIVE1 accumulation.
    //
    // ZIL condition (lines 718-721):
    //   <AND <NOT <L? .NUM 1>>          ; num >= 1
    //        <ZERO? ,P-NCN>              ; ncn === 0
    //        <OR <ZERO? <GET ,P-ITBL ,P-PREP1>>   ; no prep typed (P-PREP1==0)
    //            <EQUAL? .PREP <GETB .SYN ,P-SPREP1>>>>  ; OR typed prep matches form's prep
    //
    // The OR's first arm fires when NO prep was typed (prep1===undefined in TS).
    // In that case ANY form with num>=1 qualifies for DRIVE1, regardless of
    // the form's own prep1.  This lets bare LISTEN (no num=0 form) reach the
    // LISTEN TO form as drive1 and emit the correct orphan prompt.
    //
    // drive1 = drive1 ?? form  (FIRST qualifying wins — see DRIVE NOTE)
    if (num >= 1 && ncn === 0 && (prep1 === undefined || prepEq(form.prep1, prep1))) {
      drive1 = drive1 ?? form;
      continue;
    }

    // gparser.zil:723 — prep1 must match for the rest of the checks.
    if (!prepEq(form.prep1, prep1)) continue;

    // gparser.zil:724-725 — DRIVE2 accumulation:
    // num === 2, ncn === 1 (have dobj but not iobj yet).
    // drive2 = drive2 ?? form  (FIRST qualifying wins — see DRIVE NOTE)
    if (num === 2 && ncn === 1) {
      drive2 = drive2 ?? form;
      continue;
    }

    // gparser.zil:726-729 — FULL MATCH: prep2 must also match.
    if (prepEq(form.prep2, prep2)) {
      return { kind: 'matched', entry: form };
    }
  }

  // gparser.zil:730-735 — loop exhausted.
  //
  // ZIL: <COND (<OR .DRIVE1 .DRIVE2> <RETURN>)    ; hand control to post-loop GWIM block
  //             (T <TELL "That sentence isn't one I recognize." CR> <RFALSE>)>
  //
  // If NEITHER drive was set, ZIL prints the verbatim message and RFALSE immediately,
  // BEFORE ever reaching the GWIM/orphan block.  We return kind:'fail' here so
  // parser.ts can propagate it verbatim without falling through to the C4 bridge.
  if (drive1 === undefined && drive2 === undefined) {
    return { kind: 'fail', message: "That sentence isn't one I recognize." };
  }

  // At least one drive is set — hand DRIVE state to C4 for GWIM/orphan resolution.
  return { kind: 'needGwim', drive1, drive2 };
}
