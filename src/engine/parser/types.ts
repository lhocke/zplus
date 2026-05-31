import type { ObjectId } from '../../domain/game-object.js';

// ---------------------------------------------------------------------------
// SyntaxEntry — the port-native flat schema for one syntax.json record.
//
// DELIBERATELY FLAT (not the nested dobj?{findBit,whereBits}/iobj?{} shape
// sketched in td1-grammar-spec.md §7). The actual JSON is flat, numObjects
// already encodes slot presence, and the flat dobjFindBit/dobjLocBits/
// iobjFindBit/iobjLocBits fields feed C4's GWIM signature directly. Re-nesting
// would be lossy busywork. C4 must read the flat fields, not a phantom nested shape.
// ---------------------------------------------------------------------------

/**
 * One syntax-table record, normalized from syntax.json.
 * null JSON fields → undefined here.
 * dobjLocBits / iobjLocBits are integer bitmasks (0 = unconstrained).
 */
export interface SyntaxEntry {
  verb: string;
  numObjects: 0 | 1 | 2;
  prep1?: string;           // JSON null → undefined
  prep2?: string;           // JSON null → undefined
  dobjFindBit?: string;     // for C4 GWIM — JSON null → undefined
  dobjLocBits: number;      // integer bitmask (0 = unconstrained)
  iobjFindBit?: string;     // for C4 GWIM — JSON null → undefined
  iobjLocBits: number;      // integer bitmask (0 = unconstrained)
  action: string;           // V-* → ParsedCommand.action
  preAction?: string;       // PRE-* → ParsedCommand.preAction (null → undefined)
}

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
 *   syntax    — the matched SyntaxEntry (authoritative source for action/preAction/locbits)
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
  readonly syntax?: SyntaxEntry;
  readonly numberValue?: number;
  readonly autoTaken?: ObjectId[];
  readonly raw: string[];
}

/**
 * The result of one parse attempt.  Five structurally-distinct outcomes:
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
 *   not-here — object was recognized (known noun in vocabulary) but is not
 *              in scope; engine prints "You can't see any X here!" (gparser.zil:1124).
 *              Also used when the room is dark: message = "It's too dark to see!"
 *              Distinct from 'fail' so the engine can special-case the message.
 */
export type ParseResult =
  | { kind: 'ok'; command: ParsedCommand }
  | { kind: 'fail'; message: string }
  | { kind: 'orphan'; message: string }
  | { kind: 'disambig'; message: string }
  | { kind: 'not-here'; noun: string; message: string };
