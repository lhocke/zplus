/**
 * Pure port of gparser.zil:707–775.
 *
 * Given UPPERCASE canonical verb, noun-clause count (0|1|2), and up to two
 * UPPERCASE canonical prepositions, iterates SyntaxEntry forms in declaration
 * order and returns:
 *   - { kind:'matched', entry } on the first full match
 *   - { kind:'needGwim', drive1?, drive2? } when no full match found
 *   - { kind:'fail', message } for the no-verb case
 *
 * DRIVE NOTE: ZIL stores forms in reverse order in the byte table, so the last
 * ZIL loop iteration is the first-declared form. Observable effect: first-declared
 * form wins for DRIVE1/DRIVE2 (verified against dfrotz: "listen" → "What do you
 * want to listen to?" / "knock" → "What do you want to knock at?").
 */

import type { SyntaxEntry } from './types.js';
import { getForms } from './syntax-table.js';

export type SyntaxCheckResult =
  | { kind: 'matched'; entry: SyntaxEntry }
  | { kind: 'needGwim'; drive1?: SyntaxEntry; drive2?: SyntaxEntry }
  | { kind: 'fail'; message: string };

/**
 * Compare two optional UPPERCASE prep strings (gparser.zil:723/726).
 * Mirrors ZIL byte compare where 0 = "no prep": both undefined → match,
 * one undefined → mismatch, else string equality.
 */
export function prepEq(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a === b;
}

/** Port of gparser.zil:707–775. */
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

  let drive1: SyntaxEntry | undefined;
  let drive2: SyntaxEntry | undefined;

  for (const form of forms) {
    const num = form.numObjects;

    // gparser.zil:717 — ncn > num: too many nouns for this form; skip.
    if (ncn > num) continue;

    // gparser.zil:718-722 — DRIVE1: fires when num>=1, ncn==0, and either no
    // prep was typed OR the typed prep matches. The no-prep arm lets bare LISTEN
    // reach the LISTEN TO form and emit the correct orphan prompt.
    if (num >= 1 && ncn === 0 && (prep1 === undefined || prepEq(form.prep1, prep1))) {
      drive1 = drive1 ?? form;
      continue;
    }

    // gparser.zil:723 — prep1 must match for the rest of the checks.
    if (!prepEq(form.prep1, prep1)) continue;

    // gparser.zil:724-725 — DRIVE2: have dobj but not iobj yet.
    if (num === 2 && ncn === 1) {
      drive2 = drive2 ?? form;
      continue;
    }

    // gparser.zil:726-729 — FULL MATCH: prep2 must also match.
    if (prepEq(form.prep2, prep2)) {
      return { kind: 'matched', entry: form };
    }
  }

  // gparser.zil:730-735 — loop exhausted without a full match.
  // When neither drive is set, ZIL prints the message and RFALSE immediately.
  if (drive1 === undefined && drive2 === undefined) {
    return { kind: 'fail', message: "That sentence isn't one I recognize." };
  }

  return { kind: 'needGwim', drive1, drive2 };
}
