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
 * Split an input string into segments on SIBREAK tokens (period/comma) and on
 * the word "then".  "and" is treated as a segment separator ONLY when the
 * current segment begins with AGAIN/G — matching ZIL semantics where "and"
 * after AGAIN (gparser.zil:202-206) is a continuation separator, but "and"
 * inside a noun clause (e.g. "take sword and lantern") is an ANDFLG object-list
 * connector handled by the noun scanner (gparser.zil:459-491), not by command
 * splitting.
 *
 * C8-FIX (B2): the prior repair treated "and" as a universal separator, which
 * broke "take sword and lantern" by splitting it into two segments.  Narrowed
 * to THEN/period only at the segment level; ANDFLG-style AND is handled in
 * resolveNounPhraseList() in the noun scanning path.
 *
 * This replaces the old splitChained() export from tokenizer.ts.
 * Kept private here — Wave C9 will delete it when the lazy drive lands.
 */
function splitSegments(input: string): string[][] {
  // Use the new tokenize to get the canonical token stream.
  const allToks = tokenize(input);
  const segments: string[][] = [];
  let current: string[] = [];

  // Track whether the current segment's first content token is AGAIN/G.
  // "and" splits a segment only in AGAIN/G context (ZIL gparser.zil:202-206).
  let currentStartsWithAgain = false;

  for (const tok of allToks) {
    const isStructural =
      SIBREAK_CHARS.has(tok) ||
      tok === 'then' ||
      (tok === 'and' && currentStartsWithAgain);

    if (isStructural) {
      // Flush the current segment (articles stripped).
      const filtered = current.filter(t => !ARTICLES.has(t));
      if (filtered.length > 0) segments.push(filtered);
      current = [];
      currentStartsWithAgain = false;
    } else {
      // Detect whether this is the first content token (after any articles).
      if (current.filter(t => !ARTICLES.has(t)).length === 0 && !ARTICLES.has(tok)) {
        currentStartsWithAgain = (tok === 'again' || tok === 'g');
      }
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
import { gwim, ROOMS_SENTINEL } from './gwim.js';
import { SMANY, STAKE, SHAVE, SOG, SIR, SH, SC, SRCTOP } from './scope-bits.js';

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
// C6: MANY-CHECK (gparser.zil:1294-1313)
// --------------------------------------------------------------------------

/**
 * Check whether multiple direct objects are permitted for the matched syntax.
 *
 * ZIL MANY-CHECK (gparser.zil:1294-1313):
 *   If P-PRSO has > 1 entry AND P-SLOC1 lacks SMANY(4):
 *     "You can't use multiple direct objects with \"<verb>\"."
 *   Same for PRSI / P-SLOC2 / "indirect".
 *
 * Returns a fail ParseResult if the check fails, undefined if it passes.
 *
 * @param verb        The canonical (lowercase) verb word for the error message.
 * @param dobjIds     The resolved direct objects (may be multiple with ALL/AND).
 * @param iobjIds     The resolved indirect objects.
 * @param dobjLocBits dobjLocBits from the matched syntax entry.
 * @param iobjLocBits iobjLocBits from the matched syntax entry.
 */
function manyCheck(
  verb: string,
  dobjIds: ObjectId[] | undefined,
  iobjIds: ObjectId[] | undefined,
  dobjLocBits: number,
  iobjLocBits: number,
): { kind: 'fail'; message: string } | undefined {
  // Direct objects: > 1 and SMANY not set
  if (dobjIds !== undefined && dobjIds.length > 1 && !(dobjLocBits & SMANY)) {
    return {
      kind: 'fail',
      message: `You can't use multiple direct objects with "${verb}".`,
    };
  }
  // Indirect objects: > 1 and SMANY not set on iobjLocBits
  if (iobjIds !== undefined && iobjIds.length > 1 && !(iobjLocBits & SMANY)) {
    return {
      kind: 'fail',
      message: `You can't use multiple indirect objects with "${verb}".`,
    };
  }
  return undefined;
}

// --------------------------------------------------------------------------
// C6: TAKE-CHECK / ITAKE-CHECK (gparser.zil:1244-1292)
// --------------------------------------------------------------------------

/**
 * Check STAKE (auto-take) and SHAVE (must-have) bits per resolved object.
 *
 * ZIL ITAKE-CHECK (gparser.zil:1248-1292):
 *
 * Per object in the table:
 *   1. If not held AND STAKE or SHAVE bit is set:
 *      a. If TRYTAKEBIT → TAKEN=true (can't take this)
 *      b. If WINNER != ADVENTURER → TAKEN=false (only player can auto-take)
 *      c. If STAKE and ITAKE() returns T → TAKEN=false (take succeeded)
 *      d. Else → TAKEN=true (take failed)
 *
 *   2. If TAKEN and SHAVE and WINNER=ADVENTURER:
 *      → "You don't have the <obj>." (or "that!" for NOT-HERE-OBJECT) → fail
 *
 *   3. If NOT TAKEN and WINNER=ADVENTURER:
 *      → "(Taken)" echoed, mark autoTaken
 *
 * PORT MODEL:
 *   We simplify ITAKE: if the object has Flag.Takeable, STAKE auto-take
 *   "succeeds" (TAKEN=false). If not Takeable, it "fails" (TAKEN=true).
 *   This is conservative but correct for standard Zork I objects.
 *   The actual move (moveTo player) is NOT done here — that's the action handler's job.
 *   We only mark autoTaken so Game.turn can print "(Taken)" and the handler knows.
 *
 * Returns:
 *   - { kind: 'fail', message } if SHAVE fires
 *   - { autoTaken: ObjectId[] } with objects that were successfully STAKE-auto-taken
 *   - undefined if no STAKE/SHAVE bits set (normal path)
 */
function takeCheck(
  dobjIds: ObjectId[],
  dobjLocBits: number,
  player: GameObject,
  world: World,
): { kind: 'fail'; message: string } | { autoTaken: ObjectId[] } | undefined {
  // Quick exit: neither STAKE nor SHAVE set → nothing to check
  if (!(dobjLocBits & STAKE) && !(dobjLocBits & SHAVE)) {
    return undefined;
  }

  const autoTaken: ObjectId[] = [];

  for (const id of dobjIds) {
    const obj = world.get(id);
    if (obj === undefined) continue;

    // "HELD?" check: object is held if it's a direct or indirect descendant of the player.
    // ZIL HELD? walks up the parent chain to WINNER.
    // Port: check parent chain to player.
    const isHeld = isHeldByPlayer(obj, player);

    if (!isHeld) {
      // Object not held — check STAKE/SHAVE
      let taken = true; // assume take fails unless we prove otherwise

      if (!obj.has(Flag.TryTake)) {
        // No TRYTAKEBIT resistance
        // Port: if STAKE set and object is Takeable → take succeeds
        if ((dobjLocBits & STAKE) && obj.has(Flag.Takeable)) {
          taken = false; // auto-take succeeded
        }
        // (No WINNER != ADVENTURER check needed in port — player is always ADVENTURER)
      }

      if (!taken) {
        // Auto-take succeeded → mark autoTaken (Game.turn prints "(Taken)")
        autoTaken.push(id);
      } else if (dobjLocBits & SHAVE) {
        // STAKE failed (or not set) AND SHAVE set → hard fail
        // ZIL: "You don't have the <obj>." (gparser.zil:1285-1286)
        return {
          kind: 'fail',
          message: `You don't have the ${obj.desc}.`,
        };
      }
      // STAKE without SHAVE and take failed → silent (no error, no autoTaken)
    }
  }

  if (autoTaken.length > 0) {
    return { autoTaken };
  }
  return undefined;
}

/**
 * Returns true if `obj` is held by `player` (direct child or in an open
 * container in player's inventory). Implements ZIL HELD?.
 *
 * Port: walk up obj.parent chain; if any ancestor is `player`, it's held.
 */
function isHeldByPlayer(obj: GameObject, player: GameObject): boolean {
  let current: GameObject | null = obj.parent as GameObject | null;
  while (current !== null) {
    if (current === player) return true;
    current = current.parent as GameObject | null;
  }
  return false;
}

// --------------------------------------------------------------------------
// C6: applyC6Checks — applies MANY-CHECK and TAKE-CHECK, then builds ok result
// --------------------------------------------------------------------------

/**
 * C6 gate: apply MANY-CHECK and TAKE-CHECK before returning an ok ParseResult.
 *
 * Called from every code path in parse() that resolves dobjIds/iobjIds and
 * is about to return an ok command.  Returns a fail ParseResult if either
 * check fires, or the original ok command (with autoTaken populated) if clean.
 *
 * This centralizes MANY-CHECK + TAKE-CHECK so they apply to both the normal
 * matched path AND all GWIM/drive paths that return early.
 */
function applyC6Checks(
  verb: string,
  dobjIds: ObjectId[] | undefined,
  iobjIds: ObjectId[] | undefined,
  dobjLocBits: number,
  iobjLocBits: number,
  player: GameObject,
  world: World,
): { kind: 'fail'; message: string } | { autoTaken?: ObjectId[] } {
  // MANY-CHECK
  const manyFail = manyCheck(verb, dobjIds, iobjIds, dobjLocBits, iobjLocBits);
  if (manyFail !== undefined) return manyFail;

  // TAKE-CHECK — dobj
  let autoTaken: ObjectId[] | undefined;
  if (dobjIds !== undefined && dobjIds.length > 0) {
    const tcResult = takeCheck(dobjIds, dobjLocBits, player, world);
    if (tcResult !== undefined && 'kind' in tcResult) return tcResult;
    if (tcResult !== undefined && 'autoTaken' in tcResult && tcResult.autoTaken.length > 0) {
      autoTaken = (autoTaken ?? []).concat(tcResult.autoTaken);
    }
  }

  // TAKE-CHECK — iobj
  if (iobjIds !== undefined && iobjIds.length > 0) {
    const tcResult = takeCheck(iobjIds, iobjLocBits, player, world);
    if (tcResult !== undefined && 'kind' in tcResult) return tcResult;
    if (tcResult !== undefined && 'autoTaken' in tcResult && tcResult.autoTaken.length > 0) {
      autoTaken = (autoTaken ?? []).concat(tcResult.autoTaken);
    }
  }

  return { autoTaken };
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

/**
 * C8-FIX (ANDFLG): resolve a noun token list that may contain "and" as an
 * object-list connector (gparser.zil:459-491 CLAUSE ANDFLG mechanism).
 *
 * When "and" (or comma) appears between nouns in a dobj clause
 * (e.g. "take sword and lantern"), ZIL sets ANDFLG and continues scanning to
 * accumulate multiple objects.  This function handles that case by splitting
 * on "and", resolving each sub-phrase via resolveNounPhrase, and collecting
 * all resolved ids into one list.
 *
 * Returns:
 *   { ids: ObjectId[] }    — all resolved object ids (one or more)
 *   ResolveResult (not ok) — first resolution error, stops accumulation
 *   { pseudo, action }     — if any sub-phrase resolves to a pseudo-object
 *
 * ONLY the dobj slot uses ANDFLG; iobj never has AND lists in ZIL Zork I.
 */
type NounListResult =
  | { kind: 'ids'; ids: ObjectId[] }
  | { kind: 'fail'; result: ResolveResult };

function resolveNounPhraseList(
  tokens: string[],
  snap: import('./scope.js').ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  locBits: number,
  isLit: boolean,
  itRef: ObjectId | undefined,
): NounListResult {
  // Split tokens on "and" to detect ANDFLG-style object lists.
  // "sword and lantern" → [["sword"], ["lantern"]]
  // "brass lantern" → [["brass", "lantern"]] (no split)
  const groups: string[][] = [];
  let current: string[] = [];
  for (const tok of tokens) {
    if (tok === 'and') {
      if (current.length > 0) groups.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  if (current.length > 0) groups.push(current);

  // Single group — no AND connector; delegate to standard resolveNounPhrase.
  if (groups.length === 1) {
    const r = resolveNounPhrase(tokens, snap, here, player, world, locBits, undefined, isLit, itRef);
    if (r.ok === false) return { kind: 'fail', result: r };
    if (r.ok === 'pseudo') return { kind: 'fail', result: r };
    const id = r.id as ObjectId;
    return { kind: 'ids', ids: id !== undefined ? [id] : [] };
  }

  // Multiple groups: ANDFLG — resolve each group, accumulate ids.
  const ids: ObjectId[] = [];
  for (const group of groups) {
    const r = resolveNounPhrase(group, snap, here, player, world, locBits, undefined, isLit, itRef);
    if (r.ok === false) return { kind: 'fail', result: r };
    if (r.ok === 'pseudo') {
      // Pseudo-object encountered in an AND list — unusual; treat as fail.
      return { kind: 'fail', result: { ok: false, result: { kind: 'fail', message: "I don't understand that." } } };
    }
    const id = r.id as ObjectId;
    if (id !== undefined) ids.push(id);
  }

  return { kind: 'ids', ids };
}

// --------------------------------------------------------------------------
// C7: Orphan helper functions (module-level, no class state)
// --------------------------------------------------------------------------

/**
 * Build the verbatim ZIL orphan prompt.
 *
 * gparser.zil:758-773:
 *   "What do you want to " + verbWord + [" the " + thingDesc] + [" " + prep] + "?"
 *
 * @param verbWord   Raw typed verb (e.g. "take", "listen")
 * @param thingDesc  Desc of an already-resolved object (DRIVE2 case only, e.g. "troll").
 *                   When set, the prompt includes "the <thingDesc>" before the prep.
 * @param prep       The prep from the missing slot's syntax form (e.g. "WITH", "TO").
 *                   If set, appended as lowercase after the thing.
 */
function buildOrphanPrompt(
  verbWord: string,
  thingDesc: string | undefined,
  prep: string | undefined,
): string {
  let msg = `What do you want to ${verbWord}`;
  if (thingDesc !== undefined) {
    msg += ` the ${thingDesc}`;
  }
  if (prep !== undefined) {
    msg += ` ${prep.toLowerCase()}`;
  }
  msg += '?';
  return msg;
}

/**
 * Re-resolve a noun token against scope to collect the candidate ids for a
 * disambig orphan.  Used when resolveNounPhrase returns disambig so we can
 * save the candidate list in OrphanState.
 *
 * This is a stripped-down lookup: match by noun synonym across all scope tiers,
 * returning all matching ids (the full ambiguous set).
 */
function _extractDisambigCandidates(
  noun: string,
  snap: import('./scope.js').ScopeSnapshot,
  room: Room,
  player: GameObject,
  world: World,
  locBits: number,
  isLit: boolean,
): ObjectId[] {
  const result = getObject(snap, room, player, world, noun.toUpperCase(), undefined, undefined, locBits, isLit, false);
  if (result.kind === 'ok' || result.kind === 'disambig') {
    return result.ids;
  }
  return [];
}

// --------------------------------------------------------------------------
// C7: OrphanState — parser state saved across turns for orphan/disambig.
//
// When SYNTAX-CHECK can't fill a required object slot (GWIM finds 0 or 2+
// candidates, or disambiguation is needed), the parser saves the in-progress
// command context and emits a "What do you want to…?" or "Which … do you mean?"
// prompt. The *next* turn's input is the answer; ORPHAN-MERGE grafts it in.
//
// Port model for gparser.zil:P-OFLAG / P-OTBL / P-ACLAUSE / P-ANAM / P-AADJ.
// --------------------------------------------------------------------------

/**
 * Which slot the orphan is waiting to fill: dobj (nc1) or iobj (nc2).
 */
type OrphanSlot = 'dobj' | 'iobj';

/**
 * Saved state from the in-progress command that triggered an orphan/disambig.
 * Carried across turns; cleared after a successful ORPHAN-MERGE.
 */
interface OrphanState {
  /** The canonical verb that triggered the orphan (e.g. "take"). */
  verb: string;
  /** The raw verb word as typed (for echo in the prompt). */
  verbWord: string;
  /** Canonical prep1 (from the input or matched drive). */
  prep1?: string;
  /** Canonical prep2 (from the matched drive). */
  prep2?: string;
  /** Which noun slot is missing. */
  slot: OrphanSlot;
  /** The matched syntax entry (for action/preAction/locBits). */
  syntax: import('./types.js').SyntaxEntry;
  /**
   * If DRIVE2 fired (dobj was resolved, iobj is missing), the resolved dobj ids.
   * Used to re-include the dobj in the merged command.
   */
  resolvedDobjIds?: ObjectId[];
  /**
   * Set when WHICH-PRINT was issued (disambiguation pending).
   * Contains the ambiguous candidates and the original noun token.
   */
  disambig?: {
    noun: string;          // the noun token from the original input (for re-match)
    candidates: ObjectId[]; // the ambiguous set from getObject
  };
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
   * C7 orphan/disambig state.  Set when the parser issued a "What do you want
   * to…?" or "Which…?" prompt.  Cleared after a successful ORPHAN-MERGE or
   * when the answer is a fresh command (abandons orphan).
   * gparser.zil: P-OFLAG (boolean), P-OTBL (saved parse tables).
   */
  private orphan: OrphanState | undefined = undefined;

  // ---- C8: AGAIN/G state (gparser.zil:192-233) --------------------------------

  /**
   * The raw input string of the last non-AGAIN command that was parsed.
   * Replays on AGAIN/G.  Port equivalent of AGAIN-LEXV (gparser.zil:36).
   * Stored as a string because parse() accepts strings; re-parse from the top
   * on AGAIN.
   */
  private lastInput: string | undefined = undefined;

  /**
   * Whether the last parse+execute succeeded (P-WON in gmain.zil).
   * Set by the game harness via setLastWon() after each turn.
   * AGAIN refuses with "That would just repeat a mistake." when false.
   */
  private lastWon: boolean = false;

  /**
   * C9: Continuation token segments (P-CONT equivalent).
   *
   * When the scan loop hits a THEN/period separator, the remaining input is
   * stored here as pre-split segments (already filtered through splitSegments).
   * Game.turn's interleaved loop calls parseSegment() which consumes segments
   * from this queue without re-reading user input.
   *
   * Stored as an array of token arrays (not raw strings) because splitSegments
   * already did the article-stripping — we don't want to re-process.
   * Each entry is one segment's tokens.
   */
  private continuation: string[][] | undefined = undefined;

  /**
   * C9: Pre-parsed result queue for ALL/AND expansion.
   *
   * When tryExpandAll() or ANDFLG returns multiple ParseResults (e.g. "take all"
   * expands to one result per object), the extras are queued here so Game.turn()
   * can process them one at a time via parseSegment().  Each call to parseSegment
   * that finds entries here dequeues the next pre-parsed result directly —
   * no re-tokenization needed.
   */
  private parsedQueue: ParseResult[] | undefined = undefined;

  /**
   * Called by Game.turn() after each command executes (or fails to parse).
   * Sets P-WON equivalent: true = last command succeeded, false = it failed.
   *
   * @param won  true if the command parsed AND executed without M-FATAL.
   */
  setLastWon(won: boolean): void {
    this.lastWon = won;
  }

  /**
   * C9: True when there are pending continuation segments or pre-parsed results
   * queued.  Game.turn() loops while this is true without reading new user input.
   *
   * gparser.zil: P-CONT (the continuation token buffer).
   */
  hasContinuation(): boolean {
    return (
      (this.continuation !== undefined && this.continuation.length > 0) ||
      (this.parsedQueue !== undefined && this.parsedQueue.length > 0)
    );
  }

  /**
   * C9: True when the parser is awaiting input to answer an orphan/disambig
   * prompt.  Game.turn() must:
   *   1. Skip the move counter increment for the CURRENT turn.
   *   2. On the NEXT turn, call parseSegment() with the user's answer so
   *      ORPHAN-MERGE can graft it into the saved command.
   *
   * gparser.zil: P-OFLAG (whether an orphan is pending).
   */
  isAwaitingInput(): boolean {
    return this.orphan !== undefined;
  }

  /**
   * C9: Clear the continuation queue and parsed queue (P-CONT clear on M-FATAL).
   * Called by Game.turn() when M-FATAL fires, per gmain.zil:161.
   */
  clearContinuation(): void {
    this.continuation = undefined;
    this.parsedQueue = undefined;
  }

  /**
   * C9: The interleaved-drive entry point for Game.turn().
   *
   * Implements input acquisition (gparser.zil:131-153) from Game.turn's
   * perspective:
   *   0. If pre-parsed queue non-empty (from ALL/AND expansion) → dequeue the
   *      next pre-parsed result and return it directly.
   *   1. If continuation queue non-empty → pop the front segment, dispatch
   *      through the full parse path for that segment (do NOT read rawLine).
   *   2. Else if orphan pending → tokenize rawLine as the answer, run ORPHAN-MERGE.
   *   3. Else → tokenize rawLine, detect THEN/period, queue remainder as
   *      continuation, dispatch the first segment through the full parse path.
   *
   * "Full parse path" means: check for tryExpandAll (ALL/AND expansion) first,
   * then parse() for a single command.  Multi-result expansions queue their
   * extras into parsedQueue for subsequent parseSegment() calls.
   *
   * After a successful parse: if there are still tokens beyond the current
   * segment in this input string, they are queued as continuation segments.
   * Game.turn() loops calling parseSegment() (with rawLine='') until
   * hasContinuation() returns false.
   *
   * @param rawLine  The player's raw input for this turn (ignored when
   *                 consuming a continuation segment, a pre-parsed queue
   *                 entry, or answering an orphan from a prior chained segment).
   * @param room     Current room.
   * @param player   Player actor.
   * @param world    The world.
   */
  parseSegment(
    rawLine: string,
    room: Room,
    player: GameObject,
    world: World,
  ): ParseResult {
    // Path 0: pre-parsed result queue (ALL/AND expansion overflow).
    if (this.parsedQueue !== undefined && this.parsedQueue.length > 0) {
      const next = this.parsedQueue.shift()!;
      if (this.parsedQueue.length === 0) {
        this.parsedQueue = undefined;
      }
      return next;
    }

    let tokens: string[];

    if (this.continuation !== undefined && this.continuation.length > 0) {
      // Path 1: consume the next queued continuation segment.
      tokens = this.continuation.shift()!;
      if (this.continuation.length === 0) {
        this.continuation = undefined;
      }

    } else if (this.orphan !== undefined) {
      // Path 2: orphan pending — rawLine is the answer.
      // parse() handles the ORPHAN-MERGE branch internally (§7, §10).
      return this.parse(rawLine, room, player, world);

    } else {
      // Path 3: fresh input — split on THEN/period, queue remainder.
      const allSegments = splitSegments(rawLine);
      if (allSegments.length === 0) {
        return { kind: 'fail', message: 'I beg your pardon?' };
      }
      // Queue segments 2..N as continuation (in order).
      if (allSegments.length > 1) {
        this.continuation = allSegments.slice(1);
      }
      tokens = allSegments[0]!;
    }

    // Dispatch tokens through the full parse path:
    //   a. tryExpandAll for ALL/AND expansion (multi-result).
    //   b. parse() for a single command.
    //
    // This mirrors what parseChained() did per segment, but routes through
    // parseSegment() instead of collecting into an array.
    const expanded = this.tryExpandAll(tokens, room, player, world);
    if (expanded !== null) {
      if (expanded.length === 0) {
        // "take all" with nothing to take — return a no-op or empty result.
        // parseChained returned empty array; we return a benign ok with no dobj.
        return { kind: 'fail', message: "There's nothing here to take." };
      }
      // Queue extras as pre-parsed results (except the first which we return).
      if (expanded.length > 1) {
        this.parsedQueue = expanded.slice(1);
      }
      return expanded[0]!;
    }

    // Check for ANDFLG expansion (multiple dobjIds from AND-connected noun list).
    // parse() handles ANDFLG internally; if it returns ok with multiple dobjIds,
    // split into individual commands.
    const singleResult = this.parse(tokens.join(' '), room, player, world);
    if (
      singleResult.kind === 'ok' &&
      singleResult.command.dobjIds !== undefined &&
      singleResult.command.dobjIds.length > 1
    ) {
      // Expand into one result per dobjId (allIter flag for "<desc>: " prefix).
      const expanded2: ParseResult[] = singleResult.command.dobjIds.map(id => ({
        kind: 'ok' as const,
        command: { ...singleResult.command, dobjIds: [id], allIter: true as const },
      }));
      if (expanded2.length > 1) {
        this.parsedQueue = expanded2.slice(1);
      }
      return expanded2[0]!;
    }

    return singleResult;
  }

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

    // ---- C8: AGAIN/G detection (gparser.zil:192-233) --------------------------
    // Check BEFORE orphan-merge, BEFORE verb classification.
    // The first token (lowercased) is AGAIN or G.
    if (tokens[0] === 'again' || tokens[0] === 'g') {
      return this._handleAgain(tokens, input, room, player, world);
    }

    // Save this non-AGAIN input so a future AGAIN/G can replay it.
    // Store the raw string (parse() takes strings; re-parse from top).
    // Do NOT overwrite lastInput here — wait until after a successful parse
    // so "repeat a mistake" guard sees the ORIGINAL failing input, not AGAIN.
    // We save it at the END of this method (successful or failed parse).
    // Actually per ZIL: AGAIN-LEXV is always saved (good or bad parse); P-WON
    // gates whether the replay is allowed.  So save EVERY non-AGAIN input.
    this.lastInput = input;

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

    // C7: ORPHAN-MERGE — if orphan state is set, try to graft this input as the answer.
    // gparser.zil:373 (<COND (,P-OFLAG <ORPHAN-MERGE>)>)
    // ORPHAN-MERGE fires before verb classification — the answer input might be a bare
    // noun/adjective with no verb, which is the normal case.
    if (this.orphan !== undefined) {
      return this._orphanMerge(tokens, room, effectivePlayer, world, snap, isLit);
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

    // gwimText accumulates parenthetical text from GWIM auto-supply (C5).
    let gwimText: string | undefined;

    if (syntaxResult.kind === 'matched') {
      action = syntaxResult.entry.action;
      preAction = syntaxResult.entry.preAction;
      matchedSyntax = syntaxResult.entry;
    } else {
      // syntaxResult.kind === 'needGwim' — C5 GWIM (gparser.zil:739-775).
      //
      // DRIVE1: ncn==0, player typed verb [+prep] but no nouns. Auto-supply dobj.
      // DRIVE2: ncn==1, player typed verb + dobj but no iobj. Auto-supply iobj.
      //
      // P-END-ON-PREP (gparser.zil:326): set when a prep was scanned and nothing
      // followed it (no noun clause opened). In our interim model: endOnPrep is
      // true iff ncn===0 AND prep1 is set (typed prep with no noun).
      const endOnPrep = ncn === 0 && prep1 !== undefined;

      if (syntaxResult.drive1 !== undefined) {
        // DRIVE1: auto-supply dobj from drive1.dobjFindBit.
        const d1 = syntaxResult.drive1;
        action = d1.action;
        preAction = d1.preAction;
        matchedSyntax = d1;

        const gwimResult = gwim(
          d1.dobjFindBit,    // findBit name (e.g. "LIGHTBIT", "RMUNGBIT")
          d1.dobjLocBits,    // scope bits
          d1.prep1,          // prep to print in parenthetical (e.g. "ON")
          endOnPrep,         // whether prep was a trailing-prep (no noun followed)
          snap,
          room,
          effectivePlayer,
          world,
          isLit,
        );

        if (gwimResult.kind === 'rooms') {
          // RMUNGBIT sentinel: no parenthetical, ROOMS_SENTINEL as dobjId.
          // Return immediately — no further noun resolution needed.
          return {
            kind: 'ok',
            command: {
              verb: canonical,
              action,
              dobjIds: [ROOMS_SENTINEL],
              iobjIds: undefined,
              prep: prep1 ?? prep2,
              preAction,
              syntax: matchedSyntax,
              raw: tokens,
            },
          };
        }

        if (gwimResult.kind === 'fail') {
          // C7: 0 or 2+ dobj candidates — emit orphan prompt.
          // gparser.zil:756-774: ORPHAN(DRIVE1, DRIVE2) → "What do you want to <verb> <prep>?"
          // Save state so ORPHAN-MERGE can fill the slot on the next turn.
          this.orphan = {
            verb: canonical,
            verbWord: rawVerb,
            prep1,
            prep2,
            slot: 'dobj',
            syntax: d1,
          };
          const msg = buildOrphanPrompt(rawVerb, undefined /* no DRIVE2 thing */, d1.prep1);
          return { kind: 'orphan', message: msg };
        } else {
          // GWIM success — capture object and parenthetical text.
          // Return early with the GWIM-supplied dobj.
          gwimText = gwimResult.text;
          const prepOut2 = prep1 ?? prep2;
          let iobjIds2: ObjectId[] | undefined;

          if (iobjTokens.length > 0) {
            const iobjLocBits2 = matchedSyntax?.iobjLocBits ?? 0;
            const r = resolveNounPhrase(
              iobjTokens, snap, room, effectivePlayer, world,
              iobjLocBits2, undefined, isLit, this.itRef,
            );
            if (r.ok === 'pseudo') {
              return {
                kind: 'ok',
                command: {
                  verb: canonical,
                  action,
                  dobjIds: [gwimResult.id],
                  iobjIds: undefined,
                  prep: prepOut2,
                  preAction,
                  syntax: matchedSyntax,
                  gwimText,
                  raw: tokens,
                },
              };
            }
            if (!r.ok) return r.result;
            if (r.id !== (undefined as unknown as ObjectId)) {
              iobjIds2 = [r.id];
            }
          }

          // C6: Apply TAKE-CHECK before returning.
          {
            const c6d1ok = applyC6Checks(
              canonical, [gwimResult.id], iobjIds2,
              d1.dobjLocBits, d1.iobjLocBits ?? 0,
              effectivePlayer, world,
            );
            if ('kind' in c6d1ok) return c6d1ok;
            return {
              kind: 'ok',
              command: {
                verb: canonical,
                action,
                dobjIds: [gwimResult.id],
                iobjIds: iobjIds2,
                prep: prepOut2,
                preAction,
                syntax: matchedSyntax,
                gwimText,
                autoTaken: c6d1ok.autoTaken && c6d1ok.autoTaken.length > 0 ? c6d1ok.autoTaken : undefined,
                raw: tokens,
              },
            };
          }
        }

      } else if (syntaxResult.drive2 !== undefined) {
        // DRIVE2: player gave dobj but not iobj. Auto-supply iobj from drive2.iobjFindBit.
        const d2 = syntaxResult.drive2;
        action = d2.action;
        preAction = d2.preAction;
        matchedSyntax = d2;

        // Resolve the typed dobj first (normal path).
        let dobjIds2: ObjectId[] | undefined;
        if (dobjTokens.length > 0) {
          const dobjLocBits2 = d2.dobjLocBits ?? 0;
          const r = resolveNounPhrase(
            dobjTokens, snap, room, effectivePlayer, world,
            dobjLocBits2, undefined, isLit, this.itRef,
          );
          if (r.ok === 'pseudo') {
            return {
              kind: 'ok',
              command: {
                verb: canonical,
                action,
                dobjIds: undefined,
                iobjIds: undefined,
                prep: prep1 ?? prep2,
                preAction,
                syntax: matchedSyntax,
                raw: tokens,
              },
            };
          }
          if (!r.ok) return r.result;
          if (r.id !== (undefined as unknown as ObjectId)) {
            dobjIds2 = [r.id];
          }
        }

        // GWIM for iobj. drive2 iobj slot: prep2 is the prep, endOnPrep=false
        // (the player typed a dobj noun, so the prep wasn't a trailing-prep).
        // Exclude the dobj id from GWIM candidates — an object cannot be its own
        // indirect object (prevents "burn candles" from finding lit candles as iobj).
        const dobjExclude = dobjIds2 !== undefined
          ? new Set<string>(dobjIds2)
          : undefined;
        const gwimResult = gwim(
          d2.iobjFindBit,   // findBit name (e.g. "WEAPONBIT")
          d2.iobjLocBits,   // scope bits
          d2.prep2,         // prep (e.g. "WITH")
          false,            // endOnPrep: false because dobj was present
          snap,
          room,
          effectivePlayer,
          world,
          isLit,
          dobjExclude,      // exclude the dobj from iobj candidates
        );

        if (gwimResult.kind === 'rooms') {
          // RMUNGBIT in iobj slot (rare): use ROOMS_SENTINEL for iobjId.
          return {
            kind: 'ok',
            command: {
              verb: canonical,
              action,
              dobjIds: dobjIds2,
              iobjIds: [ROOMS_SENTINEL],
              prep: prep1 ?? prep2,
              preAction,
              syntax: matchedSyntax,
              raw: tokens,
            },
          };
        }

        if (gwimResult.kind === 'fail') {
          // C7: 0 or 2+ iobj candidates — emit orphan prompt.
          // gparser.zil:756-774: DRIVE2 case — player gave dobj, needs iobj.
          // Orphan prompt: "What do you want to <verb> the <dobj> <prep2>?"
          // Save dobj so ORPHAN-MERGE can re-include it in the merged command.
          this.orphan = {
            verb: canonical,
            verbWord: rawVerb,
            prep1,
            prep2,
            slot: 'iobj',
            syntax: d2,
            resolvedDobjIds: dobjIds2,
          };
          // Build the THING description for the orphan prompt.
          // If dobj was resolved to one object, use its desc for "the <thing>".
          const dobjDesc = dobjIds2?.[0] !== undefined
            ? world.get(dobjIds2[0])?.desc
            : undefined;
          const msg = buildOrphanPrompt(rawVerb, dobjDesc, d2.prep2);
          return { kind: 'orphan', message: msg };
        }

        // gwimResult.kind === 'ok' and not self-reference
        // C6: Apply TAKE-CHECK on dobjIds2 + iobjIds before returning.
        {
          const c6d2ok = applyC6Checks(
            canonical, dobjIds2, [gwimResult.id],
            d2.dobjLocBits, d2.iobjLocBits,
            effectivePlayer, world,
          );
          if ('kind' in c6d2ok) return c6d2ok;
          return {
            kind: 'ok',
            command: {
              verb: canonical,
              action,
              dobjIds: dobjIds2,
              iobjIds: [gwimResult.id],
              prep: d2.prep2 ?? prep1 ?? prep2,
              preAction,
              syntax: matchedSyntax,
              gwimText: gwimResult.text,
              autoTaken: c6d2ok.autoTaken && c6d2ok.autoTaken.length > 0 ? c6d2ok.autoTaken : undefined,
              raw: tokens,
            },
          };
        }

      } else {
        // Neither drive1 nor drive2 set — should not reach here (syntaxCheck
        // returns kind:'fail' when both are undefined). Defensive fallback.
        return { kind: 'fail', message: "That sentence isn't one I recognize." };
      }
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
    //
    // C8-FIX (ANDFLG): use resolveNounPhraseList to handle "and"-connected
    // object lists (e.g. "take sword and lantern" → dobjIds [SWORD, LAMP]).
    // When no "and" is present, resolveNounPhraseList delegates to the standard
    // resolveNounPhrase, so behaviour is identical to the pre-fix code.
    if (dobjTokens.length > 0) {
      const listResult = resolveNounPhraseList(
        dobjTokens, snap, room, effectivePlayer, world,
        dobjLocBits, isLit, this.itRef,
      );
      if (listResult.kind === 'fail') {
        const r = listResult.result;
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
        // C7: If disambig, save orphan+disambig state so ORPHAN-MERGE can handle it.
        if (r.ok === false && r.result.kind === 'disambig' && matchedSyntax !== undefined) {
          const dobjNoun = dobjTokens[dobjTokens.length - 1] ?? '';
          const candidateIds = _extractDisambigCandidates(dobjNoun, snap, room, effectivePlayer, world, dobjLocBits, isLit);
          this.orphan = {
            verb: canonical,
            verbWord: rawVerb,
            prep1,
            prep2,
            slot: 'dobj',
            syntax: matchedSyntax,
            disambig: { noun: dobjNoun, candidates: candidateIds },
          };
        }
        if (r.ok === false) return r.result;
      } else {
        // listResult.kind === 'ids'
        if (listResult.ids.length > 0) {
          dobjIds = listResult.ids;
        }
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
      if (!r.ok) {
        // C7: If disambig on iobj, save orphan+disambig state.
        if (r.result.kind === 'disambig' && matchedSyntax !== undefined) {
          const iobjNoun = iobjTokens[iobjTokens.length - 1] ?? '';
          const candidateIds = _extractDisambigCandidates(iobjNoun, snap, room, effectivePlayer, world, iobjLocBits, isLit);
          this.orphan = {
            verb: canonical,
            verbWord: rawVerb,
            prep1,
            prep2,
            slot: 'iobj',
            syntax: matchedSyntax,
            resolvedDobjIds: dobjIds,
            disambig: { noun: iobjNoun, candidates: candidateIds },
          };
        }
        return r.result;
      }
      if (r.id !== (undefined as unknown as ObjectId)) {
        iobjIds = [r.id];
      }
    }

    // ---- C6: MANY-CHECK + TAKE-CHECK -----------------------------------------
    {
      const dobjLocBitsForCheck = matchedSyntax?.dobjLocBits ?? 0;
      const iobjLocBitsForCheck = matchedSyntax?.iobjLocBits ?? 0;
      const c6 = applyC6Checks(
        canonical, dobjIds, iobjIds,
        dobjLocBitsForCheck, iobjLocBitsForCheck,
        effectivePlayer, world,
      );
      if ('kind' in c6) return c6;  // MANY-CHECK or SHAVE fail

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
          gwimText,
          autoTaken: c6.autoTaken && c6.autoTaken.length > 0 ? c6.autoTaken : undefined,
          raw: tokens,
        },
      };
    }
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

      // C8-FIX (ANDFLG expansion): when the parser resolved multiple dobjIds
      // from an AND-connected noun list (e.g. "take sword and lantern"), expand
      // into one ParseResult per object — matching ZIL's PERFORM iteration over
      // the AND-list (gmain.zil:121-144).  Each entry is a copy of the base
      // command with a single dobjId AND allIter:true so game.turn() prints
      // "<desc>: " before each action result — same as tryExpandAll (C6/take all).
      // Same terminal behaviour as tryExpandAll: break after expansion.
      if (result.kind === 'ok' && result.command.dobjIds !== undefined && result.command.dobjIds.length > 1) {
        for (const id of result.command.dobjIds) {
          results.push({
            kind: 'ok',
            command: { ...result.command, dobjIds: [id], allIter: true },
          });
        }
        this.lastWon = true;
        break; // AND-list is a terminal segment — don't chain further.
      }

      results.push(result);

      // C8-FIX (A1): update lastWon immediately after each segment parse so
      // AGAIN in a later segment reads the LIVE parse-success state, not the
      // stale value from the previous turn.  This matches ZIL semantics where
      // P-WON = PARSER() return value per call (gmain.zil:42).
      // game.turn() still calls setLastWon() for execution-level outcomes
      // (M-FATAL / non-fatal success) — those calls run after parseChained()
      // returns and correctly set lastWon for the NEXT turn's AGAIN guard.
      this.lastWon = result.kind === 'ok';

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
   * C6: Try to interpret a token array as an "all" or "all except <noun>" form
   * for any SMANY-enabled verb.  Returns an array of ParseResults (one per
   * matching object) when the pattern is recognised.  Returns a single-element
   * array with a MANY-CHECK fail when 'all' is present but the verb lacks SMANY.
   * Returns null when the pattern is not applicable (no 'all' keyword).
   *
   * Recognised forms:
   *   <verb> all
   *   <verb> all except <noun>
   *   <verb> all but <noun>
   *
   * SNARFEM (gparser.zil:978-1030) + MANY-CHECK (gparser.zil:1294-1313).
   *
   * The ZIL semantics for ALL:
   *   - ALL forces P-SLOCBITS=-1 (all scopes) in GET-OBJECT.
   *   - Objects in scope with TAKEBIT set (for TAKE) or all in scope (for DROP)
   *     are collected.
   *   - BUT/EXCEPT subtracts from the collected set.
   *   - If the matched syntax lacks SMANY, MANY-CHECK fires immediately.
   *
   * Port simplification:
   *   - For TAKE: collect all Flag.Takeable objects in scope.
   *   - For DROP: collect all Flag.Takeable objects in player inventory.
   *   - For other SMANY verbs: collect all objects in scope.
   *   - BUT/EXCEPT: subtract the named object from the set.
   *
   * Returns null if there is no 'all' keyword in the tokens.
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

    // Must contain the word "all".
    const allIdx = tokens.indexOf('all');
    if (allIdx === -1) return null;

    // Look up the 1-obj syntax form for this verb to get action/preAction/syntax/locBits.
    const syntaxResult1 = syntaxCheck(canonical.toUpperCase(), 1);
    // Also check for ncn=0 (some verbs only have 0-obj forms)
    const verbUpper = canonical.toUpperCase();

    let expandAction: string;
    let expandPreAction: string | undefined;
    let expandSyntax: import('./types.js').SyntaxEntry | undefined;
    let dobjLocBits: number;

    if (syntaxResult1.kind === 'matched') {
      expandAction = syntaxResult1.entry.action;
      expandPreAction = syntaxResult1.entry.preAction;
      expandSyntax = syntaxResult1.entry;
      dobjLocBits = syntaxResult1.entry.dobjLocBits;
    } else if (syntaxResult1.kind === 'needGwim') {
      // Use drive1/drive2 as fallback
      const drive = syntaxResult1.drive1 ?? syntaxResult1.drive2;
      expandAction = drive?.action ?? ('V-' + verbUpper);
      expandPreAction = drive?.preAction;
      expandSyntax = drive;
      dobjLocBits = drive?.dobjLocBits ?? 0;
    } else {
      // No syntax found — unknown verb or verb without 1-obj form
      expandAction = 'V-' + verbUpper;
      expandPreAction = undefined;
      expandSyntax = undefined;
      dobjLocBits = 0;
    }

    // C6 MANY-CHECK: if the verb lacks SMANY, "all" → MANY-CHECK error immediately.
    // (gparser.zil:1294-1313: if P-PRSO.length > 1 and no SMANY → fail)
    if (!(dobjLocBits & SMANY)) {
      return [{
        kind: 'fail',
        message: `You can't use multiple direct objects with "${canonical}".`,
      }];
    }

    // Build the authoritative scope snapshot (C4 scope.ts, 4-tier model) when
    // player is available.  Fall back to the old collectScope only for legacy
    // null-player test paths (no real gameplay reaches here with player=null
    // because parseChained checks player before calling tryExpandAll, but keep
    // the guard for safety).
    const snap = player !== null ? buildScope(room, player, world) : undefined;

    // ---------------------------------------------------------------------------
    // ZIL ALL-scope search for candidate collection (gparser.zil:1240-1296).
    //
    // When ALL is typed with a verb that has P-SLOCBITS != 0 (e.g. TAKE with
    // SOG|SIR|SMANY = 52), ZIL does NOT override to -1.  Instead:
    //   1. Search room tier iff SOG or SIR bits are set.
    //   2. Search inventory tier iff SH or SC bits are set.
    //   3. If total found is 0: fall through to GLOBAL-CHECK.
    //   4. GLOBAL-CHECK first arm: search LOCAL-GLOBALS (room P?GLOBAL list).
    //   5. If still 0: GLOBAL-CHECK second arm: search GLOBAL-OBJECTS.
    // The player (ADVENTURER) is always excluded — ZIL clears PLAYER TRANSBIT
    // before DO-SL HERE to prevent the player from appearing in results.
    //
    // For EXAMINE (dobjLocBits=4=SMANY only, no SOG/SIR/SH/SC):
    //   Room and inventory searches find nothing (no matching scope bits).
    //   GLOBAL-CHECK fires → LOCAL-GLOBALS (e.g. STAIRS) are found.
    //   With ALL: collect them all.
    //
    // For TAKE (dobjLocBits=52=SOG|SIR|SMANY):
    //   Room search finds room objects (SOG bit set); inventory search finds none
    //   (no SH/SC bit). Room results > 0 → GLOBAL-CHECK does not fire.
    //   Stage-1 collection uses SRCTOP container descent (descend only into
    //   Searchable/Surface children), so objects inside plain open/transparent
    //   containers (e.g. water inside the bottle) are excluded (A2 fix).
    //   Stage-2 gate: include objects with Takeable OR TryTake (not just
    //   Takeable), so rug/trophy-case are reported with their refusal lines (A1).
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // A2: collectRoomTierSRCTOP — Stage-1 ALL collection with SRCTOP descent.
    //
    // ZIL room-level SEARCH-LIST for ALL uses P-SRCTOP (gparser.zil:1223-1228):
    // descend into a child container only if it has SEARCHBIT or SURFACEBIT.
    // Plain open/transparent containers (bottle, mailbox) are NOT descended.
    //
    // A4: Iterate in canonical ZIL FIRST?/NEXT? order = reverse of JS Set
    // insertion order (most recently inserted child appears first in FIRST?).
    //
    // Returns ids in canonical order; excludes the player.
    // ---------------------------------------------------------------------------
    function collectRoomTierSRCTOP(): GameObject[] {
      // A2: Stage-1 ALL collection with SRCTOP container descent.
      // ZIL room-level SEARCH-LIST for ALL uses P-SRCTOP (gparser.zil:1223-1228):
      // descend into a child container only if it has SEARCHBIT or SURFACEBIT.
      // Plain open/transparent containers (bottle, mailbox) are NOT descended.
      //
      // A4: Walk room.children in reverse insertion order (ZIL FIRST?/NEXT? order).
      // JS Set preserves insertion order; FIRST? returns the most-recently-added
      // child first, so canonical ZIL order = reverse of JS insertion order.
      const result: GameObject[] = [];
      const seenIds = new Set<string>();

      function walkSRCTOP(root: GameObject, level: number): void {
        // Iterate in reverse insertion order at ALL levels — ZIL FIRST?/NEXT?
        // returns the most-recently-added child first at every container level.
        // JS Set insertion order is oldest-first, so reversing gives ZIL order.
        const childArray = [...root.children].reverse();
        for (const child of childArray) {
          if (player !== null && child === player) continue;
          // Collect this child if it has synonyms (the "any-noun" thisItQ path).
          // Objects with no synonyms (pure containers, rooms) are not collected.
          if (child.synonyms.length > 0 && !seenIds.has(child.id)) {
            seenIds.add(child.id);
            result.push(child);
          }
          // Recurse: at SRCTOP only into Searchable/Surface containers.
          // (gparser.zil:1223-1228)
          const canDescend =
            (level !== SRCTOP || child.has(Flag.Searchable) || child.has(Flag.Surface)) &&
            child.children.size > 0 &&
            (child.has(Flag.Open) || child.has(Flag.Transparent));
          if (canDescend) {
            const childLevel = child.has(Flag.Surface) || child.has(Flag.Searchable)
              ? 1 // SRCALL — surface/searchable containers use full descent
              : SRCTOP;
            walkSRCTOP(child, childLevel);
          }
        }
      }

      walkSRCTOP(room, SRCTOP);

      // A2 post-collection filter: exclude objects whose parent container has
      // neither Searchable nor Surface (equivalently: objects inside plain
      // open/transparent containers should not be in the ALL set).
      //
      // ZIL SRCTOP only descends into SEARCHBIT/SURFACEBIT containers. In our
      // data, BOTTLE is mapped to Transparent (not Searchable), so walkSRCTOP
      // at SRCALL inside a Surface container (KITCHEN-TABLE) incorrectly
      // descends into BOTTLE and collects WATER. The filter corrects this:
      // WATER's parent is BOTTLE (no Searchable, no Surface) → excluded.
      // Objects whose parent IS Searchable/Surface (e.g. items on the kitchen
      // table itself, items in the trophy case) are kept.
      // Objects whose parent is a Room or the player are also kept (top-level).
      return result.filter(obj => {
        const par = obj.parent;
        if (par === null || par === undefined) return true;  // parentless: keep
        if (par === room || par === player) return true;    // top-level room child: keep
        // Parent is some container/object: keep only if Searchable or Surface.
        return par.has(Flag.Searchable) || par.has(Flag.Surface);
      });
    }

    function collectByLocBits(bits: number): GameObject[] {
      if (snap === undefined) {
        // Fallback: old collectScope (null-player test path only)
        const scope = collectScope(room, null, world);
        return scope.filter(o => o !== player && !o.has(Flag.Invisible));
      }
      const seen = new Set<string>();
      const result: GameObject[] = [];
      const add = (o: GameObject) => {
        if (seen.has(o.id) || o === player) return;
        seen.add(o.id);
        result.push(o);
      };

      // Tier 1: room contents (SOG or SIR bit set)
      // A2+A4: use SRCTOP walk in canonical order for room tier (not snap.roomTier
      // which uses SRCALL and insertion order).
      if (bits & SOG || bits & SIR) {
        for (const o of collectRoomTierSRCTOP()) add(o);
      }
      // Tier 2: inventory (SH or SC bit set)
      if (bits & SH || bits & SC) {
        for (const c of snap.invTier) add(c.obj);
      }

      // If nothing found locally: fall through to GLOBAL-CHECK
      if (result.length === 0) {
        // GLOBAL-CHECK arm 1: LOCAL-GLOBALS (room P?GLOBAL list)
        for (const o of snap.localGlobals) add(o);
        // GLOBAL-CHECK arm 2: GLOBAL-OBJECTS (universal, only if arm 1 also empty)
        if (result.length === 0) {
          for (const o of snap.globalObjects) add(o);
        }
      }

      return result;
    }

    // Helper: search all tiers for BUT/EXCEPT noun resolution (uses all tiers
    // regardless of locBits, since the player might specify any visible object).
    function allScopeForExcept(): GameObject[] {
      if (snap === undefined) return collectScope(room, null, world);
      const seen = new Set<string>();
      const result: GameObject[] = [];
      const add = (o: GameObject) => {
        if (seen.has(o.id) || o === player) return;
        seen.add(o.id);
        result.push(o);
      };
      for (const c of snap.roomTier) add(c.obj);
      for (const c of snap.invTier) add(c.obj);
      for (const o of snap.localGlobals) add(o);
      for (const o of snap.globalObjects) add(o);
      return result;
    }

    // Determine excluded object id (for "all except/but <noun>").
    let excludeId: ObjectId | undefined;
    const exceptIdx = Math.max(tokens.indexOf('except', allIdx), tokens.indexOf('but', allIdx));
    if (exceptIdx !== -1 && exceptIdx > allIdx) {
      const exceptTokens = tokens.slice(exceptIdx + 1);
      if (exceptTokens.length > 0) {
        const allObjects = allScopeForExcept();
        const phrase = splitNounPhrase(exceptTokens);
        if (phrase !== null) {
          const matchesEx = matchNoun(phrase.noun, phrase.adjectives, allObjects);
          if (matchesEx.length === 1) excludeId = matchesEx[0]!.id;
          // If ambiguous or not found, we simply don't exclude anything.
        }
      }
    }

    // Collect candidates using the proper ZIL-faithful scope search.
    let candidates: GameObject[];
    if (canonical === 'drop') {
      // DROP ALL: inventory-only, Takeable objects.
      // dobjLocBits for DROP = SH|SMANY|SHAVE = 134: SH bit is set → inventory tier.
      // Restrict to inventory objects (objects held by player).
      if (snap !== undefined) {
        const seen = new Set<string>();
        candidates = [];
        for (const c of snap.invTier) {
          if (!seen.has(c.obj.id) && c.obj !== player && c.obj.has(Flag.Takeable)) {
            seen.add(c.obj.id);
            candidates.push(c.obj);
          }
        }
      } else {
        const scope = collectScope(room, null, world);
        candidates = scope.filter(o =>
          o.has(Flag.Takeable) && (o.parent === null || o.parent === player),
        );
      }
    } else {
      // All other SMANY verbs (TAKE, EXAMINE, etc.): use locBits-faithful search.
      const pool = collectByLocBits(dobjLocBits).filter(o => !o.has(Flag.Invisible));
      // A1: For TAKE, gate by Takeable OR TryTake (gmain.zil:137-138).
      // ZIL MAIN-LOOP-1 silently skips objects with NEITHER TAKEBIT NOR TRYTAKEBIT;
      // objects with only TRYTAKEBIT (rug, trophy case) are reported with their
      // refusal lines (their ACTION handler returns the message then RTRUE).
      // The old filter (Takeable only) dropped TRYTAKEBIT-only objects — fixed here.
      candidates = canonical === 'take'
        ? pool.filter(o => o.has(Flag.Takeable) || o.has(Flag.TryTake))
        : pool;
    }

    const matches = candidates.filter(o => o.id !== excludeId);

    if (matches.length === 0) return [];

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
        allIter: true as const,
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

  // ---- C8: AGAIN/G handler ---------------------------------------------------

  /**
   * Handle the AGAIN/G keyword at the start of input.
   *
   * gparser.zil:192-233:
   *   1. No lastInput (OOPS-INBUF empty) → "Beg pardon?" → fail.
   *   2. Orphan state pending → "It's difficult to repeat fragments." → fail.
   *   3. !lastWon (P-WON false) → "That would just repeat a mistake." → fail.
   *   4. Trailing tokens after AGAIN that are NOT period/comma/THEN/AND:
   *        → "I couldn't understand that sentence." → fail.
   *      (Port simplification: period/comma/THEN/AND are separators; strip them
   *       and replay anyway — the RESERVE-LEXV tail-stashing for "AGAIN then X"
   *       is deferred per the spec §1 deferred table.)
   *   5. Otherwise: re-parse lastInput from the top (recursive parse call).
   *
   * AGAIN does NOT update lastInput (so back-to-back AGAIN/G replays the same
   * original command, not "AGAIN" itself).
   *
   * @param tokens  Lowercased token array for this input (first token is "again" or "g").
   */
  private _handleAgain(
    tokens: string[],
    _rawInput: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult {
    // Guard 1: no saved input (P-INBUF empty equivalent).
    // gparser.zil:193-195: <ZERO? <GETB ,OOPS-INBUF 1>> → "Beg pardon?"
    if (this.lastInput === undefined) {
      return { kind: 'fail', message: 'Beg pardon?' };
    }

    // Guard 2: orphan pending.
    // gparser.zil:196-198: ,P-OFLAG → "It's difficult to repeat fragments."
    if (this.orphan !== undefined) {
      return { kind: 'fail', message: "It's difficult to repeat fragments." };
    }

    // Guard 3: last command failed (P-WON false).
    // gparser.zil:199-201: <NOT ,P-WON> → "That would just repeat a mistake."
    if (!this.lastWon) {
      return { kind: 'fail', message: 'That would just repeat a mistake.' };
    }

    // Guard 4: trailing tokens after AGAIN.
    // gparser.zil:202-218: if P-LEN > 1 and next token is NOT period/comma/THEN/AND
    //   → "I couldn't understand that sentence."
    // Port: tokens after "again"/"g" (index 1+) that aren't structural separators.
    // The tokenizeSegment adapter already stripped articles and split at first SIBREAK,
    // so periods/commas won't appear as separate tokens in the `tokens` array here.
    //
    // When called via parseChained, "again and north" is already split by splitSegments
    // into ["again"] + ["north"] — so _handleAgain only ever sees ["again"] in that path.
    // "again then north" likewise arrives as ["again"] because splitSegments splits on "then".
    // "again and" (separator-only) arrives as ["again", "and"] only via parse() directly.
    //
    // If ANY non-separator token appears after AGAIN → error (e.g. "again lamp").
    // (Separators: ".", ",", "then", "and" — structural tokens in ZIL.)
    const separators = new Set<string>(['.', ',', 'then', 'and']);
    const trailing = tokens.slice(1);
    const hasNonSeparator = trailing.some(t => !separators.has(t));
    if (hasNonSeparator) {
      return { kind: 'fail', message: "I couldn't understand that sentence." };
    }

    // Replay: re-parse the saved lastInput from the top.
    // Do NOT update lastInput (AGAIN replays the PREVIOUS command, not itself).
    return this.parse(this.lastInput, room, player, world);
  }

  /**
   * C7: ORPHAN-MERGE — handle next-turn input when orphan state is set.
   *
   * gparser.zil:543-630 (ORPHAN-MERGE).
   *
   * Three cases for the answer input (tokens):
   *   A) Disambiguation pending (orphan.disambig set):
   *      The answer should be an adjective or noun that selects one candidate.
   *      If a matching candidate is found → clear orphan, build ok command.
   *      If no match → treat as fresh command (discard orphan).
   *   B) Missing-object answer (no disambig):
   *      The answer's first token may be:
   *        - A verb → abandon orphan, re-parse as a fresh command.
   *        - A noun/adjective → graft into the missing slot, re-process.
   *   C) Non-fitting answer → abandon orphan, re-parse from scratch.
   *
   * ZIL also checks prep compatibility; the port does a simplified version.
   */
  private _orphanMerge(
    tokens: string[],
    room: Room,
    player: GameObject,
    world: World,
    snap: import('./scope.js').ScopeSnapshot,
    isLit: boolean,
  ): ParseResult {
    const orphan = this.orphan!; // caller guarantees this is set

    // ---- Case A: Disambiguation answer ----------------------------------------
    if (orphan.disambig !== undefined) {
      return this._handleDisambigAnswer(tokens, orphan, room, player, world, snap, isLit);
    }

    // ---- Case B/C: Missing-object answer (orphan with no disambig) -------------
    return this._handleOrphanAnswer(tokens, orphan, room, player, world, snap, isLit);
  }

  /**
   * Handle a disambiguation answer: select one of the ambiguous candidates.
   *
   * The answer may be:
   *   - A bare adjective ("rusty") → filter candidates by adjective
   *   - A full noun phrase ("rusty sword") → narrow by both noun and adjective
   *   - A fresh verb → abandon, re-parse
   */
  private _handleDisambigAnswer(
    tokens: string[],
    orphan: OrphanState,
    room: Room,
    player: GameObject,
    world: World,
    _snap: import('./scope.js').ScopeSnapshot,
    _isLit: boolean,
  ): ParseResult {
    const { noun: orphanNoun, candidates } = orphan.disambig!;

    // Try to narrow candidates using the answer tokens.
    // Answer might be just an adjective, or "adj noun", or just a noun.
    // We try matching the answer tokens against the candidate set.
    const answerTokens = tokens;
    const answerNoun = answerTokens[answerTokens.length - 1] ?? '';
    const answerAdjs = answerTokens.slice(0, -1);

    // Check if the first token is a verb — if so, abandon and re-parse.
    if (answerTokens.length > 0 && lookupVerb(answerTokens[0]!) !== undefined) {
      this.orphan = undefined;
      return this.parse(tokens.join(' '), room, player, world);
    }

    // Try to select a candidate from the disambig set.
    const matched = candidates
      .map(id => world.get(id))
      .filter((obj): obj is import('../../domain/game-object.js').GameObject => obj !== undefined)
      .filter(obj => {
        // If the answer has a noun token, check it against synonyms.
        const nounLc = answerNoun.toLowerCase();
        const nounsMatch =
          nounLc === orphanNoun.toLowerCase() ||
          obj.synonyms.some(s => s.toLowerCase() === nounLc) ||
          obj.adjectives.some(a => a.toLowerCase() === nounLc);
        if (!nounsMatch) return false;
        // If the answer has adjective tokens, all must match.
        if (answerAdjs.length > 0) {
          return answerAdjs.every(adj => {
            const adjLc = adj.toLowerCase();
            return (
              obj.adjectives.some(a => a.toLowerCase() === adjLc) ||
              obj.synonyms.some(s => s.toLowerCase() === adjLc)
            );
          });
        }
        return true;
      });

    if (matched.length === 1) {
      // Successfully disambiguated.
      this.orphan = undefined;
      const syntax = orphan.syntax;
      const resolvedId = matched[0]!.id;

      if (orphan.slot === 'dobj') {
        const dobjIds: ObjectId[] = [resolvedId];
        // Apply C6 checks and return ok.
        const c6 = applyC6Checks(orphan.verb, dobjIds, undefined, syntax.dobjLocBits, syntax.iobjLocBits, player, world);
        if ('kind' in c6) return c6;
        return {
          kind: 'ok',
          command: {
            verb: orphan.verb,
            action: syntax.action,
            dobjIds,
            iobjIds: undefined,
            prep: orphan.prep1 ?? orphan.prep2,
            preAction: syntax.preAction,
            syntax,
            autoTaken: c6.autoTaken && c6.autoTaken.length > 0 ? c6.autoTaken : undefined,
            raw: tokens,
          },
        };
      } else {
        // iobj slot
        const iobjIds: ObjectId[] = [resolvedId];
        const dobjIds = orphan.resolvedDobjIds;
        const c6 = applyC6Checks(orphan.verb, dobjIds, iobjIds, syntax.dobjLocBits, syntax.iobjLocBits, player, world);
        if ('kind' in c6) return c6;
        return {
          kind: 'ok',
          command: {
            verb: orphan.verb,
            action: syntax.action,
            dobjIds,
            iobjIds,
            prep: orphan.prep2 ?? orphan.prep1,
            preAction: syntax.preAction,
            syntax,
            autoTaken: c6.autoTaken && c6.autoTaken.length > 0 ? c6.autoTaken : undefined,
            raw: tokens,
          },
        };
      }
    }

    // No match or still ambiguous — abandon orphan, treat as fresh command.
    this.orphan = undefined;
    return this.parse(tokens.join(' '), room, player, world);
  }

  /**
   * Handle an orphan answer (missing-object case, no disambig).
   *
   * The answer might be:
   *   - A fresh verb → abandon orphan, re-parse
   *   - A noun phrase → graft into the missing slot, execute
   */
  private _handleOrphanAnswer(
    tokens: string[],
    orphan: OrphanState,
    room: Room,
    player: GameObject,
    world: World,
    snap: import('./scope.js').ScopeSnapshot,
    isLit: boolean,
  ): ParseResult {
    const firstToken = tokens[0] ?? '';

    // If first token is a verb, abandon orphan and re-parse as a fresh command.
    if (lookupVerb(firstToken) !== undefined) {
      this.orphan = undefined;
      return this.parse(tokens.join(' '), room, player, world);
    }

    // The answer is a noun phrase. Graft it into the missing slot.
    const syntax = orphan.syntax;

    if (orphan.slot === 'dobj') {
      const dobjLocBits = syntax.dobjLocBits;
      const r = resolveNounPhrase(
        tokens, snap, room, player, world,
        dobjLocBits, undefined, isLit, this.itRef,
      );

      if (r.ok === 'pseudo') {
        this.orphan = undefined;
        return {
          kind: 'ok',
          command: {
            verb: orphan.verb,
            action: r.action,
            dobjIds: undefined,
            iobjIds: undefined,
            prep: orphan.prep1 ?? orphan.prep2,
            preAction: undefined,
            syntax,
            raw: tokens,
          },
        };
      }

      if (!r.ok) {
        // Re-resolve failed — check if disambig; if so, save new disambig state.
        if (r.result.kind === 'disambig') {
          const noun = tokens[tokens.length - 1] ?? '';
          const candidateIds = _extractDisambigCandidates(noun, snap, room, player, world, dobjLocBits, isLit);
          this.orphan = { ...orphan, disambig: { noun, candidates: candidateIds } };
        } else {
          this.orphan = undefined;
        }
        return r.result;
      }

      this.orphan = undefined;
      // r.ok === true here (pseudo handled above)
      const dobjIds: ObjectId[] = r.id !== (undefined as unknown as ObjectId) ? [r.id] : [];
      const c6 = applyC6Checks(orphan.verb, dobjIds.length > 0 ? dobjIds : undefined, undefined, syntax.dobjLocBits, syntax.iobjLocBits, player, world);
      if ('kind' in c6) return c6;
      return {
        kind: 'ok',
        command: {
          verb: orphan.verb,
          action: syntax.action,
          dobjIds: dobjIds.length > 0 ? dobjIds : undefined,
          iobjIds: undefined,
          prep: orphan.prep1 ?? orphan.prep2,
          preAction: syntax.preAction,
          syntax,
          autoTaken: c6.autoTaken && c6.autoTaken.length > 0 ? c6.autoTaken : undefined,
          raw: tokens,
        },
      };
    } else {
      // iobj slot: answer fills the iobj
      const iobjLocBits = syntax.iobjLocBits;
      const r = resolveNounPhrase(
        tokens, snap, room, player, world,
        iobjLocBits, undefined, isLit, this.itRef,
      );

      if (r.ok === 'pseudo') {
        this.orphan = undefined;
        return {
          kind: 'ok',
          command: {
            verb: orphan.verb,
            action: r.action,
            dobjIds: orphan.resolvedDobjIds,
            iobjIds: undefined,
            prep: orphan.prep2 ?? orphan.prep1,
            preAction: undefined,
            syntax,
            raw: tokens,
          },
        };
      }

      if (!r.ok) {
        if (r.result.kind === 'disambig') {
          const noun = tokens[tokens.length - 1] ?? '';
          const candidateIds = _extractDisambigCandidates(noun, snap, room, player, world, iobjLocBits, isLit);
          this.orphan = { ...orphan, disambig: { noun, candidates: candidateIds } };
        } else {
          this.orphan = undefined;
        }
        return r.result;
      }

      this.orphan = undefined;
      // r.ok === true here (pseudo handled above)
      const iobjIds: ObjectId[] = r.id !== (undefined as unknown as ObjectId) ? [r.id] : [];
      const dobjIds = orphan.resolvedDobjIds;
      const c6 = applyC6Checks(orphan.verb, dobjIds, iobjIds.length > 0 ? iobjIds : undefined, syntax.dobjLocBits, syntax.iobjLocBits, player, world);
      if ('kind' in c6) return c6;
      return {
        kind: 'ok',
        command: {
          verb: orphan.verb,
          action: syntax.action,
          dobjIds,
          iobjIds: iobjIds.length > 0 ? iobjIds : undefined,
          prep: orphan.prep2 ?? orphan.prep1,
          preAction: syntax.preAction,
          syntax,
          autoTaken: c6.autoTaken && c6.autoTaken.length > 0 ? c6.autoTaken : undefined,
          raw: tokens,
        },
      };
    }
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
