import type { ObjectId } from '../../domain/game-object.js';

// SyntaxEntry is deliberately flat. The actual JSON is flat; numObjects encodes
// slot presence; re-nesting to dobj?{findBit,whereBits}/iobj?{} would be lossy.

/** One syntax-table record normalized from syntax.json. null → undefined. */
export interface SyntaxEntry {
  verb: string;
  numObjects: 0 | 1 | 2;
  prep1?: string;           // JSON null → undefined
  prep2?: string;           // JSON null → undefined
  dobjFindBit?: string;     // GWIM find-bit — JSON null → undefined
  dobjLocBits: number;      // integer bitmask (0 = unconstrained)
  iobjFindBit?: string;     // GWIM find-bit — JSON null → undefined
  iobjLocBits: number;      // integer bitmask (0 = unconstrained)
  action: string;           // V-* → ParsedCommand.action
  preAction?: string;       // PRE-* → ParsedCommand.preAction (null → undefined)
}

/** A fully resolved command after parsing and scope resolution. */
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
  /** Parenthetical text printed by GWIM, e.g. "(with the sword)". gparser.zil:908-924. */
  readonly gwimText?: string;
  /** Set when this command is one item in an ALL-iteration (gmain.zil:121-144). */
  readonly allIter?: true;
}

/** The result of one parse attempt. */
export type ParseResult =
  | { kind: 'ok'; command: ParsedCommand }
  | { kind: 'fail'; message: string }
  | { kind: 'orphan'; message: string }
  | { kind: 'disambig'; message: string }
  | { kind: 'not-here'; noun: string; message: string };
