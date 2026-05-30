import type { ObjectId } from '../../domain/game-object.js';

/**
 * A fully resolved command after parsing and scope resolution.
 *
 * Fields mirror the ZIL globals produced by the parser (gparser.zil §12):
 *   verb      — canonical UPPERCASE verb id (e.g. "TAKE", "WALK")
 *   dobjIds   — resolved direct-object ids (list for ALL/AND; usually length 1)
 *   iobjIds   — resolved indirect-object ids
 *   prep      — canonical prep id matching syntax.json strings ("WITH", "IN", …)
 *   action    — matched V-* action id → TD-4 dispatch (e.g. "V-TAKE")
 *   preAction — PRE-* id if the syntax form carries one → TD-4 step 3
 *   numberValue — integer from NUMBER?/INTNUM (reserved; deferred)
 *   autoTaken — objects auto-taken by STAKE "(Taken)" already printed
 *   raw       — original token array for AGAIN/OOPS/error echo
 */
export interface ParsedCommand {
  readonly verb: string;
  readonly dobjIds?: ObjectId[];
  readonly iobjIds?: ObjectId[];
  readonly prep?: string;
  readonly action: string;
  readonly preAction?: string;
  readonly numberValue?: number;
  readonly autoTaken?: ObjectId[];
  readonly raw: string[];
}

/**
 * The result of one parse attempt.  Four structurally-distinct outcomes:
 *
 *   ok       — command fully resolved; engine executes it.
 *   fail     — any error (unknown word, not in scope, empty input, too many
 *              nouns, MANY-CHECK failure, SHAVE failure, …); the verbatim ZIL
 *              message string is the contract.
 *   orphan   — parser issued a "What do you want to <verb>?" prompt and
 *              saved state; caller must supply the next turn's input as the
 *              answer without re-prompting.
 *   disambig — parser issued a "Which X do you mean, …?" prompt; caller
 *              must supply the next turn's answer in the same way.
 */
export type ParseResult =
  | { kind: 'ok'; command: ParsedCommand }
  | { kind: 'fail'; message: string }
  | { kind: 'orphan'; message: string }
  | { kind: 'disambig'; message: string };
