import type { ObjectId } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import type { GameObject } from '../../domain/game-object.js';
import type { ParsedCommand, ParseResult } from './types.js';
import { Flag } from '../../domain/flags.js';
import { tokenize, SIBREAK_CHARS } from './tokenizer.js';
import { syntaxCheck } from './syntax-check.js';
import { buildScope, lit as litCheck } from './scope.js';
import { getObject } from './get-object.js';
import { accessible } from './accessible.js';
import { FINDBIT_TO_FLAG } from './find-bits.js';

// ---------------------------------------------------------------------------
// Wave B–era compatibility adapter.
//
// The new tokenize() (Wave C1) emits Token[] with SIBREAKS as standalone
// tokens and NOTHING dropped.  The old parser paths (parse / parseChained)
// still expect a filtered string[] per segment.  Rather than rewriting the
// whole scanner here (that is Wave C3+), we keep a private adapter that:
//   1. Calls the new tokenize() to get the canonical token stream.
//   2. Splits at the first SIBREAK token (period / comma — take segment 0).
//   3. Strips articles (the/a/an) from the segment tokens.
//
// This adapter is intentionally NOT exported.  Wave C will delete it when
// it rewrites parse() against the full scan-loop pipeline.
// ---------------------------------------------------------------------------

const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Tokenize a single input segment for the Wave-B parser.
 * Splits at the first SIBREAK token and drops articles — matching the
 * pre-C1 behaviour the old parse() paths depended on.
 */
function tokenizeSegment(input: string): string[] {
  const toks = tokenize(input);
  const result: string[] = [];
  for (const tok of toks) {
    if (SIBREAK_CHARS.has(tok)) break;   // stop at first period/comma/quote
    if (!ARTICLES.has(tok)) result.push(tok);
  }
  return result;
}

/**
 * Split an input string into segments on SIBREAK tokens (period/comma)
 * and on the word "then", then tokenize each segment (articles stripped).
 * This replaces the old splitChained() export from tokenizer.ts.
 * Kept private here — Wave C9 will delete it when the lazy drive lands.
 */
function splitSegments(input: string): string[][] {
  // Use the new tokenize to get the canonical token stream.
  const allToks = tokenize(input);
  const segments: string[][] = [];
  let current: string[] = [];

  for (const tok of allToks) {
    if (SIBREAK_CHARS.has(tok) || tok === 'then') {
      // Flush the current segment (articles stripped).
      const filtered = current.filter(t => !ARTICLES.has(t));
      if (filtered.length > 0) segments.push(filtered);
      current = [];
    } else {
      current.push(tok);
    }
  }
  const filtered = current.filter(t => !ARTICLES.has(t));
  if (filtered.length > 0) segments.push(filtered);

  return segments;
}
import {
  lookupVerb,
  DIRECTIONS,
  normalizeDir,
  isPreposition,
  normalizePrep,
} from './vocabulary.js';

// ---------------------------------------------------------------------------
// C3 SYNTAX-CHECK replaces the Wave-B static preAction maps.
//
// The VERB_PRE_1OBJ / VERB_PRE_2OBJ static maps and lookupPreActionForVerb
// from Wave B are retired here.  syntaxCheck() (imported from syntax-check.ts)
// is the authoritative source for action / preAction / locBits — it reads
// directly from syntax.json declaration order and does not need static mirrors.
// ---------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Scope: what objects are reachable from the current room
// --------------------------------------------------------------------------

/**
 * Collect objects visible and reachable from a given room.
 * Includes:
 *  - Direct children of the room
 *  - Children of open containers in the room
 *  - GLOBAL objects referenced by the room's GLOBAL prop (ZIL globals)
 *  - Objects carried by the player (parent === null means inventory)
 *
 * The player argument is the actor object; if null we treat inventory as
 * the set of objects with no parent (only relevant for tests).
 */
function collectScope(room: Room, player: GameObject | null, world: World): GameObject[] {
  const scope: GameObject[] = [];
  const seen = new Set<ObjectId>();

  function addTree(obj: GameObject, depth: number): void {
    if (seen.has(obj.id)) return;
    seen.add(obj.id);
    // Always add the object itself (except the room — it's the container, not
    // a target).
    if (depth > 0) scope.push(obj);
    // Recurse into open containers (or transparent ones).
    const openable = obj.has(Flag.Container) && (obj.has(Flag.Open) || obj.has(Flag.Transparent));
    const alwaysOpen = !obj.has(Flag.Container); // non-containers have traversable children (e.g. rooms)
    if (depth === 0 || openable || alwaysOpen) {
      for (const child of obj.children) {
        addTree(child, depth + 1);
      }
    }
  }

  // Objects in the room.
  addTree(room, 0);

  // ZIL GLOBAL objects: the room's GLOBAL prop holds the id of an object that
  // is always accessible from this room regardless of containment.  Add it
  // (and its visible contents) to scope.
  const globalId = room.props.get('GLOBAL');
  if (typeof globalId === 'string') {
    const globalObj = world.get(globalId);
    if (globalObj !== undefined && !seen.has(globalObj.id)) {
      seen.add(globalObj.id);
      scope.push(globalObj);
      // Also add visible children of the global (e.g. objects on a table).
      for (const child of globalObj.children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          scope.push(child);
        }
      }
    }
  }

  // Exit gate objects: any object referenced by an exit's ifFlag is accessible
  // from this room (the player can interact with it to open the route).
  for (const exit of room.exits) {
    if (exit.ifFlag !== undefined) {
      const gateObj = world.get(exit.ifFlag);
      if (gateObj !== undefined && !seen.has(gateObj.id)) {
        seen.add(gateObj.id);
        scope.push(gateObj);
      }
    }
  }

  // Player's inventory (objects whose parent is the player, or null-parent
  // when there is no explicit player object in the world, as in simple tests).
  if (player !== null) {
    for (const item of player.children) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        scope.push(item);
      }
    }
  } else {
    // Test shortcut: add all world objects with null parent that aren't rooms.
    for (const obj of world.all()) {
      if (obj.parent === null && !seen.has(obj.id)) {
        // Skip the room itself.
        if (obj !== room) {
          seen.add(obj.id);
          scope.push(obj);
        }
      }
    }
  }

  return scope;
}

// --------------------------------------------------------------------------
// Noun resolution
// --------------------------------------------------------------------------

/**
 * Given a noun token (and optional adjective tokens), find matching objects
 * within the provided scope list.
 *
 * An object matches if:
 *  - The noun appears in its synonyms list (case-insensitive), AND
 *  - Every adjective token also appears in its adjectives list (or synonyms).
 */
function matchNoun(
  noun: string,
  adjectives: string[],
  scope: GameObject[],
): GameObject[] {
  const nounLc = noun.toLowerCase();
  return scope.filter(obj => {
    const synMatch = obj.synonyms.some(s => s.toLowerCase() === nounLc);
    if (!synMatch) return false;
    if (adjectives.length === 0) return true;
    return adjectives.every(adj => {
      const adjLc = adj.toLowerCase();
      return (
        obj.adjectives.some(a => a.toLowerCase() === adjLc) ||
        obj.synonyms.some(s => s.toLowerCase() === adjLc)
      );
    });
  });
}

// --------------------------------------------------------------------------
// Token-stream helpers
// --------------------------------------------------------------------------

/**
 * C3 INTERIM ADAPTER — Two-preposition split.
 *
 * Splits the tokens after the verb into prep1 / dobjTokens / prep2 / iobjTokens,
 * faithfully reflecting the ZIL sentence grammar:
 *   VERB [prep1] DOBJ [prep2] IOBJ
 *
 * If the FIRST non-empty token is a preposition, it is prep1 and the noun
 * phrase follows it.  Otherwise prep1 is absent and the noun phrase leads.
 * After the dobj noun phrase, if another preposition is found it becomes prep2.
 *
 * Also computes ncn (noun-clause count: 0, 1, or 2) for syntaxCheck.
 *
 * NOTE: This is an interim adapter.  The C2 SCAN-LOOP will replace this with
 * the authoritative P-NCN/P-PREP1/P-PREP2 derivation.
 *
 * @param rest  Tokens after the verb (articles already stripped by tokenizeSegment).
 */
function splitOnPreps(rest: string[]): {
  ncn: 0 | 1 | 2;
  prep1?: string;
  prep2?: string;
  dobjTokens: string[];
  iobjTokens: string[];
} {
  if (rest.length === 0) {
    return { ncn: 0, prep1: undefined, prep2: undefined, dobjTokens: [], iobjTokens: [] };
  }

  let prep1: string | undefined;
  let remaining = rest;

  // If the first token is a preposition, consume it as prep1.
  if (isPreposition(remaining[0]!)) {
    prep1 = normalizePrep(remaining[0]!);
    remaining = remaining.slice(1);
  }

  // Collect dobjTokens up to the next preposition (or end).
  let dobjTokens: string[] = [];
  let prep2: string | undefined;
  let iobjTokens: string[] = [];

  let splitAt = remaining.length; // default: no second prep found
  for (let i = 0; i < remaining.length; i++) {
    if (isPreposition(remaining[i]!)) {
      splitAt = i;
      prep2 = normalizePrep(remaining[i]!);
      iobjTokens = remaining.slice(i + 1);
      break;
    }
  }
  dobjTokens = remaining.slice(0, splitAt);

  // Count non-empty noun clauses.
  const hasDobj = dobjTokens.length > 0;
  const hasIobj = iobjTokens.length > 0;
  const ncn: 0 | 1 | 2 = hasDobj && hasIobj ? 2 : hasDobj || hasIobj ? 1 : 0;

  return { ncn, prep1, prep2, dobjTokens, iobjTokens };
}

/**
 * Separate adjective tokens from the final noun token in a noun phrase.
 * The last token is assumed to be the noun; everything before it is
 * treated as adjectives.
 */
function splitNounPhrase(tokens: string[]): { noun: string; adjectives: string[] } | null {
  if (tokens.length === 0) return null;
  const noun = tokens[tokens.length - 1]!;
  const adjectives = tokens.slice(0, -1);
  return { noun, adjectives };
}

// --------------------------------------------------------------------------
// Legacy null-player noun resolver (used only when player=null is passed).
// Uses old matchNoun + collectScope logic without lighting checks.
// Removed when C9 rewrites the full scan-loop.
// --------------------------------------------------------------------------

type LegacyResolveResult =
  | { ok: true; id: ObjectId }
  | { ok: false; result: ParseResult };

function _legacyResolveNounPhrase(
  tokens: string[],
  scope: GameObject[],
  pronounRef?: ObjectId,
): LegacyResolveResult {
  const phrase = splitNounPhrase(tokens);
  if (phrase === null) return { ok: true, id: undefined as unknown as ObjectId };

  const { noun, adjectives } = phrase;

  const isPronoun = (noun === 'it' || noun === 'them') && adjectives.length === 0;
  if (isPronoun) {
    if (pronounRef !== undefined) {
      return { ok: true, id: pronounRef };
    }
    // ZIL: "I don't see what you're referring to." (gparser.zil:1261)
    return {
      ok: false,
      result: {
        kind: 'fail',
        message: "I don't see what you're referring to.",
      },
    };
  }

  const matches = matchNoun(noun, adjectives, scope);

  if (matches.length === 0) {
    return {
      ok: false,
      result: {
        kind: 'fail',
        message: `I don't know the word "${noun}".`,
      },
    };
  }

  if (matches.length === 1) {
    return { ok: true, id: matches[0]!.id };
  }

  return {
    ok: false,
    result: {
      kind: 'disambig',
      // WHICH-PRINT verbatim format (gparser.zil:820-835)
      message: disambigMessage(noun, matches),
    },
  };
}

// --------------------------------------------------------------------------
// Disambiguation message helper — ZIL WHICH-PRINT (gparser.zil:820-835).
// Verbatim format: "Which <noun> do you mean, the A, the B, or the C?"
// With two candidates: "Which <noun> do you mean, the A or the B?"
// --------------------------------------------------------------------------

/**
 * Build the WHICH-PRINT disambiguation message.
 *
 * ZIL WHICH-PRINT (gparser.zil:820-835) format:
 *   "Which <noun> do you mean, the <desc1>, the <desc2>, or the <descN>?"
 *
 * With exactly two candidates the Oxford comma is omitted:
 *   "Which <noun> do you mean, the <desc1> or the <desc2>?"
 *
 * The noun used is the INPUT noun token (lowercase), not the object's desc.
 * Each candidate's desc is prefixed with "the ".
 *
 * Source: dfrotz live oracle + spec §17 line 571 (bug I-13).
 */
function disambigMessage(noun: string, objs: GameObject[]): string {
  const candidates = objs.map(o => `the ${o.desc}`);
  let candidateList: string;
  if (candidates.length <= 2) {
    candidateList = candidates.join(' or ');
  } else {
    const allButLast = candidates.slice(0, -1);
    const last = candidates[candidates.length - 1]!;
    candidateList = `${allButLast.join(', ')}, or ${last}`;
  }
  return `Which ${noun} do you mean, ${candidateList}?`;
}

// --------------------------------------------------------------------------
// Resolve a noun-phrase against scope using the C4 getObject pipeline.
// --------------------------------------------------------------------------

type ResolveResult =
  | { ok: true; id: ObjectId }
  | { ok: false; result: ParseResult }
  | { ok: 'pseudo'; action: string };

/**
 * C4 noun-phrase resolver.  Replaces the old matchNoun+collectScope approach.
 *
 * @param tokens      Noun-phrase token array (articles already stripped).
 * @param snap        ScopeSnapshot built once per parse turn.
 * @param here        Current room.
 * @param player      Player actor.
 * @param world       The world.
 * @param locBits     Syntax locBits for this slot (0 = unconstrained).
 * @param findBitName Raw ZIL findBit name from syntax (e.g. "ACTORBIT"), or undefined.
 * @param isLit       Whether the room is lit.
 * @param itRef       Current IT pronoun referent id, or undefined.
 */
function resolveNounPhrase(
  tokens: string[],
  snap: import('./scope.js').ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  locBits: number,
  findBitName: string | undefined,
  isLit: boolean,
  itRef: ObjectId | undefined,
): ResolveResult {
  const phrase = splitNounPhrase(tokens);
  if (phrase === null) return { ok: true, id: undefined as unknown as ObjectId };

  const { noun, adjectives } = phrase;

  // Pronoun short-circuit: "it" or "them" with no adjectives resolves to the
  // caller-supplied referent (or fails if none was bound).
  // C4: validate referent via accessible() before accepting it.
  const isPronoun = (noun === 'it' || noun === 'them') && adjectives.length === 0;
  if (isPronoun) {
    if (itRef !== undefined) {
      const itObj = world.get(itRef);
      if (itObj !== undefined && accessible(itObj, here, player, world)) {
        return { ok: true, id: itRef };
      }
    }
    // Either no referent bound, or referent has left scope.
    // ZIL: "I don't see what you're referring to." (gparser.zil:1261)
    return {
      ok: false,
      result: {
        kind: 'fail',
        message: "I don't see what you're referring to.",
      },
    };
  }

  // Resolve findBit name to a Flag (if provided and known).
  const findFlag = findBitName !== undefined ? FINDBIT_TO_FLAG[findBitName] : undefined;

  // P-NAM and P-ADJ: the noun is the last token; adjectives are everything before it.
  // Tokens are lowercase from the tokenizer; UPPERCASE them for thisItQ (ZIL canonical).
  const pNam = noun.toUpperCase();
  const pAdj = adjectives.length > 0 ? adjectives[adjectives.length - 1]!.toUpperCase() : undefined;

  const goResult = getObject(snap, here, player, world, pNam, pAdj, findFlag, locBits, isLit, true);

  switch (goResult.kind) {
    case 'ok': {
      if (goResult.ids.length === 0) {
        return {
          ok: false,
          result: { kind: 'fail', message: `I don't know the word "${noun}".` },
        };
      }
      if (goResult.ids.length === 1) {
        return { ok: true, id: goResult.ids[0]! };
      }
      // Multiple → disambig
      const objs = goResult.ids.map(id => world.get(id)).filter(Boolean) as GameObject[];
      return {
        ok: false,
        result: {
          kind: 'disambig',
          message: disambigMessage(noun, objs),
        },
      };
    }
    case 'disambig': {
      const objs = goResult.ids.map(id => world.get(id)).filter(Boolean) as GameObject[];
      return {
        ok: false,
        result: {
          kind: 'disambig',
          message: disambigMessage(noun, objs),
        },
      };
    }
    case 'not-here': {
      // ZIL distinction: "I don't know the word X" (word not in lexicon) vs
      // "You can't see any X here!" (word known but object not in scope).
      // Since we don't have a separate noun vocabulary, check if the noun word
      // appears in ANY object's synonyms/adjectives in the world.
      const nounUpper = goResult.noun;
      const isKnownNoun = world.all().some(
        o => o.synonyms.some(s => s.toUpperCase() === nounUpper) ||
             o.adjectives.some(a => a.toUpperCase() === nounUpper),
      );
      if (!isKnownNoun) {
        return {
          ok: false,
          result: {
            kind: 'fail',
            message: `I don't know the word "${noun}".`,
          },
        };
      }
      return {
        ok: false,
        result: {
          kind: 'not-here',
          noun: goResult.noun,
          message: `You can't see any ${goResult.noun.toLowerCase()} here!`,
        },
      };
    }
    case 'dark':
      return {
        ok: false,
        result: {
          kind: 'not-here',
          noun,
          message: "It's too dark to see!",
        },
      };
    case 'pseudo':
      // Pseudo sentinel — signals a pseudo-object match to the parse() caller.
      // The parser returns an ok command with the pseudo action as the action name.
      // Engine dispatch wiring for pseudo actions is a flagged seam (deferred).
      return { ok: 'pseudo', action: goResult.action };
    case 'missing-noun':
      return {
        ok: false,
        result: { kind: 'fail', message: 'There seems to be a noun missing in that sentence!' },
      };
    case 'none':
      return { ok: true, id: undefined as unknown as ObjectId };
  }
}

// --------------------------------------------------------------------------
// Parser class — stateful: holds pronoun bindings across turns.
// --------------------------------------------------------------------------

/**
 * A stateful parser instance.  Call `parse()` to resolve a command string
 * against the current scope.  The parser reads `itRef` (the IT pronoun
 * referent) during noun resolution; the Game writes it by calling
 * `bindPronouns()` from the PERFORM prologue (gmain.zil:202–203) after each
 * non-WALK command with a direct object.
 *
 * The canonical pronouns are "it" (last DO) and "them" (same binding — Zork
 * treats them identically for single-object commands).
 */
export class Parser {
  /** Last resolved direct-object id — bound to "it" / "them". */
  private itRef: ObjectId | undefined = undefined;

  /**
   * Parse a single command string against the current room context.
   *
   * @param input   Raw player input (one command segment — no chaining).
   * @param room    The room the player is currently in (defines scope).
   * @param player  The player actor for inventory scope; null in tests.
   * @param world   The full world, used for scope collection.
   */
  parse(
    input: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult {
    // Use the Wave-B adapter: split at first SIBREAK, drop articles.
    const tokens = tokenizeSegment(input);
    if (tokens.length === 0) {
      return { kind: 'fail', message: 'I beg your pardon?' };
    }

    // C4: Build ScopeSnapshot once per parse.
    // When player is null (legacy test shortcut), fall back to old collectScope
    // + matchNoun path for backward compat. Real gameplay always passes a player.
    // (This bridge is removed when C9 rewrites the full scan-loop.)
    if (player === null) {
      return this._parseLegacyNullPlayer(input, tokens, room, world);
    }

    const effectivePlayer: GameObject = player;
    const snap = buildScope(room, effectivePlayer, world);
    const isLit = litCheck(room, effectivePlayer, world);

    // Compass shorthand: bare direction token → walk <dir>
    if (tokens.length === 1 && DIRECTIONS.has(tokens[0]!)) {
      return {
        kind: 'ok',
        command: {
          verb: 'walk',
          action: 'V-WALK',
          dobjIds: undefined,
          iobjIds: undefined,
          prep: normalizeDir(tokens[0]!),
          raw: tokens,
        } satisfies ParsedCommand,
      };
    }

    const rawVerb = tokens[0]!;
    const canonical = lookupVerb(rawVerb);
    if (canonical === undefined) {
      return {
        kind: 'fail',
        message: `I don't know the word "${rawVerb}".`,
      };
    }

    const rest = tokens.slice(1);

    // --- C3 INTERIM ADAPTER -----------------------------------------------
    // Split rest into prep1 / dobjTokens / prep2 / iobjTokens and derive ncn.
    // C2 SCAN-LOOP will replace this with the authoritative ZIL P-NCN derivation.
    const { ncn, prep1, prep2, dobjTokens, iobjTokens } = splitOnPreps(rest);

    // Run SYNTAX-CHECK against the real syntax table (C3).
    // syntaxCheck requires UPPERCASE verb; canonical is lowercase.
    const verbUpper = canonical.toUpperCase();
    const syntaxResult = syntaxCheck(verbUpper, ncn, prep1, prep2);

    // Determine action and preAction from the syntax check result.
    let action: string;
    let preAction: string | undefined;
    let matchedSyntax: import('./types.js').SyntaxEntry | undefined;

    if (syntaxResult.kind === 'fail') {
      // gparser.zil:734 — "That sentence isn't one I recognize." (and no-verb fail).
      // Propagate verbatim — no C4 bridge, no fallback.
      return { kind: 'fail', message: syntaxResult.message };
    }

    if (syntaxResult.kind === 'matched') {
      action = syntaxResult.entry.action;
      preAction = syntaxResult.entry.preAction;
      matchedSyntax = syntaxResult.entry;
    } else {
      // syntaxResult.kind === 'needGwim': thin GWIM entry point (C4).
      // Full DRIVE1/DRIVE2 GWIM elaboration (orphan prompts, auto-supply) is deferred.
      // For now: use the drive's action name and locBits for scope resolution,
      // but do NOT propagate preAction (it may check for iobj that GWIM would supply).
      const drive = syntaxResult.drive1 ?? syntaxResult.drive2;
      action = drive?.action ?? ('V-' + canonical.toUpperCase());
      preAction = undefined;  // GWIM preAction deferred — full GWIM not yet wired
      matchedSyntax = drive;  // Use drive for locBits during dobj scope resolution
    }

    // The canonical prep for the ParsedCommand.prep field is prep1 if present,
    // else prep2 (the C3 grammar uses prep1 as the structurally primary prep).
    const prepOut = prep1 ?? prep2;

    let dobjIds: ObjectId[] | undefined;
    let iobjIds: ObjectId[] | undefined;

    // Extract locBits from matched syntax (if available).
    // findBit is the GWIM find-bit, not used during normal noun resolution.
    const dobjLocBits = matchedSyntax?.dobjLocBits ?? 0;
    const iobjLocBits = matchedSyntax?.iobjLocBits ?? 0;

    // Resolve direct object if any tokens remain.
    // NOTE: dobjFindBit is the GWIM findBit — only used during GWIM calls,
    // NOT during normal noun resolution (P-GWIMBIT is 0 during THIS-IT? in SEARCH-LIST).
    // Pass undefined for findBitName during normal resolution.
    if (dobjTokens.length > 0) {
      const r = resolveNounPhrase(
        dobjTokens, snap, room, effectivePlayer, world,
        dobjLocBits, undefined /* GWIM only */, isLit, this.itRef,
      );
      if (r.ok === 'pseudo') {
        // Pseudo sentinel: return ok command with the pseudo action.
        // The pseudo action IS the dispatch target (engine seam flagged).
        return {
          kind: 'ok',
          command: {
            verb: canonical,
            action: r.action,
            dobjIds: undefined,
            iobjIds: undefined,
            prep: prepOut,
            preAction: undefined,
            syntax: matchedSyntax,
            raw: tokens,
          },
        };
      }
      if (!r.ok) return r.result;
      if (r.id !== (undefined as unknown as ObjectId)) {
        dobjIds = [r.id];
      }
    }

    // Resolve indirect object if iobj tokens follow (after prep2).
    // Same as dobj: findBit is GWIM-only, not used during normal resolution.
    if (iobjTokens.length > 0) {
      const r = resolveNounPhrase(
        iobjTokens, snap, room, effectivePlayer, world,
        iobjLocBits, undefined /* GWIM only */, isLit, this.itRef,
      );
      if (r.ok === 'pseudo') {
        // Iobj pseudo sentinel (rare but possible).
        return {
          kind: 'ok',
          command: {
            verb: canonical,
            action: r.action,
            dobjIds,
            iobjIds: undefined,
            prep: prepOut,
            preAction: undefined,
            syntax: matchedSyntax,
            raw: tokens,
          },
        };
      }
      if (!r.ok) return r.result;
      if (r.id !== (undefined as unknown as ObjectId)) {
        iobjIds = [r.id];
      }
    }

    return {
      kind: 'ok',
      command: {
        verb: canonical,
        action,
        dobjIds,
        iobjIds,
        prep: prepOut,
        preAction,
        syntax: matchedSyntax,
        raw: tokens,
      },
    };
  }

  /**
   * Parse a chained input string — one with segments separated by "." or
   * "then" — returning one ParseResult per segment.  Processing stops at the
   * first error: the error result is appended and the remainder is discarded.
   *
   * IT pronoun binding is NOT propagated within this call — that is the
   * PERFORM prologue's job (Game.turn(), gmain.zil:202–203).  The parser only
   * READS itRef (which the game set on a prior turn).  Within-chain "take lamp
   * then examine it" requires Wave C's interleaved parse-and-dispatch model;
   * for now, cross-turn IT binding is the supported path (B3).
   *
   * "take all" / "drop all" and "take all except <noun>" are expanded here:
   * each takeable (or inventory item for drop) in scope becomes its own
   * ParseResult in the output list.
   */
  parseChained(
    input: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult[] {
    // Use the Wave-B adapter: split on SIBREAK/then, drop articles per segment.
    const segments = splitSegments(input);
    if (segments.length === 0) return [{ kind: 'fail', message: 'I beg your pardon?' }];

    const results: ParseResult[] = [];

    for (const tokens of segments) {
      // Detect "all" / "all except" patterns for multi-item expansion.
      const expanded = this.tryExpandAll(tokens, room, player, world);
      if (expanded !== null) {
        results.push(...expanded);
        // "take all" is a terminal segment — don't chain further.
        break;
      }

      // Normal single parse.
      const segment = tokens.join(' ');
      const result = this.parse(segment, room, player, world);
      results.push(result);

      if (result.kind !== 'ok') {
        // Stop chaining at first error.
        break;
      }
      // Note: IT-binding (bindPronouns) is NOT called here.  Per B3, the
      // authoritative binding site is the PERFORM prologue in Game.turn()
      // (gmain.zil:202–203), not inside the parser.  The parser only READS
      // itRef; the game writes it.  Within-chain IT propagation for same-line
      // segments (e.g. "take lamp then examine it" in one input) is a Wave C
      // concern — Wave C will interleave parsing and dispatch so the prologue
      // binding precedes each subsequent segment's parse.
    }

    return results;
  }

  /**
   * Try to interpret a token array as an "all" or "all except <noun>" form
   * for take/drop/get.  Returns an array of ParseResults (one per matching
   * object) when the pattern is recognised, or null when it isn't.
   *
   * Recognised forms:
   *   take all
   *   get all
   *   take all except <noun>
   *   drop all
   */
  private tryExpandAll(
    tokens: string[],
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult[] | null {
    if (tokens.length < 2) return null;

    const rawVerb = tokens[0]!;
    const canonical = lookupVerb(rawVerb);
    if (canonical === undefined) return null;

    // Only "take" (and synonym "get") and "drop" support "all" expansion.
    if (canonical !== 'take' && canonical !== 'drop') return null;

    // Must contain the word "all".
    const allIdx = tokens.indexOf('all');
    if (allIdx === -1) return null;

    // Determine excluded object id (for "all except <noun>").
    let excludeId: ObjectId | undefined;
    const exceptIdx = tokens.indexOf('except');
    if (exceptIdx !== -1 && exceptIdx > allIdx) {
      const exceptTokens = tokens.slice(exceptIdx + 1);
      if (exceptTokens.length > 0) {
        const scope = collectScope(room, player, world);
        const phrase = splitNounPhrase(exceptTokens);
        if (phrase !== null) {
          const matches = matchNoun(phrase.noun, phrase.adjectives, scope);
          if (matches.length === 1) excludeId = matches[0]!.id;
          // If ambiguous or not found, we simply don't exclude anything —
          // the engine will handle it when executing.
        }
      }
    }

    const scope = collectScope(room, player, world);

    // For "take all": pick every takeable object in scope.
    // For "drop all": pick every takeable object without a parent (inventory
    //   shortcut) or carried by the player.
    const candidates: GameObject[] =
      canonical === 'take'
        ? scope.filter(o => o.has(Flag.Takeable))
        : scope.filter(o => o.has(Flag.Takeable) && (o.parent === null || o.parent === player));

    const matches = candidates.filter(o => o.id !== excludeId);

    if (matches.length === 0) return [];

    // Get preAction for the 1-obj form of this verb via syntaxCheck (C3).
    // "take X" (ncn=1, no preps) → syntaxCheck should return matched V-TAKE with PRE-TAKE.
    const takeResult = syntaxCheck(canonical.toUpperCase(), 1);
    const expandAction = takeResult.kind === 'matched' ? takeResult.entry.action : 'V-' + canonical.toUpperCase();
    const expandPreAction = takeResult.kind === 'matched' ? takeResult.entry.preAction : undefined;
    const expandSyntax = takeResult.kind === 'matched' ? takeResult.entry : undefined;

    return matches.map(obj => ({
      kind: 'ok' as const,
      command: {
        verb: canonical,
        action: expandAction,
        dobjIds: [obj.id],
        iobjIds: undefined,
        prep: undefined,
        preAction: expandPreAction,
        syntax: expandSyntax,
        raw: tokens,
      },
    }));
  }

  /**
   * LEGACY backward-compat path for tests that pass player=null.
   * Uses the old collectScope + matchNoun approach (no lighting check).
   * Removed when C9 rewrites the full scan-loop.
   */
  private _parseLegacyNullPlayer(
    _input: string,
    tokens: string[],
    room: Room,
    world: World,
  ): ParseResult {
    const scope = collectScope(room, null, world);

    if (tokens.length === 1 && DIRECTIONS.has(tokens[0]!)) {
      return {
        kind: 'ok',
        command: {
          verb: 'walk',
          action: 'V-WALK',
          dobjIds: undefined,
          iobjIds: undefined,
          prep: normalizeDir(tokens[0]!),
          raw: tokens,
        },
      };
    }

    const rawVerb = tokens[0]!;
    const canonical = lookupVerb(rawVerb);
    if (canonical === undefined) {
      return { kind: 'fail', message: `I don't know the word "${rawVerb}".` };
    }

    const rest = tokens.slice(1);
    const { ncn, prep1, prep2, dobjTokens, iobjTokens } = splitOnPreps(rest);
    const verbUpper = canonical.toUpperCase();
    const syntaxResult = syntaxCheck(verbUpper, ncn, prep1, prep2);

    let action: string;
    let preAction: string | undefined;
    let matchedSyntax: import('./types.js').SyntaxEntry | undefined;

    if (syntaxResult.kind === 'fail') {
      return { kind: 'fail', message: syntaxResult.message };
    }
    if (syntaxResult.kind === 'matched') {
      action = syntaxResult.entry.action;
      preAction = syntaxResult.entry.preAction;
      matchedSyntax = syntaxResult.entry;
    } else {
      const drive = syntaxResult.drive1 ?? syntaxResult.drive2;
      action = drive?.action ?? ('V-' + canonical.toUpperCase());
      preAction = drive?.preAction;
      matchedSyntax = drive;
    }

    const prepOut = prep1 ?? prep2;
    let dobjIds: ObjectId[] | undefined;
    let iobjIds: ObjectId[] | undefined;

    if (dobjTokens.length > 0) {
      const r = _legacyResolveNounPhrase(dobjTokens, scope, this.itRef);
      if (!r.ok) return r.result;
      if (r.id !== (undefined as unknown as ObjectId)) dobjIds = [r.id];
    }
    if (iobjTokens.length > 0) {
      const r = _legacyResolveNounPhrase(iobjTokens, scope, this.itRef);
      if (!r.ok) return r.result;
      if (r.id !== (undefined as unknown as ObjectId)) iobjIds = [r.id];
    }

    return {
      kind: 'ok',
      command: { verb: canonical, action, dobjIds, iobjIds, prep: prepOut, preAction, syntax: matchedSyntax, raw: tokens },
    };
  }

  /**
   * Update pronoun state from a successfully resolved command.
   * The direct object becomes the new "it" / "them" referent.
   *
   * Called from the PERFORM prologue in Game.turn() (gmain.zil:202–203) for
   * non-WALK commands that have a direct object — NOT from inside the parser
   * itself.  The parser only READS itRef during noun resolution; the game
   * writes it (B3 seam: parser reads, PERFORM prologue writes).
   *
   * Also called directly by tests to simulate the game binding a referent.
   */
  bindPronouns(cmd: ParsedCommand): void {
    const dobjId = cmd.dobjIds?.[0];
    if (dobjId !== undefined) {
      this.itRef = dobjId;
    }
    // If there is no dobj but there is an iobj, the DO is what gets referenced
    // in most Zork interactions (the acted-upon thing). We leave itRef as-is
    // when no dobj was present so the previous referent persists.
  }
}

// --------------------------------------------------------------------------
// Module-level parse function — kept for backward compat with Task 2.2 tests.
// Creates a one-shot parser with no pronoun state.
// --------------------------------------------------------------------------

/**
 * Parse a single command string against the current room context.
 * This is a convenience wrapper around `new Parser().parse(...)` for
 * callers that do not need pronoun state across turns.
 */
export function parse(
  input: string,
  room: Room,
  player: GameObject | null,
  world: World,
): ParseResult {
  return new Parser().parse(input, room, player, world);
}

export type { ParsedCommand, ParseResult };
