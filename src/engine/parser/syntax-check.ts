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
 * ─── DRIVE NOTE (ZIL last-wins divergence from spec pseudocode) ──────────────
 * The spec pseudocode (algorithm §306/§310) writes drive1 = drive1 ?? form
 * (first-wins). The actual ZIL at gparser.zil:722/725 is an unconditional
 * <SET DRIVE1 .SYN> / <SET DRIVE2 .SYN> — it runs every qualifying pass, so
 * the LAST qualifying form wins. This implementation faithfully follows the ZIL
 * (last-wins), using plain assignment (drive1 = form / drive2 = form).
 * For most verbs only one form is DRIVE-eligible so the two behaviors coincide;
 * the divergence only matters for a verb with two DRIVE-eligible forms.
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

  // ZIL DRIVE state: last-wins (see DRIVE NOTE above).
  let drive1: SyntaxEntry | undefined;
  let drive2: SyntaxEntry | undefined;

  for (const form of forms) {
    const num = form.numObjects;

    // gparser.zil:717 — ncn > num: too many nouns for this form; skip.
    if (ncn > num) continue;

    // gparser.zil:718-722 — DRIVE1 accumulation:
    // num >= 1, ncn === 0, AND (no prep1 given OR prep1 matches form.prep1).
    // drive1 = form  (LAST qualifying wins per ZIL's unconditional SET)
    if (num >= 1 && ncn === 0 && prepEq(form.prep1, prep1)) {
      drive1 = form;
      continue;
    }

    // gparser.zil:723 — prep1 must match for the rest of the checks.
    if (!prepEq(form.prep1, prep1)) continue;

    // gparser.zil:724-725 — DRIVE2 accumulation:
    // num === 2, ncn === 1 (have dobj but not iobj yet).
    // drive2 = form  (LAST qualifying wins per ZIL's unconditional SET)
    if (num === 2 && ncn === 1) {
      drive2 = form;
      continue;
    }

    // gparser.zil:726-729 — FULL MATCH: prep2 must also match.
    if (prepEq(form.prep2, prep2)) {
      return { kind: 'matched', entry: form };
    }
  }

  // Loop exhausted — hand DRIVE state to C4.
  return { kind: 'needGwim', drive1, drive2 };
}
