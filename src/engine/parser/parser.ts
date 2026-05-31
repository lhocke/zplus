import type { ObjectId } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import type { GameObject } from '../../domain/game-object.js';
import type { ParsedCommand, ParseResult } from './types.js';
import { Flag } from '../../domain/flags.js';
import { syntaxCheck } from './syntax-check.js';
import { buildScope, lit as litCheck } from './scope.js';
import type { ScopeSnapshot } from './scope.js';
import { gwim, ROOMS_SENTINEL } from './gwim.js';
import { SMANY } from './scope-bits.js';
import {
  lookupVerb,
  DIRECTIONS,
  normalizeDir,
} from './vocabulary.js';
import {
  tokenizeSegment,
  splitSegments,
  collectScope,
  matchNoun,
  splitOnPreps,
  splitNounPhrase,
  _legacyResolveNounPhrase,
  applyC6Checks,
  resolveNounPhrase,
  resolveNounPhraseList,
  buildOrphanPrompt,
  _extractDisambigCandidates,
  collectByLocBits,
  allScopeForExcept,
} from './parser-helpers.js';

// OrphanSlot and OrphanState stay class-side (Phase 1 invariant #0).
// They are consumed by the class field (this.orphan) and all orphan methods,
// none of which move to parser-helpers.ts, so there's no cross-file type edge.

type OrphanSlot = 'dobj' | 'iobj';

interface OrphanState {
  verb: string;
  verbWord: string;
  prep1?: string;
  prep2?: string;
  slot: OrphanSlot;
  syntax: import('./types.js').SyntaxEntry;
  resolvedDobjIds?: ObjectId[];
  disambig?: {
    noun: string;
    candidates: ObjectId[];
  };
}

export class Parser {
  private itRef: ObjectId | undefined = undefined;

  // C7 orphan/disambig state. Set when the parser issued a "What do you want
  // to…?" or "Which…?" prompt. Cleared after a successful ORPHAN-MERGE or
  // when the answer is a fresh command (abandons orphan).
  // gparser.zil: P-OFLAG (boolean), P-OTBL (saved parse tables).
  private orphan: OrphanState | undefined = undefined;

  // C8: AGAIN/G state (gparser.zil:192-233)

  // The raw input string of the last non-AGAIN command that was parsed.
  // Replays on AGAIN/G. Port equivalent of AGAIN-LEXV (gparser.zil:36).
  private lastInput: string | undefined = undefined;

  // Whether the last parse+execute succeeded (P-WON in gmain.zil).
  // Set by the game harness via setLastWon() after each turn.
  private lastWon: boolean = false;

  // C9: Continuation token segments (P-CONT equivalent).
  // When the scan loop hits a THEN/period separator, the remaining input is
  // stored here as pre-split segments. Game.turn's interleaved loop calls
  // parseSegment() which consumes segments from this queue.
  private continuation: string[][] | undefined = undefined;

  // C9: Pre-parsed result queue for ALL/AND expansion.
  // When tryExpandAll() or ANDFLG returns multiple ParseResults, the extras
  // are queued here so Game.turn() can process them one at a time.
  private parsedQueue: ParseResult[] | undefined = undefined;

  setLastWon(won: boolean): void {
    this.lastWon = won;
  }

  // C9: True when there are pending continuation segments or pre-parsed results
  // queued. Game.turn() loops while this is true without reading new user input.
  // gparser.zil: P-CONT (the continuation token buffer).
  hasContinuation(): boolean {
    return (
      (this.continuation !== undefined && this.continuation.length > 0) ||
      (this.parsedQueue !== undefined && this.parsedQueue.length > 0)
    );
  }

  // C9: True when the parser is awaiting input to answer an orphan/disambig
  // prompt. gparser.zil: P-OFLAG (whether an orphan is pending).
  isAwaitingInput(): boolean {
    return this.orphan !== undefined;
  }

  // C9: Clear the continuation queue and parsed queue (P-CONT clear on M-FATAL).
  // Called by Game.turn() when M-FATAL fires, per gmain.zil:161.
  clearContinuation(): void {
    this.continuation = undefined;
    this.parsedQueue = undefined;
  }

  // C9: The interleaved-drive entry point for Game.turn().
  //
  // Implements input acquisition (gparser.zil:131-153) from Game.turn's
  // perspective:
  //   0. If pre-parsed queue non-empty (from ALL/AND expansion) → dequeue the
  //      next pre-parsed result and return it directly.
  //   1. If continuation queue non-empty → pop the front segment, dispatch
  //      through the full parse path for that segment (do NOT read rawLine).
  //   2. Else if orphan pending → tokenize rawLine as the answer, run ORPHAN-MERGE.
  //   3. Else → tokenize rawLine, detect THEN/period, queue remainder as
  //      continuation, dispatch the first segment through the full parse path.
  parseSegment(
    rawLine: string,
    room: Room,
    player: GameObject,
    world: World,
  ): ParseResult {
    if (this.parsedQueue !== undefined && this.parsedQueue.length > 0) {
      const next = this.parsedQueue.shift()!;
      if (this.parsedQueue.length === 0) {
        this.parsedQueue = undefined;
      }
      return next;
    }

    let tokens: string[];

    if (this.continuation !== undefined && this.continuation.length > 0) {
      tokens = this.continuation.shift()!;
      if (this.continuation.length === 0) {
        this.continuation = undefined;
      }

    } else if (this.orphan !== undefined) {
      // orphan pending — rawLine is the answer
      return this.parse(rawLine, room, player, world);

    } else {
      const allSegments = splitSegments(rawLine);
      if (allSegments.length === 0) {
        return { kind: 'fail', message: 'I beg your pardon?' };
      }
      if (allSegments.length > 1) {
        this.continuation = allSegments.slice(1);
      }
      tokens = allSegments[0]!;
    }

    const expanded = this.tryExpandAll(tokens, room, player, world);
    if (expanded !== null) {
      if (expanded.length === 0) {
        return { kind: 'fail', message: "There's nothing here to take." };
      }
      if (expanded.length > 1) {
        this.parsedQueue = expanded.slice(1);
      }
      return expanded[0]!;
    }

    // Check for ANDFLG expansion (multiple dobjIds from AND-connected noun list).
    const singleResult = this.parse(tokens.join(' '), room, player, world);
    if (
      singleResult.kind === 'ok' &&
      singleResult.command.dobjIds !== undefined &&
      singleResult.command.dobjIds.length > 1
    ) {
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

  parse(
    input: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult {
    const tokens = tokenizeSegment(input);
    if (tokens.length === 0) {
      return { kind: 'fail', message: 'I beg your pardon?' };
    }

    // C8: AGAIN/G detection (gparser.zil:192-233)
    // Check BEFORE orphan-merge, BEFORE verb classification.
    if (tokens[0] === 'again' || tokens[0] === 'g') {
      return this._handleAgain(tokens, input, room, player, world);
    }

    // Per ZIL: AGAIN-LEXV is always saved (good or bad parse); P-WON gates
    // whether the replay is allowed.
    this.lastInput = input;

    // When player is null (legacy test shortcut), fall back to old collectScope
    // + matchNoun path for backward compat.
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
    // Fires before verb classification — the answer input might be a bare
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

    // Direction fast-path, case B (gparser.zil:281–283): WALK <dir>.
    // Mirrors case A (bare direction) above.
    if (canonical === 'walk' && rest.length === 1 && DIRECTIONS.has(rest[0]!)) {
      return {
        kind: 'ok',
        command: {
          verb: 'walk',
          action: 'V-WALK',
          dobjIds: undefined,
          iobjIds: undefined,
          prep: normalizeDir(rest[0]!),
          raw: tokens,
        } satisfies ParsedCommand,
      };
    }

    // C3 interim adapter: split rest into prep1/dobjTokens/prep2/iobjTokens.
    const { ncn, prep1, prep2, dobjTokens, iobjTokens } = splitOnPreps(rest);

    const verbUpper = canonical.toUpperCase();
    const syntaxResult = syntaxCheck(verbUpper, ncn, prep1, prep2);

    let action: string;
    let preAction: string | undefined;
    let matchedSyntax: import('./types.js').SyntaxEntry | undefined;

    if (syntaxResult.kind === 'fail') {
      // gparser.zil:734 — "That sentence isn't one I recognize."
      return { kind: 'fail', message: syntaxResult.message };
    }

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
      // P-END-ON-PREP (gparser.zil:326): true iff ncn===0 AND prep1 is set.
      const endOnPrep = ncn === 0 && prep1 !== undefined;

      if (syntaxResult.drive1 !== undefined) {
        const d1 = syntaxResult.drive1;
        action = d1.action;
        preAction = d1.preAction;
        matchedSyntax = d1;

        const gwimResult = gwim(
          d1.dobjFindBit,
          d1.dobjLocBits,
          d1.prep1,
          endOnPrep,
          snap,
          room,
          effectivePlayer,
          world,
          isLit,
        );

        if (gwimResult.kind === 'rooms') {
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
          // gparser.zil:756-774: ORPHAN(DRIVE1) → "What do you want to <verb> <prep>?"
          this.orphan = {
            verb: canonical,
            verbWord: rawVerb,
            prep1,
            prep2,
            slot: 'dobj',
            syntax: d1,
          };
          const msg = buildOrphanPrompt(rawVerb, undefined, d1.prep1);
          return { kind: 'orphan', message: msg };
        } else {
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
        const d2 = syntaxResult.drive2;
        action = d2.action;
        preAction = d2.preAction;
        matchedSyntax = d2;

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

        // GWIM for iobj. Exclude the dobj id — an object cannot be its own
        // indirect object (prevents "burn candles" from finding lit candles as iobj).
        const dobjExclude = dobjIds2 !== undefined
          ? new Set<string>(dobjIds2)
          : undefined;
        const gwimResult = gwim(
          d2.iobjFindBit,
          d2.iobjLocBits,
          d2.prep2,
          false,
          snap,
          room,
          effectivePlayer,
          world,
          isLit,
          dobjExclude,
        );

        if (gwimResult.kind === 'rooms') {
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
          // gparser.zil:756-774: DRIVE2 — player gave dobj, needs iobj.
          this.orphan = {
            verb: canonical,
            verbWord: rawVerb,
            prep1,
            prep2,
            slot: 'iobj',
            syntax: d2,
            resolvedDobjIds: dobjIds2,
          };
          const dobjDesc = dobjIds2?.[0] !== undefined
            ? world.get(dobjIds2[0])?.desc
            : undefined;
          const msg = buildOrphanPrompt(rawVerb, dobjDesc, d2.prep2);
          return { kind: 'orphan', message: msg };
        }

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
        // Neither drive1 nor drive2 set — defensive fallback.
        return { kind: 'fail', message: "That sentence isn't one I recognize." };
      }
    }

    const prepOut = prep1 ?? prep2;

    let dobjIds: ObjectId[] | undefined;
    let iobjIds: ObjectId[] | undefined;

    const dobjLocBits = matchedSyntax?.dobjLocBits ?? 0;
    const iobjLocBits = matchedSyntax?.iobjLocBits ?? 0;

    // C8-FIX (ANDFLG): use resolveNounPhraseList to handle "and"-connected
    // object lists (e.g. "take sword and lantern" → dobjIds [SWORD, LAMP]).
    if (dobjTokens.length > 0) {
      const listResult = resolveNounPhraseList(
        dobjTokens, snap, room, effectivePlayer, world,
        dobjLocBits, isLit, this.itRef,
      );
      if (listResult.kind === 'fail') {
        const r = listResult.result;
        if (r.ok === 'pseudo') {
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
        if (listResult.ids.length > 0) {
          dobjIds = listResult.ids;
        }
      }
    }

    if (iobjTokens.length > 0) {
      const r = resolveNounPhrase(
        iobjTokens, snap, room, effectivePlayer, world,
        iobjLocBits, undefined, isLit, this.itRef,
      );
      if (r.ok === 'pseudo') {
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

    {
      const dobjLocBitsForCheck = matchedSyntax?.dobjLocBits ?? 0;
      const iobjLocBitsForCheck = matchedSyntax?.iobjLocBits ?? 0;
      const c6 = applyC6Checks(
        canonical, dobjIds, iobjIds,
        dobjLocBitsForCheck, iobjLocBitsForCheck,
        effectivePlayer, world,
      );
      if ('kind' in c6) return c6;

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

  parseChained(
    input: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult[] {
    const segments = splitSegments(input);
    if (segments.length === 0) return [{ kind: 'fail', message: 'I beg your pardon?' }];

    const results: ParseResult[] = [];

    for (const tokens of segments) {
      const expanded = this.tryExpandAll(tokens, room, player, world);
      if (expanded !== null) {
        results.push(...expanded);
        break;
      }

      const segment = tokens.join(' ');
      const result = this.parse(segment, room, player, world);

      // C8-FIX (ANDFLG expansion): when the parser resolved multiple dobjIds
      // from an AND-connected noun list, expand into one ParseResult per object.
      // Each entry has allIter:true so game.turn() prints "<desc>: " prefix.
      if (result.kind === 'ok' && result.command.dobjIds !== undefined && result.command.dobjIds.length > 1) {
        for (const id of result.command.dobjIds) {
          results.push({
            kind: 'ok',
            command: { ...result.command, dobjIds: [id], allIter: true },
          });
        }
        this.lastWon = true;
        break;
      }

      results.push(result);

      // C8-FIX (A1): update lastWon immediately after each segment parse so
      // AGAIN in a later segment reads the LIVE parse-success state.
      // Matches ZIL semantics where P-WON = PARSER() return value per call (gmain.zil:42).
      this.lastWon = result.kind === 'ok';

      if (result.kind !== 'ok') {
        break;
      }
    }

    return results;
  }

  // C6: Try to interpret a token array as an "all" or "all except <noun>" form
  // for any SMANY-enabled verb. Returns an array of ParseResults (one per
  // matching object) when the pattern is recognised. Returns null when the
  // pattern is not applicable (no 'all' keyword).
  //
  // SNARFEM (gparser.zil:978-1030) + MANY-CHECK (gparser.zil:1294-1313).
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

    const allIdx = tokens.indexOf('all');
    if (allIdx === -1) return null;

    const syntaxResult1 = syntaxCheck(canonical.toUpperCase(), 1);
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
      const drive = syntaxResult1.drive1 ?? syntaxResult1.drive2;
      expandAction = drive?.action ?? ('V-' + verbUpper);
      expandPreAction = drive?.preAction;
      expandSyntax = drive;
      dobjLocBits = drive?.dobjLocBits ?? 0;
    } else {
      expandAction = 'V-' + verbUpper;
      expandPreAction = undefined;
      expandSyntax = undefined;
      dobjLocBits = 0;
    }

    // C6 MANY-CHECK: if the verb lacks SMANY, "all" → MANY-CHECK error immediately.
    // gparser.zil:1294-1313: if P-PRSO.length > 1 and no SMANY → fail
    if (!(dobjLocBits & SMANY)) {
      return [{
        kind: 'fail',
        message: `You can't use multiple direct objects with "${canonical}".`,
      }];
    }

    const snap = player !== null ? buildScope(room, player, world) : undefined;

    // Determine excluded object id (for "all except/but <noun>").
    let excludeId: ObjectId | undefined;
    const exceptIdx = Math.max(tokens.indexOf('except', allIdx), tokens.indexOf('but', allIdx));
    if (exceptIdx !== -1 && exceptIdx > allIdx) {
      const exceptTokens = tokens.slice(exceptIdx + 1);
      if (exceptTokens.length > 0) {
        const allObjects = allScopeForExcept(room, player, snap, world);
        const phrase = splitNounPhrase(exceptTokens);
        if (phrase !== null) {
          const matchesEx = matchNoun(phrase.noun, phrase.adjectives, allObjects);
          if (matchesEx.length === 1) excludeId = matchesEx[0]!.id;
        }
      }
    }

    let candidates: GameObject[];
    if (canonical === 'drop') {
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
      const pool = collectByLocBits(dobjLocBits, room, player, snap, world).filter(o => !o.has(Flag.Invisible));
      // A1: For TAKE, gate by Takeable OR TryTake (gmain.zil:137-138).
      // Objects with only TryTake (rug, trophy case) are reported with their
      // refusal lines — the old filter (Takeable only) dropped them.
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

  // LEGACY backward-compat path for tests that pass player=null.
  // Uses the old collectScope + matchNoun approach (no lighting check).
  // Removed when C9 rewrites the full scan-loop.
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

    if (canonical === 'walk' && rest.length === 1 && DIRECTIONS.has(rest[0]!)) {
      return {
        kind: 'ok',
        command: {
          verb: 'walk',
          action: 'V-WALK',
          dobjIds: undefined,
          iobjIds: undefined,
          prep: normalizeDir(rest[0]!),
          raw: tokens,
        },
      };
    }

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

  // C8: AGAIN/G handler (gparser.zil:192-233)
  private _handleAgain(
    tokens: string[],
    _rawInput: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult {
    // Guard 1: no saved input (P-INBUF empty equivalent)
    // gparser.zil:193-195
    if (this.lastInput === undefined) {
      return { kind: 'fail', message: 'Beg pardon?' };
    }

    // Guard 2: orphan pending
    // gparser.zil:196-198
    if (this.orphan !== undefined) {
      return { kind: 'fail', message: "It's difficult to repeat fragments." };
    }

    // Guard 3: last command failed (P-WON false)
    // gparser.zil:199-201
    if (!this.lastWon) {
      return { kind: 'fail', message: 'That would just repeat a mistake.' };
    }

    // Guard 4: trailing non-separator tokens after AGAIN
    // gparser.zil:202-218
    const separators = new Set<string>(['.', ',', 'then', 'and']);
    const trailing = tokens.slice(1);
    const hasNonSeparator = trailing.some(t => !separators.has(t));
    if (hasNonSeparator) {
      return { kind: 'fail', message: "I couldn't understand that sentence." };
    }

    return this.parse(this.lastInput, room, player, world);
  }

  // C7: ORPHAN-MERGE — handle next-turn input when orphan state is set.
  // gparser.zil:543-630 (ORPHAN-MERGE).
  private _orphanMerge(
    tokens: string[],
    room: Room,
    player: GameObject,
    world: World,
    snap: ScopeSnapshot,
    isLit: boolean,
  ): ParseResult {
    const orphan = this.orphan!;

    if (orphan.disambig !== undefined) {
      return this._handleDisambigAnswer(tokens, orphan, room, player, world, snap, isLit);
    }

    return this._handleOrphanAnswer(tokens, orphan, room, player, world, snap, isLit);
  }

  // Handle a disambiguation answer: select one of the ambiguous candidates.
  private _handleDisambigAnswer(
    tokens: string[],
    orphan: OrphanState,
    room: Room,
    player: GameObject,
    world: World,
    _snap: ScopeSnapshot,
    _isLit: boolean,
  ): ParseResult {
    const { noun: orphanNoun, candidates } = orphan.disambig!;

    const answerTokens = tokens;
    const answerNoun = answerTokens[answerTokens.length - 1] ?? '';
    const answerAdjs = answerTokens.slice(0, -1);

    if (answerTokens.length > 0 && lookupVerb(answerTokens[0]!) !== undefined) {
      this.orphan = undefined;
      return this.parse(tokens.join(' '), room, player, world);
    }

    const matched = candidates
      .map(id => world.get(id))
      .filter((obj): obj is import('../../domain/game-object.js').GameObject => obj !== undefined)
      .filter(obj => {
        const nounLc = answerNoun.toLowerCase();
        const nounsMatch =
          nounLc === orphanNoun.toLowerCase() ||
          obj.synonyms.some(s => s.toLowerCase() === nounLc) ||
          obj.adjectives.some(a => a.toLowerCase() === nounLc);
        if (!nounsMatch) return false;
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
      this.orphan = undefined;
      const syntax = orphan.syntax;
      const resolvedId = matched[0]!.id;

      if (orphan.slot === 'dobj') {
        const dobjIds: ObjectId[] = [resolvedId];
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

    this.orphan = undefined;
    return this.parse(tokens.join(' '), room, player, world);
  }

  // Handle an orphan answer (missing-object case, no disambig).
  private _handleOrphanAnswer(
    tokens: string[],
    orphan: OrphanState,
    room: Room,
    player: GameObject,
    world: World,
    snap: ScopeSnapshot,
    isLit: boolean,
  ): ParseResult {
    const firstToken = tokens[0] ?? '';

    if (lookupVerb(firstToken) !== undefined) {
      this.orphan = undefined;
      return this.parse(tokens.join(' '), room, player, world);
    }

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

  // Update pronoun state from a successfully resolved command.
  // The direct object becomes the new "it" / "them" referent.
  //
  // Called from the PERFORM prologue in Game.turn() (gmain.zil:202–203) for
  // non-WALK commands that have a direct object — NOT from inside the parser
  // itself. The parser only READS itRef; the game writes it (B3 seam).
  bindPronouns(cmd: ParsedCommand): void {
    const dobjId = cmd.dobjIds?.[0];
    if (dobjId !== undefined) {
      this.itRef = dobjId;
    }
  }
}

export function parse(
  input: string,
  room: Room,
  player: GameObject | null,
  world: World,
): ParseResult {
  return new Parser().parse(input, room, player, world);
}

export type { ParsedCommand, ParseResult };
