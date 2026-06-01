import type { ObjectId } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import type { GameObject } from '../../domain/game-object.js';
import type { ParseResult } from './types.js';
import { Flag } from '../../domain/flags.js';
import { tokenize, SIBREAK_CHARS } from './tokenizer.js';
import type { ScopeSnapshot } from './scope.js';
import { getObject } from './get-object.js';
import { accessible } from './accessible.js';
import { FINDBIT_TO_FLAG } from './find-bits.js';
import { SMANY, STAKE, SHAVE, SOG, SIR, SH, SC, SRCTOP } from './scope-bits.js';
import { isPreposition, normalizePrep } from './vocabulary.js';

export const ARTICLES = new Set(['a', 'an', 'the']);

// Wave-B adapter: split at first SIBREAK, drop articles.
// Not exported — private to the parser package.
export function tokenizeSegment(input: string): string[] {
  const toks = tokenize(input);
  const result: string[] = [];
  for (const tok of toks) {
    if (SIBREAK_CHARS.has(tok)) break;
    if (!ARTICLES.has(tok)) result.push(tok);
  }
  return result;
}

// Split an input string into segments on SIBREAK tokens (period/comma) and on
// the word "then". "and" is treated as a segment separator ONLY when the
// current segment begins with AGAIN/G — matching ZIL semantics where "and"
// after AGAIN (gparser.zil:202-206) is a continuation separator, but "and"
// inside a noun clause (e.g. "take sword and lantern") is an ANDFLG object-list
// connector handled by the noun scanner (gparser.zil:459-491), not by command
// splitting.
export function splitSegments(input: string): string[][] {
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
      const filtered = current.filter(t => !ARTICLES.has(t));
      if (filtered.length > 0) segments.push(filtered);
      current = [];
      currentStartsWithAgain = false;
    } else {
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

// Collect objects visible and reachable from a given room.
// The player argument is the actor; if null, inventory is the set of objects
// with no parent (only relevant for legacy tests).
export function collectScope(room: Room, player: GameObject | null, world: World): GameObject[] {
  const scope: GameObject[] = [];
  const seen = new Set<ObjectId>();

  function addTree(obj: GameObject, depth: number): void {
    if (seen.has(obj.id)) return;
    seen.add(obj.id);
    if (depth > 0) scope.push(obj);
    const openable = obj.has(Flag.Container) && (obj.has(Flag.Open) || obj.has(Flag.Transparent));
    const alwaysOpen = !obj.has(Flag.Container);
    if (depth === 0 || openable || alwaysOpen) {
      for (const child of obj.children) {
        addTree(child, depth + 1);
      }
    }
  }

  addTree(room, 0);

  // ZIL GLOBAL objects: the room's GLOBAL prop holds the id of an object always
  // accessible from this room regardless of containment.
  const globalId = room.props.get('GLOBAL');
  if (typeof globalId === 'string') {
    const globalObj = world.get(globalId);
    if (globalObj !== undefined && !seen.has(globalObj.id)) {
      seen.add(globalObj.id);
      scope.push(globalObj);
      for (const child of globalObj.children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          scope.push(child);
        }
      }
    }
  }

  // Exit gate objects: any object referenced by an exit's ifFlag is accessible.
  for (const exit of room.exits) {
    if (exit.ifFlag !== undefined) {
      const gateObj = world.get(exit.ifFlag);
      if (gateObj !== undefined && !seen.has(gateObj.id)) {
        seen.add(gateObj.id);
        scope.push(gateObj);
      }
    }
  }

  if (player !== null) {
    for (const item of player.children) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        scope.push(item);
      }
    }
  } else {
    for (const obj of world.all()) {
      if (obj.parent === null && !seen.has(obj.id)) {
        if (obj !== room) {
          seen.add(obj.id);
          scope.push(obj);
        }
      }
    }
  }

  return scope;
}

// Match a noun (and optional adjectives) against a scope list.
export function matchNoun(
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

// Split the tokens after the verb into prep1 / dobjTokens / prep2 / iobjTokens,
// reflecting the ZIL sentence grammar: VERB [prep1] DOBJ [prep2] IOBJ.
// Also computes ncn (noun-clause count: 0, 1, or 2) for syntaxCheck.
// gparser.zil:1294
export function splitOnPreps(rest: string[]): {
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

  if (isPreposition(remaining[0]!)) {
    prep1 = normalizePrep(remaining[0]!);
    remaining = remaining.slice(1);
  }

  let dobjTokens: string[] = [];
  let prep2: string | undefined;
  let iobjTokens: string[] = [];

  let splitAt = remaining.length;
  for (let i = 0; i < remaining.length; i++) {
    if (isPreposition(remaining[i]!)) {
      splitAt = i;
      prep2 = normalizePrep(remaining[i]!);
      iobjTokens = remaining.slice(i + 1);
      break;
    }
  }
  dobjTokens = remaining.slice(0, splitAt);

  const hasDobj = dobjTokens.length > 0;
  const hasIobj = iobjTokens.length > 0;
  const ncn: 0 | 1 | 2 = hasDobj && hasIobj ? 2 : hasDobj || hasIobj ? 1 : 0;

  return { ncn, prep1, prep2, dobjTokens, iobjTokens };
}

// Separate adjective tokens from the final noun token in a noun phrase.
// The last token is the noun; everything before it is treated as adjectives.
export function splitNounPhrase(tokens: string[]): { noun: string; adjectives: string[] } | null {
  if (tokens.length === 0) return null;
  const noun = tokens[tokens.length - 1]!;
  const adjectives = tokens.slice(0, -1);
  return { noun, adjectives };
}

// Legacy null-player noun resolver (used only when player=null is passed).
// Uses old matchNoun + collectScope logic without lighting checks.

export type LegacyResolveResult =
  | { ok: true; id: ObjectId }
  | { ok: false; result: ParseResult };

export function _legacyResolveNounPhrase(
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

// Build the WHICH-PRINT disambiguation message.
// ZIL WHICH-PRINT (gparser.zil:820-835) format:
//   "Which <noun> do you mean, the <desc1>, the <desc2>, or the <descN>?"
// With exactly two candidates the Oxford comma is omitted.
export function disambigMessage(noun: string, objs: GameObject[]): string {
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

// ZIL MANY-CHECK (gparser.zil:1294-1313):
//   If P-PRSO has > 1 entry AND P-SLOC1 lacks SMANY(4): fail.
//   Same for PRSI / P-SLOC2 / "indirect".
export function manyCheck(
  verb: string,
  dobjIds: ObjectId[] | undefined,
  iobjIds: ObjectId[] | undefined,
  dobjLocBits: number,
  iobjLocBits: number,
): { kind: 'fail'; message: string } | undefined {
  if (dobjIds !== undefined && dobjIds.length > 1 && !(dobjLocBits & SMANY)) {
    return {
      kind: 'fail',
      message: `You can't use multiple direct objects with "${verb}".`,
    };
  }
  if (iobjIds !== undefined && iobjIds.length > 1 && !(iobjLocBits & SMANY)) {
    return {
      kind: 'fail',
      message: `You can't use multiple indirect objects with "${verb}".`,
    };
  }
  return undefined;
}

// Returns true if obj is held by player (direct child or in an open container
// in player's inventory). Implements ZIL HELD?.
export function isHeldByPlayer(obj: GameObject, player: GameObject): boolean {
  let current: GameObject | null = obj.parent as GameObject | null;
  while (current !== null) {
    if (current === player) return true;
    current = current.parent as GameObject | null;
  }
  return false;
}

// ZIL ITAKE-CHECK (gparser.zil:1248-1292): check STAKE (auto-take) and SHAVE
// (must-have) bits per resolved object.
export function takeCheck(
  dobjIds: ObjectId[],
  dobjLocBits: number,
  player: GameObject,
  world: World,
): { kind: 'fail'; message: string } | { autoTaken: ObjectId[] } | undefined {
  if (!(dobjLocBits & STAKE) && !(dobjLocBits & SHAVE)) {
    return undefined;
  }

  const autoTaken: ObjectId[] = [];

  for (const id of dobjIds) {
    const obj = world.get(id);
    if (obj === undefined) continue;

    const isHeld = isHeldByPlayer(obj, player);

    if (!isHeld) {
      let taken = true;

      if (!obj.has(Flag.TryTake)) {
        if ((dobjLocBits & STAKE) && obj.has(Flag.Takeable)) {
          taken = false;
        }
      }

      if (!taken) {
        autoTaken.push(id);
      } else if (dobjLocBits & SHAVE) {
        // ZIL: "You don't have the <obj>." (gparser.zil:1285-1286)
        return {
          kind: 'fail',
          message: `You don't have the ${obj.desc}.`,
        };
      }
    }
  }

  if (autoTaken.length > 0) {
    return { autoTaken };
  }
  return undefined;
}

// Apply MANY-CHECK and TAKE-CHECK before returning an ok ParseResult.
// Called from every code path that resolves dobjIds/iobjIds and is about to
// return an ok command.
export function applyC6Checks(
  verb: string,
  dobjIds: ObjectId[] | undefined,
  iobjIds: ObjectId[] | undefined,
  dobjLocBits: number,
  iobjLocBits: number,
  player: GameObject,
  world: World,
): { kind: 'fail'; message: string } | { autoTaken?: ObjectId[] } {
  const manyFail = manyCheck(verb, dobjIds, iobjIds, dobjLocBits, iobjLocBits);
  if (manyFail !== undefined) return manyFail;

  let autoTaken: ObjectId[] | undefined;
  if (dobjIds !== undefined && dobjIds.length > 0) {
    const tcResult = takeCheck(dobjIds, dobjLocBits, player, world);
    if (tcResult !== undefined && 'kind' in tcResult) return tcResult;
    if (tcResult !== undefined && 'autoTaken' in tcResult && tcResult.autoTaken.length > 0) {
      autoTaken = (autoTaken ?? []).concat(tcResult.autoTaken);
    }
  }

  if (iobjIds !== undefined && iobjIds.length > 0) {
    const tcResult = takeCheck(iobjIds, iobjLocBits, player, world);
    if (tcResult !== undefined && 'kind' in tcResult) return tcResult;
    if (tcResult !== undefined && 'autoTaken' in tcResult && tcResult.autoTaken.length > 0) {
      autoTaken = (autoTaken ?? []).concat(tcResult.autoTaken);
    }
  }

  return { autoTaken };
}

export type ResolveResult =
  | { ok: true; id: ObjectId }
  | { ok: false; result: ParseResult }
  | { ok: 'pseudo'; action: string };

// Noun-phrase resolver using the getObject pipeline.
// gparser.zil:1294
export function resolveNounPhrase(
  tokens: string[],
  snap: ScopeSnapshot,
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
  // Validate referent via accessible() before accepting it.
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

  const findFlag = findBitName !== undefined ? FINDBIT_TO_FLAG[findBitName] : undefined;

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

export type NounListResult =
  | { kind: 'ids'; ids: ObjectId[] }
  | { kind: 'fail'; result: ResolveResult };

// Resolve a noun token list that may contain "and" as an object-list connector.
// gparser.zil:459-491 CLAUSE ANDFLG mechanism.
export function resolveNounPhraseList(
  tokens: string[],
  snap: ScopeSnapshot,
  here: Room,
  player: GameObject,
  world: World,
  locBits: number,
  isLit: boolean,
  itRef: ObjectId | undefined,
): NounListResult {
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

  if (groups.length === 1) {
    const r = resolveNounPhrase(tokens, snap, here, player, world, locBits, undefined, isLit, itRef);
    if (r.ok === false) return { kind: 'fail', result: r };
    if (r.ok === 'pseudo') return { kind: 'fail', result: r };
    const id = r.id as ObjectId;
    return { kind: 'ids', ids: id !== undefined ? [id] : [] };
  }

  // Track not-here failures across the group; emit a single batched message when
  // all members are absent (gmain.zil:98-109).
  const ids: ObjectId[] = [];
  let notHereCount = 0;
  let hardFail: ResolveResult | undefined;

  for (const group of groups) {
    const r = resolveNounPhrase(group, snap, here, player, world, locBits, undefined, isLit, itRef);
    if (r.ok === false) {
      if (r.result.kind === 'not-here') {
        notHereCount++;
        continue;
      }
      hardFail = r;
      break;
    }
    if (r.ok === 'pseudo') {
      hardFail = { ok: false, result: { kind: 'fail', message: "I don't understand that." } };
      break;
    }
    const id = r.id as ObjectId;
    if (id !== undefined) ids.push(id);
  }

  if (hardFail !== undefined) return { kind: 'fail', result: hardFail };

  if (notHereCount > 0 && ids.length === 0) {
    const msg = notHereCount === 1
      ? "The object that you mentioned isn't here."
      : "The objects that you mentioned aren't here.";
    return { kind: 'fail', result: { ok: false, result: { kind: 'fail', message: msg } } };
  }

  return { kind: 'ids', ids };
}

// Build the verbatim ZIL orphan prompt.
// gparser.zil:758-773:
//   "What do you want to " + verbWord + [" the " + thingDesc] + [" " + prep] + "?"
export function buildOrphanPrompt(
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

// Re-resolve a noun token against scope to collect the candidate ids for a
// disambig orphan. Used when resolveNounPhrase returns disambig so we can
// save the candidate list in OrphanState.
export function _extractDisambigCandidates(
  noun: string,
  snap: ScopeSnapshot,
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

// Promoted from tryExpandAll's nested closures (Phase 2).
// These take the captured values as explicit params instead of closing over them.

// ZIL room-level SEARCH-LIST for ALL uses P-SRCTOP (gparser.zil:1223-1228):
// descend into a child container only if it has SEARCHBIT or SURFACEBIT.
// Plain open/transparent containers (bottle, mailbox) are NOT descended.
//
// A4: Walk room.children in reverse insertion order (ZIL FIRST?/NEXT? order).
// JS Set preserves insertion order; FIRST? returns the most-recently-added
// child first, so canonical ZIL order = reverse of JS insertion order.
//
// walkSRCTOP stays nested here — its JS Set FIRST?/NEXT? reverse-insertion-order
// recursion is ALL-output-order-load-bearing; the snarfem-c6 test guards it.
export function collectRoomTierSRCTOP(room: Room, player: GameObject | null): GameObject[] {
  const result: GameObject[] = [];
  const seenIds = new Set<string>();

  function walkSRCTOP(root: GameObject, level: number): void {
    const childArray = [...root.children].reverse();
    for (const child of childArray) {
      if (player !== null && child === player) continue;
      if (child.synonyms.length > 0 && !seenIds.has(child.id)) {
        seenIds.add(child.id);
        result.push(child);
      }
      const canDescend =
        (level !== SRCTOP || child.has(Flag.Searchable) || child.has(Flag.Surface)) &&
        child.children.size > 0 &&
        (child.has(Flag.Open) || child.has(Flag.Transparent));
      if (canDescend) {
        const childLevel = child.has(Flag.Surface) || child.has(Flag.Searchable)
          ? 1
          : SRCTOP;
        walkSRCTOP(child, childLevel);
      }
    }
  }

  walkSRCTOP(room, SRCTOP);

  // A2 post-collection filter: exclude objects inside plain open/transparent
  // containers (not Searchable/Surface). E.g. water inside bottle is excluded;
  // items on kitchen table surface are kept.
  return result.filter(obj => {
    const par = obj.parent;
    if (par === null || par === undefined) return true;
    if (par === room || par === player) return true;
    return par.has(Flag.Searchable) || par.has(Flag.Surface);
  });
}

export function collectByLocBits(
  bits: number,
  room: Room,
  player: GameObject | null,
  snap: ScopeSnapshot | undefined,
  world: World,
): GameObject[] {
  if (snap === undefined) {
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

  if (bits & SOG || bits & SIR) {
    for (const o of collectRoomTierSRCTOP(room, player)) add(o);
  }
  if (bits & SH || bits & SC) {
    for (const c of snap.invTier) add(c.obj);
  }

  if (result.length === 0) {
    for (const o of snap.localGlobals) add(o);
    if (result.length === 0) {
      for (const o of snap.globalObjects) add(o);
    }
  }

  return result;
}

export function allScopeForExcept(
  room: Room,
  player: GameObject | null,
  snap: ScopeSnapshot | undefined,
  world: World,
): GameObject[] {
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
