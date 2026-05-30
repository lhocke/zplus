import type { ObjectId } from '../../domain/game-object.js';

/** A fully resolved command after parsing and scope resolution. */
export interface ParsedCommand {
  readonly verb: string;
  readonly dobjId?: ObjectId;
  readonly iobjId?: ObjectId;
  readonly prep?: string;
  /** The raw tokens the parser consumed, for error or disambiguation re-use. */
  readonly raw: string[];
}

export type ParseResult =
  | { kind: 'ok'; command: ParsedCommand }
  | { kind: 'empty' }
  | { kind: 'unknown-word'; word: string; message: string }
  | { kind: 'not-in-scope'; noun: string; message: string }
  | { kind: 'ambiguous'; noun: string; candidates: ObjectId[]; message: string };
