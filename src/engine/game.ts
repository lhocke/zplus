import type { ObjectId, Dir, GameObject, ActionContext } from '../domain/game-object.js';
import type { World } from '../domain/world.js';
import { Flag } from '../domain/flags.js';
import type { Room } from '../domain/room.js';
import type { Actor } from '../domain/actor.js';
import { Clock } from './clock.js';
import type { EventEmitter } from './events.js';
import { Parser } from './parser/parser.js';
import { executeVerb, describeRoomObjects, META_ACTIONS, isBareAttackTroll, TROLL_SIGN_TEXT } from './verbs/index.js';
import { lit } from './parser/scope.js';
import { describeRoom as describeRoomMsgs } from './game-messages.js';
import { Scoring } from './scoring.js';
import { FlagStore } from './flag-store.js';
import { lookupPer, lookupPreAction } from '../actions/registry.js';
import { M_BEG, M_ENTER, M_LOOK, M_END } from './messages.js';
import { jigsUp as jigsUpMsgsFn } from './game-messages.js';
import { jigsUp, type JigsUpCallbacks, type JigsUpMsgs } from './death.js';

export interface TurnResult {
  readonly output: string;
  readonly moved: boolean;
}

/**
 * Result of the PERFORM chain (runActionChain).  Mirrors the ZIL tri-state:
 *   handled  — at least one step returned truthy (ZIL RTRUE / M-HANDLED = 1)
 *   fatal    — a handler called ctx.fatal() (ZIL M-FATAL = 2)
 */
export interface ChainResult {
  readonly handled: boolean;
  readonly fatal: boolean;
}

/** Read-only snapshot of game state for the UI and assist layers. */
export interface GameView {
  readonly here: ObjectId;
  readonly hereName: string;
  readonly exits: ReadonlyArray<{ dir: Dir; known: boolean; to?: ObjectId }>;
  readonly visibleObjects: ReadonlyArray<{ id: ObjectId; name: string }>;
  readonly score: number;
  readonly maxScore: number;
  readonly moves: number;
  readonly inMaze: boolean;
}

/**
 * Minimal RNG interface.  A concrete seeded implementation lives in rng.ts.
 * Tests can supply a simple stub: `{ next: () => someFloat }`.
 */
export interface Rng {
  /** Returns a pseudo-random float in [0, 1). */
  next(): number;
  /** ZIL <PROB base>: true with probability ~base/100. */
  prob(base: number): boolean;
  /**
   * ZIL ZPROB — gmacros.zil:115–122. Continuous draw: next()*denom < base.
   * Optional here so existing test stubs (next+prob only) still type-check;
   * combat code always runs against the concrete Rng class which implements it.
   */
  zprob?(base: number, denom: number): boolean;
  /**
   * Returns a pseudo-random integer in [0, n).
   * Optional so simple test stubs (next+prob only) still type-check;
   * the concrete Rng class always implements it.
   */
  nextInt?(n: number): number;
}

// Ghost verb table action sets — 1actions.zil:3113–3173.
// Pass-through: meta verbs + SAVE/RESTORE/RESTART/QUIT handled by META_ACTIONS.
// Additional pass-through verbs not in META_ACTIONS:
const GHOST_PASS_ACTIONS: ReadonlySet<string> = new Set([
  'V-VERSION', 'V-AGAIN', 'V-BACK',
]);

// ATTACK / MUNG / ALARM / SWING — all such attacks are vain.
const GHOST_ATTACK_ACTIONS: ReadonlySet<string> = new Set([
  'V-ATTACK', 'V-MUNG', 'V-ALARM', 'V-SWING',
]);

// OPEN / CLOSE / EAT / DRINK / INFLATE / DEFLATE / TURN / BURN / TIE / UNTIE / RUB
// (RUB is also in the TAKE slot; ZIL has it in both — the TAKE clause fires first)
const GHOST_BEYOND_ACTIONS: ReadonlySet<string> = new Set([
  'V-OPEN', 'V-CLOSE', 'V-EAT', 'V-DRINK', 'V-INFLATE', 'V-DEFLATE',
  'V-TURN', 'V-BURN', 'V-TIE', 'V-TIE-UP', 'V-UNTIE',
]);

const INTRO =
  'ZORK I: The Great Underground Empire\n' +
  'Copyright (c) 1981, 1982, 1983 Infocom, Inc. All rights reserved.\n' +
  'ZORK is a registered trademark of Infocom, Inc.\n' +
  'Revision 88 / Serial number 840726\n';

export class Game {
  readonly world: World;
  private readonly clock: Clock;
  private readonly rng: Rng;
  readonly events: EventEmitter;

  private readonly parser: Parser;
  // player is exposed read-only for combat (pStrength checks) and tests.
  player: Actor;
  private here: Room;

  private readonly flags: FlagStore;
  private readonly scoring: Scoring;
  private moveCount = 0;

  // Death-state fields (ZIL globals).
  // deaths/gameOver are facade control-flow; dead/alwaysLit gate ghost-mode resurrection.
  private deaths = 0;
  private dead = false;
  private alwaysLit = false;
  private gameOver = false;

  // ZIL global LUCKY — 1actions.zil:969 (<GLOBAL LUCKY T>).
  // true at start; set false only by MIRROR-MUNG (1actions.zil:1009), never restored.
  // zprob callers pass denom=100 (lucky) or denom=300 (unlucky).
  lucky = true;

  // ZIL encumbrance globals — gglobals.zil:92,94.
  // LOAD-MAX: the player's carrying capacity ceiling.
  // LOAD-ALLOWED: current remaining capacity; wound application reduces this,
  // I-CURE restores it.  Both init 100 per <GLOBAL LOAD-MAX 100> / <GLOBAL LOAD-ALLOWED 100>.
  loadAllowed = 100;
  loadMax = 100;

  // Stashed command context for M-END (gmain.zil:151–161).
  // LIVING-ROOM-FCN's M-END branch reads VERB?/PRSO/PRSI (1actions.zil:478–482)
  // to detect a treasure deposit, so M-END needs the just-executed command's values.
  private lastVerb: string = 'look';
  private lastDobj: GameObject | undefined = undefined;
  private lastIobj: GameObject | undefined = undefined;
  private lastPrep: string | undefined = undefined;

  private readonly visited = new Set<ObjectId>();

  constructor(
    world: World,
    opts: { rng: Rng; clock: Clock; events: EventEmitter },
  ) {
    this.world = world;
    this.clock = opts.clock;
    this.rng = opts.rng;
    this.events = opts.events;
    this.parser = new Parser();
    this.flags = new FlagStore();

    // WON-FLAG world effects — gverbs.zil:1858–1862.
    // Fired once when SCORE first reaches 350 inside scoreUpd or recomputeTrophy.
    const wonFlagHook = (tell: (s: string) => void): void => {
      const map = this.world.get('MAP');
      if (map !== undefined) map.clear(Flag.Invisible);
      const woh = this.world.get('WEST-OF-HOUSE');
      if (woh !== undefined) woh.clear(Flag.Touched);
      // gverbs.zil:1861–1862 — bare newline in ZIL source collapses to a space.
      tell('An almost inaudible voice whispers in your ear, "Look to your treasures for the final secret."');
    };

    this.scoring = new Scoring(this.events, this.flags, wonFlagHook);

    const playerObj = this.world.get('PLAYER');
    if (playerObj === undefined) {
      throw new Error('World must contain an object with id "PLAYER".');
    }
    this.player = playerObj as Actor;

    if (this.player.parent === null) {
      throw new Error('Player has no parent room.');
    }
    this.here = this.player.parent as Room;
  }

  /** Print the intro banner and describe the initial room. */
  start(): string {
    const roomDesc = this.describeCurrentRoom();
    this.emitRoomEntered(this.here.id);
    return INTRO + '\n' + roomDesc;
  }

  /**
   * FINISH — gverbs.zil:33–53, web-shell form (B7).
   *
   * Renders V-SCORE (score + moves + rank), emits the terminal string, and
   * sets gameOver.  RESTART/RESTORE are no-ops (save slots deferred).
   * The tell callback receives the text so callers can route it to their output
   * buffer; when tell is not provided the output is discarded (death paths that
   * call finish() only care about gameOver).
   */
  doFinish(tell?: (s: string) => void): void {
    const score  = this.scoring.score;
    const moves  = this.moveCount;
    const rank   = this.scoring.rank();
    const movePart = moves === 1 ? '1 move.' : `${moves} moves.`;
    const scoreText = `Your score is ${score} (total of 350 points), in ${movePart}\nThis gives you the rank of ${rank}.`;
    tell?.(scoreText);
    tell?.('ZORK: The Great Underground Empire.');
    this.gameOver = true;
  }

  /**
   * DEAD-FUNCTION ghost verb dispatch — 1actions.zil:3113–3173.
   *
   * Called from turn() when dead===true. Returns a TurnResult for verbs the
   * ghost table handles, or undefined for pass-through verbs (movement, meta)
   * which fall back to normal parse.
   *
   * The ZIL routine's final T-clause fires RFATAL + clears P-CONT; we replicate
   * that by returning a result and not continuing the turn loop.
   */
  private ghostDispatch(input: string): TurnResult | undefined {
    // Parse to get the action. We need the action id to route the ghost table.
    // A minimal parse is sufficient — we only need the verb.
    const pr = this.parser.parseSegment(input, this.here, this.player, this.world);

    // On parse error / orphan, let the error message through as-is.
    if (pr.kind !== 'ok') {
      return { output: pr.message, moved: false };
    }
    const action = pr.command.action;
    const outputs: string[] = [];
    const tell = (s: string): void => { outputs.push(s); };

    // 1actions.zil:3114–3117 — WALK: block west from TIMBER-ROOM only.
    if (action === 'V-WALK') {
      const dir = pr.command.prep;
      if (this.here.id === 'TIMBER-ROOM' && dir === 'west') {
        this.parser.clearContinuation();
        return { output: 'You cannot enter in your condition.', moved: false };
      }
      // All other movement: pass-through (normal walk).
      return undefined;
    }

    // 1actions.zil:3132–3133 — SCORE: checked before meta pass-through because
    // V-SCORE is in META_ACTIONS but the ghost table intercepts it explicitly.
    if (action === 'V-SCORE') {
      this.parser.clearContinuation();
      return { output: "You're dead! How can you think of your score?", moved: false };
    }

    // 1actions.zil:3118–3120 — meta verbs pass through (BRIEF/VERBOSE/VERSION/SAVE/etc).
    if (META_ACTIONS.has(action) || GHOST_PASS_ACTIONS.has(action)) {
      return undefined;
    }

    // 1actions.zil:3121–3122 — attacks are vain.
    if (GHOST_ATTACK_ACTIONS.has(action)) {
      this.parser.clearContinuation();
      return { output: 'All such attacks are vain in your condition.', moved: false };
    }

    // 1actions.zil:3123–3127 — physical actions beyond capability.
    if (GHOST_BEYOND_ACTIONS.has(action)) {
      this.parser.clearContinuation();
      return { output: 'Even such an action is beyond your capabilities.', moved: false };
    }

    // 1actions.zil:3128–3129 — WAIT.
    if (action === 'V-WAIT') {
      this.parser.clearContinuation();
      return { output: "Might as well. You've got an eternity.", moved: false };
    }

    // 1actions.zil:3130–3131 — LAMP-ON.
    if (action === 'V-LAMP-ON') {
      this.parser.clearContinuation();
      return { output: 'You need no light to guide you.', moved: false };
    }

    // 1actions.zil:3134–3135 — TAKE or RUB (hand passes through).
    if (action === 'V-TAKE' || action === 'V-RUB') {
      this.parser.clearContinuation();
      return { output: 'Your hand passes through its object.', moved: false };
    }

    // 1actions.zil:3136–3137 — DROP / THROW / INVENTORY.
    if (action === 'V-DROP' || action === 'V-THROW' || action === 'V-INVENTORY') {
      this.parser.clearContinuation();
      return { output: 'You have no possessions.', moved: false };
    }

    // 1actions.zil:3138–3139 — DIAGNOSE.
    if (action === 'V-DIAGNOSE') {
      this.parser.clearContinuation();
      return { output: 'You are dead.', moved: false };
    }

    // 1actions.zil:3140–3151 — LOOK: unearthly description.
    if (action === 'V-LOOK' || action === 'V-EXAMINE') {
      this.parser.clearContinuation();
      // 1actions.zil:3142–3146 — different text based on whether objects are present.
      const hasObjs = this.here.children.size > 0;
      const line1 = hasObjs
        ? 'The room looks strange and unearthly and objects appear indistinct.'
        : 'The room looks strange and unearthly.';
      const lines: string[] = [line1];
      // 1actions.zil:3147–3150 — if room is lit (ONBIT), note no-light.
      if (!this.here.has(Flag.On)) {
        lines.push('Although there is no light, the room seems dimly illuminated.');
      }
      return { output: lines.join('\n'), moved: false };
    }

    // 1actions.zil:3152–3169 — PRAY: South-Temple resurrection or "not heard".
    if (action === 'V-PRAY') {
      this.parser.clearContinuation();
      if (this.here.id === 'SOUTH-TEMPLE') {
        // 1actions.zil:3154–3167 — resurrection sequence.
        const lamp = this.world.get('LAMP');
        if (lamp !== undefined) lamp.clear(Flag.Invisible);
        // Clear DEAD-FUNCTION handler slot (ZIL: PUTP WINNER P?ACTION 0).
        // In our model dead===false is the state; no handler to clear.
        this.alwaysLit = false;
        this.dead = false;
        // 1actions.zil:3159–3160 — if troll is in TROLL-ROOM, clear trollFlag.
        const troll = this.world.get('TROLL');
        const trollRoom = this.world.get('TROLL-ROOM');
        if (troll !== undefined && trollRoom !== undefined && troll.parent === trollRoom) {
          this.flags.set('TROLL-FLAG', false);
        }
        const trumpetMsg =
          'From the distance the sound of a lone trumpet is heard. The room\n' +
          'becomes very bright and you feel disembodied. In a moment, the\n' +
          'brightness fades and you find yourself rising as if from a long\n' +
          'sleep, deep in the woods. In the distance you can faintly hear a\n' +
          'songbird and the sounds of the forest.';
        tell(trumpetMsg);
        // Goto FOREST-1 — 1actions.zil:3167.
        const forest1 = this.world.get('FOREST-1') as Room;
        if (forest1 !== undefined) {
          this.player.moveTo(forest1);
          const enterOut = this.onRoomEntered(forest1);
          if (enterOut) tell(enterOut);
          tell(this.describeCurrentRoom());
        }
        return { output: outputs.join('\n'), moved: true };
      }
      // 1actions.zil:3168–3169 — elsewhere.
      return { output: 'Your prayers are not heard.', moved: false };
    }

    // 1actions.zil:3170–3173 — T (fallback): "You can't even do that."
    // ZIL: SETG P-CONT <>; RFATAL.
    this.parser.clearContinuation();
    return { output: "You can't even do that.", moved: false };
  }

  /** Execute one command line (may contain chained commands via "then" / "."). */
  turn(input: string): TurnResult {
    if (this.gameOver) return { output: '', moved: false };

    // Ghost dispatch — spec §9.5 (B8/OQ-4, RATIFIED).
    // When dead===true, route through the DEAD-FUNCTION verb table
    // (1actions.zil:3113–3173) before normal parsing. Pass-through verbs
    // (movement, meta) let normal turn processing continue; all others short-circuit.
    if (this.dead) {
      const ghostResult = this.ghostDispatch(input);
      if (ghostResult !== undefined) {
        return ghostResult;
      }
      // undefined → pass-through (movement or meta verbs); fall into normal parse
    }

    // PHASE-1 TEMPORARY — removed when real combat replaces verbAttackPhase1 (verbs/index.ts).
    // Bare "attack/kill troll" would normally go through GWIM to find a weapon iobj, either
    // orphan-prompting when multiple weapons are in scope or failing the held-check when the
    // troll's axe is the only candidate. Intercept here so the sign fires without the parser
    // needing a resolved weapon -- but ONLY when the troll is actually present in this room.
    // Named-weapon forms ("attack troll with sword") still reach verbAttackPhase1 via the
    // normal V-ATTACK path below.
    const trollInRoom = this.world.get('TROLL')?.parent === this.here;
    if (isBareAttackTroll(input, trollInRoom)) {
      return { output: TROLL_SIGN_TEXT, moved: false };
    }

    const outputs: string[] = [];
    let moved = false;

    let isFirstCall = true;
    while (true) {
      const rawLine = isFirstCall ? input : '';
      isFirstCall = false;

      const pr = this.parser.parseSegment(rawLine, this.here, this.player, this.world);

      if (pr.kind === 'orphan' || pr.kind === 'disambig') {
        outputs.push(pr.message);
        this.parser.setLastWon(false);
        break;
      }

      if (pr.kind !== 'ok') {
        outputs.push(pr.message);
        this.parser.setLastWon(false);
        this.parser.clearContinuation();
        break;
      }

      const cmd = pr.command;
      // Meta-verbs don't consume time (ZIL gmain.zil:171-172 VERB? guard around CLOCKER).
      const segmentConsumesTime = !META_ACTIONS.has(cmd.action);

      const dobj = cmd.dobjIds?.[0] !== undefined ? this.world.get(cmd.dobjIds[0]!) : undefined;
      const iobj = cmd.iobjIds?.[0] !== undefined ? this.world.get(cmd.iobjIds[0]!) : undefined;

      // Stash for M-END (gmain.zil:151–161) — LIVING-ROOM-FCN reads these.
      this.lastVerb = cmd.verb;
      this.lastDobj = dobj;
      this.lastIobj = iobj;
      this.lastPrep = cmd.prep;

      // IT-binding prologue (gmain.zil:202–203): bind pronoun referent before the
      // chain so the next segment in a chained command ("open mailbox. read it") can
      // resolve "it". Guard: dobj present AND action != V-WALK.
      if (dobj !== undefined && cmd.action !== 'V-WALK') {
        this.parser.bindPronouns(cmd);
      }

      // gwimText: GWIM auto-supply parenthetical "(with the sword)" (gparser.zil:1294).
      // allIter: ALL-iteration prefix "<desc>: " for "examine all" expansions (gmain.zil:121-144).
      const allIterPrefix = cmd.allIter === true && dobj !== undefined
        ? `${dobj.desc}: `
        : '';

      // autoTaken: STAKE auto-take — print "(Taken)" and move object (gparser.zil:1291).
      const handled: string[] = [];
      if (cmd.gwimText !== undefined) handled.push(cmd.gwimText);
      if (cmd.autoTaken !== undefined && cmd.autoTaken.length > 0) {
        for (const takenId of cmd.autoTaken) {
          const takenObj = this.world.get(takenId);
          if (takenObj !== undefined) {
            takenObj.moveTo(this.player);
          }
          handled.push('(Taken)');
        }
      }

      const prevRoom = this.here;

      // 7-step PERFORM chain (gmain.zil:210–224).
      // runActionChain covers steps 1–6; step 7 (executeVerb) is caller-side,
      // gated on !handled && !fatal.
      const chainResult = this.runActionChain(
        cmd.verb, cmd.action, dobj, iobj, cmd.prep, cmd.preAction,
        (text) => handled.push(text),
      );

      if (chainResult.fatal) {
        // M-FATAL: skip M-END and abort remaining chained commands (gmain.zil:161).
        this.parser.setLastWon(false);
        this.parser.clearContinuation();
        outputs.push(handled.join('\n'));
        break;
      }

      this.parser.setLastWon(true);

      if (chainResult.handled) {
        const newRoomAfterHandler = this.player.parent as Room;
        if (newRoomAfterHandler !== undefined && newRoomAfterHandler !== prevRoom) {
          moved = true;
          const enterOut = this.onRoomEntered(newRoomAfterHandler);
          const roomDesc = this.describeCurrentRoom();
          const parts = [...handled, ...(enterOut ? [enterOut] : []), roomDesc].filter(s => s.length > 0);
          const cmdOut = parts.join('\n');
          outputs.push(allIterPrefix ? allIterPrefix + cmdOut : cmdOut);
        } else {
          const cmdOut = handled.join('\n');
          outputs.push(allIterPrefix ? allIterPrefix + cmdOut : cmdOut);
        }
      } else {
        // No handler claimed the command — run step 7: default verb routine.
        // Dispatch on cmd.action (ZIL PRSA), not cmd.verb (verb word) — gmain.zil:283–284.
        const verbResult = executeVerb({
          verb: cmd.verb,
          dobj,
          iobj,
          prep: cmd.prep,
          player: this.player,
          here: this.here,
          world: this.world,
          perResolver: (routineName, here) => this.resolvePer(routineName, here, (text) => handled.push(text)),
          mlookRunner: (room) => this.runMLook(room),
          rng: this.rng,
          scoreObj: (obj) => this.scoring.scoreObj(obj, (text) => handled.push(text)),
          score:  this.scoring.score,
          moves:  this.moveCount,
          rank:   () => this.scoring.rank(),
          deaths: this.deaths,
          getGlobal: (n) => this.flags.get(n),
          setGlobal: (n, v = true) => this.flags.set(n, v),
          jigsUp: (desc) => jigsUp(desc, this.jigsUpMsgs(), this.makeJigsUpCallbacks((text) => handled.push(text), () => { /* verb layer marks fatal independently */ })),
          alwaysLit: this.alwaysLit,
          prob: (pct) => this.rng.prob(pct),
          clearContinuation: () => this.parser.clearContinuation(),
          loadAllowed: this.loadAllowed,
          loadMax: this.loadMax,
        }, cmd.action);

        if (verbResult.fatal) {
          this.parser.setLastWon(false);
          this.parser.clearContinuation();
          if (verbResult.moved) {
            moved = true;
            const newRoom = this.player.parent as Room;
            if (newRoom !== undefined && newRoom !== this.here) {
              this.here = newRoom;
            }
          }
          outputs.push([...handled, verbResult.output].filter(s => s.length > 0).join('\n'));
          break;
        }

        const parts = [...handled, verbResult.output].filter(s => s.length > 0);
        const cmdOut = parts.join('\n');
        outputs.push(allIterPrefix ? allIterPrefix + cmdOut : cmdOut);

        if (verbResult.moved) {
          moved = true;
          const newRoom = this.player.parent as Room;

          if (verbResult.movedIntoDark) {
            // Dark destination (ZIL GOTO order): darkPlaceEntered notice, then M-ENTER,
            // then describeCurrentRoom() → pitch-black message.
            let enterOut = '';
            if (newRoom !== undefined && newRoom !== this.here) {
              enterOut = this.onRoomEntered(newRoom);
            }
            const roomDesc = this.describeCurrentRoom();
            const mergedParts = [
              outputs[outputs.length - 1] ?? '',
              enterOut,
              roomDesc,
            ].filter(s => s.length > 0);
            const idx = outputs.length - 1;
            if (idx >= 0) {
              outputs[idx] = mergedParts.join('\n');
            } else {
              outputs.push(mergedParts.join('\n'));
            }
          } else if (newRoom !== undefined && newRoom !== this.here) {
            // Lit destination: fire M-ENTER and prepend its output before room description.
            const enterOut = this.onRoomEntered(newRoom);
            if (enterOut.length > 0) {
              const idx = outputs.length - 1;
              if (idx >= 0) {
                outputs[idx] = [enterOut, outputs[idx]].join('\n');
              } else {
                outputs.push(enterOut);
              }
            }
          }
        }
      }

      // M-END (gmain.zil:151–161): unconditional post-turn room callback on the
      // current room (post-GOTO). Passes stashed verb/dobj/iobj/prep so handlers
      // like LIVING-ROOM-FCN can read VERB?/PRSO/PRSI.
      const mEndOut = this.runMEnd(this.here);
      if (mEndOut.length > 0) {
        const idx = outputs.length - 1;
        if (idx >= 0) {
          outputs[idx] = [outputs[idx], mEndOut].filter(s => s.length > 0).join('\n');
        } else {
          outputs.push(mEndOut);
        }
      }

      // CLOCKER tick — once per non-meta executed command (gclock.zil).
      if (segmentConsumesTime) {
        this.moveCount += 1;
        const clockLines = this.clock.advance();
        if (clockLines.length > 0) {
          const clockText = clockLines.join('\n');
          const idx = outputs.length - 1;
          if (idx >= 0) {
            outputs[idx] = [outputs[idx], clockText].filter(s => s.length > 0).join('\n');
          } else {
            outputs.push(clockText);
          }
        }
        this.events.emit({ type: 'turn-complete', moves: this.moveCount });
      }

      if (!this.parser.hasContinuation()) {
        break;
      }
    }

    return { output: outputs.join('\n'), moved };
  }

  /** Return a read-only snapshot of current game state. */
  view(): GameView {
    const exits = this.here.exits.map(e => ({
      dir: e.dir,
      known: e.to !== undefined,
      to: e.to,
    }));

    const visibleObjects = Array.from(this.here.children)
      .filter(o => !o.has(Flag.Invisible) && o !== this.player)
      .map(o => ({ id: o.id, name: o.desc }));

    return {
      here: this.here.id,
      hereName: this.here.desc,
      exits,
      visibleObjects,
      score: this.scoring.score,
      maxScore: 350,
      moves: this.moveCount,
      inMaze: this.here.has(Flag.Maze),
    };
  }

  /**
   * Build the ActionContext handed to a translated ZIL routine.  `self` is the
   * object/room whose routine is running; `rarg` is the room-handler message
   * (undefined for object handlers).
   *
   * `onFatal` is called when the handler invokes `ctx.fatal()` (ZIL RFATAL / M-FATAL=2).
   */
  private makeContext(
    self: GameObject,
    verb: string,
    dobj: GameObject | undefined,
    iobj: GameObject | undefined,
    prep: string | undefined,
    rarg: number | undefined,
    tell: (text: string) => void,
    onFatal?: () => void,
  ): ActionContext {
    return {
      self,
      actor: this.player,
      verb,
      dobj,
      iobj,
      prep,
      world: this.world,
      here: this.here,
      rarg,
      rng: this.rng,
      tell,
      hasFlag: (obj, flag) => obj.has(flag),
      setFlag: (obj, flag) => obj.set(flag),
      clearFlag: (obj, flag) => obj.clear(flag),
      moveTo: (obj, dest) => obj.moveTo(dest),
      score: (delta) => this.scoring.add(delta),
      scoreObj: (obj) => this.scoring.scoreObj(obj, tell),
      recomputeTrophy: (trophyCase) => this.scoring.recomputeTrophy(trophyCase, tell),
      enableClock: (id) => this.clock.enable(id),
      disableClock: (id) => this.clock.disable(id),
      getGlobal: (n) => this.flags.get(n),
      setGlobal: (n, v = true) => this.flags.set(n, v),
      fatal: onFatal ?? (() => { /* no-op when not in a dispatch chain */ }),
      finish: () => { this.doFinish(tell); },
    };
  }

  /**
   * Run the 7-step PERFORM dispatch chain (gmain.zil:210–224).
   * First truthy return short-circuits the rest (ZIL RTRUE = M-HANDLED).
   * A handler may call `ctx.fatal()` (ZIL M-FATAL = 2) to abort; the caller
   * must then skip M-END and clear continuation.
   * Step 7 (ACTIONS[verb] default) is caller-side via executeVerb.
   */
  private runActionChain(
    verb: string,
    action: string,
    dobj: GameObject | undefined,
    iobj: GameObject | undefined,
    prep: string | undefined,
    preAction: string | undefined,
    tell: (text: string) => void,
  ): ChainResult {
    let fatal = false;
    const onFatal = (): void => { fatal = true; };

    const ctx = (self: GameObject, rarg?: number): ActionContext =>
      this.makeContext(self, verb, dobj, iobj, prep, rarg, tell, onFatal);

    // WINNER (actor) P?ACTION — gmain.zil:211
    if (this.player.handler !== undefined) {
      if (this.player.handler(ctx(this.player))) {
        return { handled: true, fatal };
      }
    }

    // room P?ACTION rarg=M-BEG — gmain.zil:212
    if (this.here.handler !== undefined) {
      if (this.here.handler(ctx(this.here, M_BEG))) {
        return { handled: true, fatal };
      }
    }

    // PREACTIONS[verb] — PRE-* guard, gmain.zil:213
    if (preAction !== undefined) {
      const preHandler = lookupPreAction(preAction);
      if (preHandler !== undefined) {
        if (preHandler(ctx(dobj ?? this.here))) {
          return { handled: true, fatal };
        }
      }
    }

    // PRSI P?ACTION — gmain.zil:214
    if (iobj?.handler !== undefined) {
      if (iobj.handler(ctx(iobj))) {
        return { handled: true, fatal };
      }
    }

    // LOC(PRSO) P?CONTFCN — gmain.zil:215–219
    if (action !== 'V-WALK' && dobj !== undefined && dobj.parent !== null && dobj.parent !== undefined) {
      const container = dobj.parent;
      if (container.contFcn !== undefined) {
        if (container.contFcn(ctx(container))) {
          return { handled: true, fatal };
        }
      }
    }

    // PRSO P?ACTION — gmain.zil:220–223
    if (action !== 'V-WALK' && dobj?.handler !== undefined) {
      if (dobj.handler(ctx(dobj))) {
        return { handled: true, fatal };
      }
    }

    return { handled: false, fatal };
  }

  /**
   * Resolve an `Exit.per` routine name to a destination room id.
   * The routine's output goes through `tell` and prints before the destination description.
   * Returns undefined to block the move.
   */
  private resolvePer(
    routineName: string,
    here: Room,
    tell: (text: string) => void,
  ): ObjectId | undefined {
    const per = lookupPer(routineName);
    if (per === undefined) return undefined;
    const ctx = this.makeContext(here, 'walk', undefined, undefined, undefined, undefined, tell);
    return per(ctx);
  }

  /**
   * Fire room entry: run the room's M-ENTER action, update `here`, emit the
   * room-entered event. Returns any M-ENTER output so the caller can prepend it.
   * Mirrors GOTO in 1dungeon.zil (M-ENTER then M-LOOK description).
   */
  private onRoomEntered(room: Room): string {
    this.here = room;
    const enterBuf: string[] = [];
    if (room.handler !== undefined) {
      const ctx = this.makeContext(
        room, 'walk', undefined, undefined, undefined, M_ENTER,
        (text) => enterBuf.push(text),
      );
      room.handler(ctx);
    }
    this.emitRoomEntered(room.id, (text) => enterBuf.push(text));
    return enterBuf.join('\n');
  }

  private describeCurrentRoom(): string {
    // Darkness gate — gverbs.zil:1637-1649.
    // alwaysLit suppresses darkness for ghost mode (ALWAYS-LIT global, 1actions.zil:4083).
    if (!this.alwaysLit && !lit(this.here, this.player, this.world)) {
      const sprayed = this.flags.get('SPRAYED?');
      return sprayed ? describeRoomMsgs.darkSprayed : describeRoomMsgs.darkNoSpray;
    }

    const lines: string[] = [this.here.desc];

    if (this.here.ldesc) {
      lines.push(this.here.ldesc);
    } else if (this.here.handler !== undefined) {
      const buf: string[] = [];
      const ctx = this.makeContext(
        this.here, 'look', undefined, undefined, undefined, M_LOOK,
        (text) => buf.push(text),
      );
      this.here.handler(ctx);
      if (buf.length > 0) lines.push(buf.join('\n'));
    }

    describeRoomObjects(this.here, this.player, (s) => lines.push(s));

    return lines.join('\n');
  }

  /** Run a room's M-LOOK handler and return the output — used by the verb layer. */
  private runMLook(room: Room): string {
    if (room.handler === undefined) return '';
    const buf: string[] = [];
    const ctx = this.makeContext(
      room, 'look', undefined, undefined, undefined, M_LOOK,
      (text) => buf.push(text),
    );
    room.handler(ctx);
    return buf.join('\n');
  }

  /**
   * Run the room's M-END callback after each non-fatal turn (gmain.zil:151–161).
   * Called on the current room (after any GOTO), passing the just-executed
   * command so M-END handlers like LIVING-ROOM-FCN can read VERB?/PRSO/PRSI
   * (1actions.zil:478–482).
   */
  private runMEnd(room: Room): string {
    if (room.handler === undefined) return '';
    const buf: string[] = [];
    const ctx = this.makeContext(
      room,
      this.lastVerb,
      this.lastDobj,
      this.lastIobj,
      this.lastPrep,
      M_END,
      (text) => buf.push(text),
    );
    room.handler(ctx);
    return buf.join('\n');
  }

  private emitRoomEntered(roomId: ObjectId, tell?: (s: string) => void): void {
    const firstVisit = !this.visited.has(roomId);
    this.visited.add(roomId);
    // First-visit room VALUE award — same SCORE-OBJ mechanism as object pickups.
    // gverbs.zil:1851-1865: scoreObj → scoreUpd → checkWonFlag threads tell so the
    // WON-FLAG whisper reaches the same output channel as the room description.
    if (firstVisit) {
      const room = this.world.get(roomId);
      if (room !== undefined) {
        this.scoring.scoreObj(room, tell);
      }
    }
    this.events.emit({ type: 'room-entered', room: roomId, firstVisit });
  }

  // Build the JigsUpMsgs bundle from game-messages.
  private jigsUpMsgs(): JigsUpMsgs {
    return jigsUpMsgsFn;
  }

  // Build the JigsUpCallbacks bundle — called from verb layer and clock context.
  // tell:       output channel for this invocation.
  // onFatal:    RFATAL signal (verb layer: no-op; clock context: sets fatalPending).
  makeJigsUpCallbacks(tell: (s: string) => void, onFatal: () => void): JigsUpCallbacks {
    return {
      getDead:  () => this.dead,
      getLucky: () => this.lucky,
      getDeaths: () => this.deaths,
      getHere:  () => this.here,
      hasSouthTempleVisited: () => this.visited.has('SOUTH-TEMPLE'),
      getPlayer: () => this.player,

      setDead:     (v) => { this.dead = v; },
      setDeaths:   (v) => { this.deaths = v; },
      setTrollFlag: (v) => { this.flags.set('TROLL-FLAG', v); },
      setAlwaysLit: (v) => { this.alwaysLit = v; },
      scoreUpd: (delta) => { this.scoring.scoreUpd(delta); },

      tell,
      gotoRoom: (roomId) => {
        const room = this.world.get(roomId) as Room;
        this.player.moveTo(room);
        return this.onRoomEntered(room);
      },
      describeRoom: () => this.describeCurrentRoom(),
      clearContinuation: () => { this.parser.clearContinuation(); },
      finish: () => { this.doFinish(tell); },
      signalFatal: onFatal,

      world: this.world,
      clock: this.clock,
      rng:   this.rng,
    };
  }
}
