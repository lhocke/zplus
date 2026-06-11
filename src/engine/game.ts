import type { ObjectId, Dir, GameObject, ActionContext } from '../domain/game-object.js';
import type { World } from '../domain/world.js';
import { Flag } from '../domain/flags.js';
import { Room } from '../domain/room.js';
import type { Actor } from '../domain/actor.js';
import { Clock } from './clock.js';
import type { EventEmitter } from './events.js';
import { Parser } from './parser/parser.js';
import { tokenize } from './parser/tokenizer.js';
import { executeVerb, describeRoomObjects, META_ACTIONS } from './verbs/index.js';
import { lit } from './parser/scope.js';
import { describeRoom as describeRoomMsgs } from './game-messages.js';
import { Scoring } from './scoring.js';
import { FlagStore } from './flag-store.js';
import { lookupPer, lookupPreAction } from '../actions/registry.js';
import { M_BEG, M_ENTER, M_LOOK, M_END } from './messages.js';
import { jigsUp as jigsUpMsgsFn } from './game-messages.js';
import { jigsUp, type JigsUpCallbacks, type JigsUpMsgs } from './death.js';
import {
  heroBlow as combatHeroBlow, findWeapon, TROLL_MELEE,
  iFight, iCure, doFight,
  type CombatRng,
  type IFightCallbacks, type ICureCallbacks, type VillainBlowCallbacks, type VillainTableEntry,
} from './combat.js';
import type { HeroBlowCallbacks } from './combat.js';
import type { VillainEntry } from '../domain/villain-entry.js';
import { makeTrollFcn } from '../actions/troll-fcn.js';

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
  // Separate RNG for combat (I-FIGHT, DO-FIGHT, VILLAIN-BLOW, HERO-BLOW, troll F_FIRST/F_BUSY).
  // Keeps combat draws from shifting the main RNG stream used by grue / randomizeObjects.
  private readonly combatRng: CombatRng;
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
  loadAllowed = 100;
  loadMax = 100;

  // Phase-3 dam/river integer globals (not boolean — stored separately from FlagStore).
  // WATER-LEVEL: maintenance-room leak depth 0–14 (-1 = repaired). 1actions.zil:1295.
  // BEACH-DIG: sandy-beach dig counter, -1 = reset sentinel. 1actions.zil:2851.
  waterLevel = 0;
  beachDig = -1;

  // Set by jigsUp when called from clock context (I-FIGHT → winnerResult → jigsUp).
  // Checked by turn() after clock.advance() to abort the remaining turn loop.
  // Cleared at the start of each new turn. (B3)
  private fatalPending = false;

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
    opts: { rng: Rng; combatRng?: CombatRng; clock: Clock; events: EventEmitter },
  ) {
    this.world = world;
    this.clock = opts.clock;
    this.rng = opts.rng;
    this.combatRng = opts.combatRng ?? (opts.rng as unknown as CombatRng);
    this.events = opts.events;
    this.parser = new Parser();
    this.flags = new FlagStore();

    // Phase-3 dam/river boolean globals — non-default (true) init values.
    // BUOY-FLAG: buoy hint not yet given. 1actions.zil:2842 <GLOBAL BUOY-FLAG T>.
    this.flags.set('BUOY-FLAG', true);

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

    // I-FIGHT: per-turn demon (1actions.zil:3810–3841, turnsLeft=-1 fires every advance).
    // I-CURE: queued countdown (1actions.zil:3593–3602, CURE_WAIT=30); starts parked (0).
    this.clock.schedule(this.makeIFightEntry());
    this.clock.schedule(this.makeICureEntry());

    // I-RFILL / I-REMPTY: replace bootstrap stubs with real tick bodies.
    // Stubs are registered by bootstrap.ts (turnsLeft=0, enabled=false) so BOLT-F can
    // call queueClock before the Game constructor runs.  We overwrite here with closures
    // that can reach game state (world, flags, player, jigsUp).
    // 1actions.zil:1226–1282 (CB-DAM2).
    this.clock.schedule(this.makeIRfillEntry());
    this.clock.schedule(this.makeIRemptyEntry());

    // I-MAINT-ROOM: every-turn demon for the maintenance-room leak.
    // Starts parked (turnsLeft=0, disabled); blue button arms it via queueClock(-1, true).
    // 1actions.zil:1343–1360 (CB-DAM3).
    this.clock.schedule(this.makeIMaintRoomEntry());
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

    // 1actions.zil:3140–3151 — LOOK only (<VERB? LOOK> tests PRSA==V?LOOK).
    // V-EXAMINE is a distinct action (gsyntax.zil:199/301) not in this clause;
    // EXAMINE / LOOK AT fall to the T-fallback below.
    if (action === 'V-LOOK') {
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

  /**
   * LOUD-ROOM input mode (OQ-1 ratified, 1actions.zil:1660–1728).
   *
   * True when the player is in LOUD-ROOM and the room is loud (not yet solved
   * by ECHO and not in the quiet dam state).  Mirrors the dead-ghost dispatch
   * seam: turn() checks this before normal action dispatch.
   */
  private isLoudRoomActive(): boolean {
    if (this.here.id !== 'LOUD-ROOM') return false;
    const loudFlag  = this.flags.get('LOUD-FLAG');
    const gatesOpen = this.flags.get('GATES-OPEN');
    const lowTide   = this.flags.get('LOW-TIDE');
    // Quiet when: LOUD-FLAG || (!GATES-OPEN && LOW-TIDE)
    return !loudFlag && !(!gatesOpen && lowTide);
  }

  /**
   * Extract the last lexed word from raw player input — mirrors ZIL's V-ECHO
   * which navigates to the last P-LEXV entry and prints its P-INBUF chars
   * (gverbs.zil:529–545).  Falls back to "echo" when no tokens (empty input).
   */
  private loudEchoWord(input: string): string {
    const tokens = tokenize(input);
    return tokens.length > 0 ? tokens[tokens.length - 1] : 'echo';
  }

  /**
   * Loud-room command interceptor — 1actions.zil:1693–1728.
   *
   * ZIL whitelist (exact):
   *   W?W/W?WEST → ROUND-ROOM, W?E/W?EAST → DAMP-CAVE, W?U/W?UP → DEEP-CANYON
   *   W?SAVE, W?RESTORE, W?Q/W?QUIT: pass through
   *   W?BUG: "That's only your opinion."  (1actions.zil:1717–1718)
   *   W?ECHO: solve — set LOUD-FLAG, clear BAR.SACREDBIT, print message, re-LOOK
   *   everything else (including parse failures, unknown words, N/S/D movement):
   *     → V-ECHO fallback — echo last lexed word twice + "..."  (gverbs.zil:529–545)
   *
   * Returns a TurnResult for intercepted commands; undefined for pass-throughs.
   */
  private loudRoomDispatch(input: string): TurnResult | undefined {
    // META_ACTIONS (SAVE/RESTORE/QUIT/BRIEF/VERBOSE/etc.): pass through before
    // attempting parse, so meta verbs always work regardless of parse result.
    // We still need the parse for ECHO/BUG/direction checks below.
    const pr = this.parser.parseSegment(input, this.here, this.player, this.world);

    if (pr.kind === 'ok') {
      const action = pr.command.action;

      // Only W/E/U are whitelist exits (1actions.zil:1711–1716).
      // N, S, D are not exits of LOUD-ROOM → echo, not pass-through.
      if (action === 'V-WALK') {
        const dir = pr.command.prep;
        if (dir === 'west' || dir === 'east' || dir === 'up') return undefined;
        // Non-exit direction: falls to echo below.
      } else if (META_ACTIONS.has(action)) {
        return undefined;
      }
    }

    const outputs: string[] = [];
    const tell = (s: string): void => { outputs.push(s); };

    // Parse to get action (may be ok or fail); on ok, check named whitelist entries.
    const action = pr.kind === 'ok' ? pr.command.action : null;

    if (action === 'V-ECHO') {
      // ECHO solve — 1actions.zil:1719–1725.
      this.flags.set('LOUD-FLAG', true);
      const bar = this.world.get('BAR');
      if (bar !== undefined) bar.clear(Flag.Sacred);
      this.parser.clearContinuation();
      tell('The acoustics of the room change subtly.');
      // <RETURN> exits the REPEAT without re-firing M-LOOK (1actions.zil:1725).
      // Player sees the normal already-TOUCHED room-entry: blank line + name + objects.
      const briefLines: string[] = ['', this.here.desc];
      describeRoomObjects(this.here, this.player, (s) => briefLines.push(s));
      tell(briefLines.join('\n'));
    } else if (action === 'V-BUG') {
      // 1actions.zil:1717–1718 — W?BUG is a named special case.
      this.parser.clearContinuation();
      tell("That's only your opinion.");
    } else {
      // All other input — parse failures, unknown words, N/S/D, any unwhitelisted
      // verb — routes to V-ECHO: echo the last lexed word twice + "..."
      // gverbs.zil:529–545: echoes P-INBUF bytes of the last P-LEXV entry.
      this.parser.clearContinuation();
      const w = this.loudEchoWord(input);
      tell(`${w} ${w} ...`);
    }

    // M-END fires each turn even in the captive loop (1actions.zil:1674–1680).
    // LOUD-ROOM-FCN M-END scrambles the player out when GATES-OPEN && !LOW-TIDE.
    const mEndPrevHere = this.here;
    const mEndOut = this.runMEnd(this.here);
    if (mEndOut.length > 0) outputs.push(mEndOut);

    // Post-M-END move: if M-END scrambled the player, fire onRoomEntered + describe.
    // Guard: new parent must be a Room (not a vehicle/container).
    const mEndNewParent = this.player.parent;
    const mEndNewRoom = mEndNewParent instanceof Room ? mEndNewParent : null;
    if (mEndNewRoom !== null && mEndNewRoom !== mEndPrevHere) {
      const enterOut = this.onRoomEntered(mEndNewRoom);
      const roomDesc = this.describeCurrentRoom();
      const parts = [enterOut, roomDesc].filter(s => s.length > 0);
      if (parts.length > 0) outputs.push(parts.join('\n'));
    }

    // Clock tick — each intercepted command consumes a turn.
    this.moveCount += 1;
    const clockLines = this.clock.advance();
    if (clockLines.length > 0) outputs.push(clockLines.join('\n'));
    this.events.emit({ type: 'turn-complete', moves: this.moveCount });
    if (this.fatalPending) {
      this.fatalPending = false;
    }
    const playerMoved = mEndNewRoom !== null && mEndNewRoom !== mEndPrevHere;
    return { output: outputs.filter(s => s.length > 0).join('\n'), moved: playerMoved };
  }

  /** Execute one command line (may contain chained commands via "then" / "."). */
  turn(input: string): TurnResult {
    if (this.gameOver) return { output: '', moved: false };
    this.fatalPending = false;

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

    // Loud-room input mode (OQ-1 ratified, CB-LOUD, 1actions.zil:1693–1728).
    // While in LOUD-ROOM and the room is loud, route every command through the
    // whitelist gate (exits/meta pass; ECHO solves; everything else → "echo echo...").
    // Mirrors the B8 dead-ghost dispatch seam.
    if (this.isLoudRoomActive()) {
      const loudResult = this.loudRoomDispatch(input);
      if (loudResult !== undefined) {
        return loudResult;
      }
      // undefined → pass-through (V-WALK exits, meta); fall into normal parse
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
          playerPStrength: this.player.pStrength,
          iCureEnabled: this.clock.getEntry('I-CURE')?.enabled ?? false,
          iCureTick: this.clock.getEntry('I-CURE')?.turnsLeft ?? 0,
          heroBlow: (targetId, weaponId) => {
            const out: string[] = [];
            const entry = this.getVillainEntry(targetId, (s) => out.push(s));
            if (entry === undefined) {
              return { output: "Violence isn't the answer to this one.", moved: false };
            }
            const cb = this.makeHeroBlowCallbacks(targetId, entry, (s) => out.push(s));
            // Resolve real descs for REMARK messages (spec §8 "use object desc").
            const villainObj = this.world.get(targetId);
            const villainDesc = villainObj?.desc ?? targetId.toLowerCase().replace(/-/g, ' ');
            const prsiObj = weaponId ? this.world.get(weaponId) : null;
            const prsiDesc = prsiObj?.desc ?? (weaponId ? weaponId.toLowerCase().replace(/-/g, ' ') : '');
            combatHeroBlow(
              targetId,
              villainDesc,
              entry,
              weaponId,
              prsiDesc,
              weaponId !== null,
              this.player.has(Flag.Staggered),
              this.scoring.score,
              this.combatRng,
              cb,
            );
            return { output: out.join('\n'), moved: false };
          },
        }, cmd.action);

        if (verbResult.fatal) {
          this.parser.setLastWon(false);
          this.parser.clearContinuation();
          if (verbResult.moved) {
            moved = true;
            const newRoom = this.currentRoom();
            if (newRoom !== null && newRoom !== this.here) {
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
          const newRoom = this.currentRoom();

          if (verbResult.movedIntoDark) {
            // Dark destination (ZIL GOTO order): darkPlaceEntered notice, then M-ENTER,
            // then describeCurrentRoom() → pitch-black message.
            let enterOut = '';
            if (newRoom !== null && newRoom !== this.here) {
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
          } else if (newRoom !== null && newRoom !== this.here) {
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
      const mEndPrevHere = this.here;
      const mEndOut = this.runMEnd(this.here);
      if (mEndOut.length > 0) {
        const idx = outputs.length - 1;
        if (idx >= 0) {
          outputs[idx] = [outputs[idx], mEndOut].filter(s => s.length > 0).join('\n');
        } else {
          outputs.push(mEndOut);
        }
      }

      // Post-M-END move detection: some M-END handlers (e.g. LOUD-ROOM-FCN panic
      // scramble) call ctx.moveTo to GOTO a new room.  Fire onRoomEntered +
      // describeCurrentRoom so this.here is updated and the new room is described.
      // Guard: new parent must be a Room (not a vehicle/container) and must differ
      // from the pre-M-END room to avoid false triggers for players inside vehicles.
      const mEndNewParent = this.player.parent;
      const mEndNewRoom = mEndNewParent instanceof Room ? mEndNewParent : null;
      if (mEndNewRoom !== null && mEndNewRoom !== mEndPrevHere) {
        moved = true;
        const enterOut = this.onRoomEntered(mEndNewRoom);
        const roomDesc = this.describeCurrentRoom();
        const parts = [enterOut, roomDesc].filter(s => s.length > 0);
        if (parts.length > 0) {
          const idx = outputs.length - 1;
          if (idx >= 0) {
            outputs[idx] = [outputs[idx], ...parts].filter(s => s.length > 0).join('\n');
          } else {
            outputs.push(parts.join('\n'));
          }
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

        // B3: I-FIGHT → jigsUp signaled RFATAL from clock context — abort turn.
        if (this.fatalPending) {
          this.fatalPending = false;
          this.parser.clearContinuation();
          break;
        }
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
      queueClock: (id, period, enabled) => this.clock.queue(id, period, enabled),
      getGlobal: (n) => this.flags.get(n),
      setGlobal: (n, v = true) => this.flags.set(n, v),
      getIntGlobal: (n) => {
        if (n === 'WATER-LEVEL') return this.waterLevel;
        if (n === 'BEACH-DIG')   return this.beachDig;
        return 0;
      },
      setIntGlobal: (n, v) => {
        if (n === 'WATER-LEVEL') { this.waterLevel = v; return; }
        if (n === 'BEACH-DIG')   { this.beachDig = v; return; }
      },
      mungRoom: (roomId, desc) => {
        const room = this.world.get(roomId);
        if (room !== undefined) room.ldesc = desc;
      },
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
   * Resolve the player's current room, accounting for vehicle containment.
   * When the player is inside a vehicle (player.parent.has(Flag.Vehicle)),
   * the room is vehicle.parent (the vehicle's parent room).
   * ZIL equivalent: <SETG HERE .RM> after <MOVE .WLOC .RM>.
   */
  private currentRoom(): Room | null {
    const loc = this.player.parent;
    if (loc === null) return null;
    if (loc instanceof Room) return loc;
    // In a vehicle: loc is the vehicle, loc.parent is the room.
    if (loc.has(Flag.Vehicle) && loc.parent instanceof Room) return loc.parent;
    // Fallback for any other non-Room container (should not occur in normal play).
    return loc instanceof Room ? loc : null;
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

  // getVillainEntry — look up the VillainEntry for a given villain object id.
  // Returns undefined for non-villains (triggers graceful "Violence isn't the answer").
  // Currently only TROLL is wired; Thief/Cyclops are built but deferred (spec §1).
  private getVillainEntry(villainId: string, tell: (s: string) => void): VillainEntry | undefined {
    if (villainId === 'TROLL') {
      const hereId = this.here.id;
      const trollFcnCtx = {
        hereId,
        getObj: (id: string) => {
          const obj = this.world.get(id);
          if (obj === undefined) return undefined;
          return {
            get parentId() { return obj.parent?.id ?? null; },
            hasFlag: (f: Flag) => obj.has(f),
            setFlag: (f: Flag) => obj.set(f),
            clearFlag: (f: Flag) => obj.clear(f),
            moveTo: (destId: string) => {
              const dest = this.world.get(destId);
              if (dest !== undefined) obj.moveTo(dest);
            },
            setLdesc: (s: string) => { (obj as { ldesc?: string }).ldesc = s; },
          };
        },
        getTrollFlag: () => this.flags.get('TROLL-FLAG'),
        setTrollFlag: (v: boolean) => { this.flags.set('TROLL-FLAG', v); },
        getLucky: () => this.lucky,
        rng: {
          prob:  (base: number) => this.combatRng.prob(base),
          zprob: (base: number, denom: number) => this.combatRng.zprob!(base, denom),
        },
        tell,
        clearContinuation: () => { this.parser.clearContinuation(); },
      };
      return {
        vBest: 'SWORD',
        vBestAdv: 1,
        vProb: 0,
        vMsgs: TROLL_MELEE,
        action: makeTrollFcn(trollFcnCtx),
      };
    }
    return undefined;
  }

  // makeHeroBlowCallbacks — build the HeroBlowCallbacks bundle for a villain.
  // HeroBlowCallbacks = VillainResultCallbacks + player-reads + stagger + weapon ops.
  private makeHeroBlowCallbacks(
    villainId: string,
    _entry: VillainEntry,
    tell: (s: string) => void,
  ): HeroBlowCallbacks {
    const villain = this.world.get(villainId);
    return {
      // Player-side reads (HeroBlowCallbacks interface)
      getPlayerPStrength: () => this.player.pStrength,
      getPlayerStaggered: () => this.player.has(Flag.Staggered),
      clearPlayerStaggered: () => { this.player.clear(Flag.Staggered); },
      getScore: () => this.scoring.score,

      // Villain pStrength (VillainResultCallbacks)
      getVillainPStrength: () => {
        const a = this.world.get(villainId);
        return (a as unknown as { pStrength: number })?.pStrength ?? 0;
      },
      setVillainPStrength: (v: number) => {
        const a = this.world.get(villainId);
        if (a !== undefined) (a as unknown as { pStrength: number }).pStrength = v;
      },

      // FSET villain FIGHTBIT — 1actions.zil:3484, called at start of HERO-BLOW.
      setVillainFightBit: () => {
        if (villain !== undefined) villain.set(Flag.Fight);
      },
      // FCLEAR villain FIGHTBIT — 1actions.zil:3569, called on villain death (DEF==0).
      clearVillainFightBit: () => {
        if (villain !== undefined) villain.clear(Flag.Fight);
      },
      setVillainStaggered: () => {
        if (villain !== undefined) villain.set(Flag.Staggered);
      },

      // Villain weapon — findWeapon by canonical name containment (spec §4.2)
      findVillainWeapon: () => {
        if (villain === undefined) return null;
        return findWeapon(villain)?.id ?? null;
      },
      disarmVillain: (wepId: string) => {
        const wep = this.world.get(wepId);
        if (wep === undefined) return;
        wep.clear(Flag.NonDescript);
        wep.set(Flag.Weapon);
        wep.moveTo(this.here);
      },

      // Remove villain from world on kill (spec §6.4 "removeCarefully")
      removeVillain: (id: string) => {
        const v = this.world.get(id);
        if (v !== undefined) v.moveTo(null);
      },

      // Apply villain F-code callback (F_DEAD / F_UNCONSCIOUS)
      applyVillainAction: (fcode: number, id: string) => {
        const entry2 = this.getVillainEntry(id, tell);
        if (entry2 !== undefined) entry2.action(fcode);
      },

      emit: tell,
    };
  }

  // Build the VILLAIN entry for DO-FIGHT's VillainTableEntry snapshot.
  // Currently only TROLL is wired; others are looked up lazily.
  private getVillainTableEntry(id: string, tell: (s: string) => void): VillainTableEntry | null {
    const villain = this.world.get(id);
    if (villain === undefined) return null;
    const entry = this.getVillainEntry(id, tell);
    if (entry === undefined) return null;
    return {
      id,
      fightBit: villain.has(Flag.Fight),
      pStrength: (villain as unknown as { pStrength: number }).pStrength ?? 0,
      entry,
      inHere: villain.parent?.id === this.here.id,
      staggered: villain.has(Flag.Staggered),
    };
  }

  // makeVillainBlowCallbacks — re-usable VillainBlowCallbacks for doFight context.
  // tell: the clock tick output channel.
  private makeVillainBlowCallbacks(tell: (s: string) => void): VillainBlowCallbacks {
    const clockFatal = (): void => { this.fatalPending = true; };
    // Tracks which villain is currently being processed by the doFight loop.
    // Set via setActiveVillain (called by doFight before each villainBlow call)
    // so that getVillainStaggered/clearVillainStaggered resolve the correct world object.
    let activeVillainId: string | undefined;
    return {
      getPlayerPStrength: () => this.player.pStrength,
      setPlayerPStrength: (v: number) => { this.player.pStrength = v; },
      getScore: () => this.scoring.score,
      jigsUp: (msg: string) => {
        jigsUp(msg, this.jigsUpMsgs(), this.makeJigsUpCallbacks(tell, clockFatal));
      },
      queueICure: (period: number) => { this.clock.queue('I-CURE', period, true); },
      getLoadAllowed: () => this.loadAllowed,
      setLoadAllowed: (v: number) => { this.loadAllowed = v; },
      getLoadMax: () => this.loadMax,
      getLucky: () => this.lucky,
      // Returns the held weapon id (for REMARK lookups done inside villainBlow).
      findPlayerWeapon: () => {
        const w = findWeapon(this.player);
        return w?.id ?? null;
      },
      // Returns the held weapon's real desc for REMARK messages — spec §8 "use object desc".
      findPlayerWeaponDesc: () => {
        const w = findWeapon(this.player);
        return w?.desc ?? null;
      },
      dropPlayerWeapon: (id: string) => {
        const wep = this.world.get(id);
        if (wep !== undefined) wep.moveTo(this.here);
      },
      // Per-villain stagger: resolved via setActiveVillain hook called by doFight.
      setActiveVillain: (id: string) => { activeVillainId = id; },
      getVillainStaggered: () => {
        if (activeVillainId === undefined) return false;
        return this.world.get(activeVillainId)?.has(Flag.Staggered) ?? false;
      },
      clearVillainStaggered: () => {
        if (activeVillainId !== undefined) {
          this.world.get(activeVillainId)?.clear(Flag.Staggered);
        }
      },
      setPlayerStaggered: () => { this.player.set(Flag.Staggered); },
      clearPlayerStaggered: () => { this.player.clear(Flag.Staggered); },
      emit: tell,
    };
  }

  // makeIFightCallbacks — IFightCallbacks for the I-FIGHT clock entry.
  private makeIFightCallbacks(tell: (s: string) => void): IFightCallbacks {
    // The active villain ids in the villain table (excludes cyclops at index 3, per spec §6.5).
    const VILLAIN_IDS = ['TROLL', 'THIEF'];  // indices 0/1 in the 0-based table (cnt=1/2 in ZIL)
    const LEN = 3;  // VILLAINS[0]=3 (troll + thief count, cyclops excluded from DO-FIGHT loop)

    const blowCbs = this.makeVillainBlowCallbacks(tell);

    return {
      getDead: () => this.dead,
      villainTable: [],  // populated dynamically in makeVillainSnapshot
      len: LEN,

      getVillainPs: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return 0;
        const v = this.world.get(id);
        return (v as unknown as { pStrength: number })?.pStrength ?? 0;
      },
      setVillainPs: (idx: number, v: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return;
        const villain = this.world.get(id);
        if (villain !== undefined) (villain as unknown as { pStrength: number }).pStrength = v;
      },

      getVProb: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return 0;
        const entry = this.getVillainEntry(id, tell);
        return entry?.vProb ?? 0;
      },
      setVProb: (idx: number, v: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return;
        // vProb is stored on the VillainEntry.  For the troll, we need a mutable vProb.
        // The VillainEntry is re-created each time getVillainEntry is called; store it
        // directly on the world object as a prop.
        const villain = this.world.get(id);
        if (villain !== undefined) villain.props.set('VPROB', v);
      },

      isThief: (idx: number) => VILLAIN_IDS[idx] === 'THIEF',
      isThiefEngrossed: () => false,  // thief deferred — always false
      setThiefEngrossed: (_v: boolean) => {},

      callVillainAction: (idx: number, fcode: number): boolean => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return false;
        const entry = this.getVillainEntry(id, tell);
        if (entry === undefined) return false;
        return entry.action(fcode);
      },

      clearFightBit: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return;
        const v = this.world.get(id);
        if (v !== undefined) v.clear(Flag.Fight);
      },
      clearStaggered: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return;
        const v = this.world.get(id);
        if (v !== undefined) v.clear(Flag.Staggered);
      },
      clearPlayerStaggered: () => { this.player.clear(Flag.Staggered); },

      onAwaken: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return;
        const v = this.world.get(id) as unknown as { pStrength: number } | undefined;
        if (v === undefined) return;
        // AWAKEN (1actions.zil:3843–3847): only fires F_CONSCIOUS when pStrength < 0.
        // A dead villain (pStrength=0) must not trigger F_CONSCIOUS — that would
        // clear TROLL-FLAG via trollFcn(F_CONSCIOUS).
        if (v.pStrength < 0) {
          v.pStrength = -v.pStrength;
          const entry = this.getVillainEntry(id, tell);
          if (entry !== undefined) entry.action(4);  // F_CONSCIOUS=4
        }
      },

      triggerFight: () => {
        // Build the villain table snapshot for this fight tick.
        const table: VillainTableEntry[] = VILLAIN_IDS.map((id) =>
          this.getVillainTableEntry(id, tell) ?? {
            id,
            fightBit: false,
            pStrength: 0,
            entry: { vBest: null, vBestAdv: 0, vProb: 0, vMsgs: [], action: () => false },
            inHere: false,
            staggered: false,
          }
        );
        // Sync live stagger/fightBit from world before passing to doFight.
        for (let i = 0; i < table.length; i++) {
          const id = VILLAIN_IDS[i]!;
          const v = this.world.get(id);
          if (v !== undefined) {
            table[i]!.fightBit = v.has(Flag.Fight);
            table[i]!.staggered = v.has(Flag.Staggered);
            table[i]!.pStrength = (v as unknown as { pStrength: number }).pStrength ?? 0;
          }
        }
        // doFight reads stagger/fightBit from the table snapshot synced above.
        // blowCbs.getVillainStaggered reads directly from the world object for
        // each villain as the loop runs — accurate because the table sync just ran.
        doFight(LEN, table, this.combatRng, blowCbs);
      },

      isVillainInHere: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return false;
        const v = this.world.get(id);
        return v?.parent?.id === this.here.id;
      },
      isVillainInvisible: (idx: number) => {
        const id = VILLAIN_IDS[idx];
        if (id === undefined) return true;
        const v = this.world.get(id);
        return v?.has(Flag.Invisible) ?? true;
      },
    };
  }

  // I-FIGHT clock entry — demon (turnsLeft=-1) registered at game start.
  // 1actions.zil:3810–3841.
  private makeIFightEntry(): import('./clock.js').ClockEntry {
    return {
      id: 'I-FIGHT',
      turnsLeft: -1,
      enabled: true,
      tick: (ctx) => {
        const ifightCbs = this.makeIFightCallbacks(ctx.tell);
        // Populate villainTable snapshot for the I-FIGHT loop.
        const VILLAIN_IDS = ['TROLL', 'THIEF'];
        const table: VillainTableEntry[] = VILLAIN_IDS.map((id) => {
          const vt = this.getVillainTableEntry(id, ctx.tell);
          if (vt !== null) return vt;
          return {
            id,
            fightBit: false,
            pStrength: 0,
            entry: { vBest: null, vBestAdv: 0, vProb: 0, vMsgs: [], action: () => false },
            inHere: false,
            staggered: false,
          };
        });
        // vProb comes from the world prop we store in setVProb.
        for (let i = 0; i < table.length; i++) {
          const id = VILLAIN_IDS[i]!;
          const villain = this.world.get(id);
          if (villain !== undefined) {
            const vp = villain.props.get('VPROB');
            table[i]!.fightBit = villain.has(Flag.Fight);
            table[i]!.staggered = villain.has(Flag.Staggered);
            table[i]!.pStrength = (villain as unknown as { pStrength: number }).pStrength ?? 0;
            if (typeof vp === 'number') {
              const entry = this.getVillainEntry(id, ctx.tell);
              if (entry !== undefined) entry.vProb = vp;
            }
          }
        }
        (ifightCbs as { villainTable: VillainTableEntry[] }).villainTable = table;
        iFight(ifightCbs, this.combatRng);
        return true;  // demon: always return true to stay registered
      },
    };
  }

  // I-CURE clock entry — queued countdown (turnsLeft starts at 0 = parked).
  // Activated by winnerResult via clock.queue('I-CURE', CURE_WAIT, true).
  // 1actions.zil:3593–3602.
  private makeICureEntry(): import('./clock.js').ClockEntry {
    return {
      id: 'I-CURE',
      turnsLeft: 0,  // parked; activated by clock.queue
      enabled: false,
      tick: (_ctx) => {
        const cb: ICureCallbacks = {
          getPlayerPStrength: () => this.player.pStrength,
          setPlayerPStrength: (v: number) => { this.player.pStrength = v; },
          getLoadAllowed: () => this.loadAllowed,
          setLoadAllowed: (v: number) => { this.loadAllowed = v; },
          getLoadMax: () => this.loadMax,
          queueICure: (period: number) => { this.clock.queue('I-CURE', period, true); },
          disableICure: () => { this.clock.disable('I-CURE'); },
        };
        iCure(cb);
        return true;  // stays registered (disable() marks it inactive when done)
      },
    };
  }

  // I-REMPTY — reservoir drains (one-shot, 8 ticks). 1actions.zil:1263–1282.
  // FSET RESERVOIR RLANDBIT; FCLEAR RESERVOIR NONLANDBIT; clear TOUCHBIT on deep-canyon
  // and loud-room; reveal TRUNK unconditionally; set LOW-TIDE=true; per-room messages.
  private makeIRemptyEntry(): import('./clock.js').ClockEntry {
    return {
      id: 'I-REMPTY',
      turnsLeft: 0,   // parked — armed by BOLT-F via queueClock('I-REMPTY', 8, true)
      enabled: false,
      tick: (ctx): boolean => {
        const res = this.world.get('RESERVOIR');
        if (res !== undefined) {
          res.set(Flag.Land);      // FSET RESERVOIR RLANDBIT
          res.clear(Flag.NonLand); // FCLEAR RESERVOIR NONLANDBIT
        }
        const dc = this.world.get('DEEP-CANYON');
        if (dc !== undefined) dc.clear(Flag.Touched);   // FCLEAR DEEP-CANYON TOUCHBIT
        const lr = this.world.get('LOUD-ROOM');
        if (lr !== undefined) lr.clear(Flag.Touched);   // FCLEAR LOUD-ROOM TOUCHBIT

        const trunk = this.world.get('TRUNK');
        if (trunk !== undefined) trunk.clear(Flag.Invisible);  // FCLEAR TRUNK INVISIBLE — always

        this.flags.set('LOW-TIDE', true);  // SETG LOW-TIDE T

        // Per-room messages — 1actions.zil:1270–1282.
        const hereId = this.here.id;
        if (hereId === 'RESERVOIR') {
          // :1271 — in vehicle (boat): boat sinks into mud. Otherwise: nothing (on-foot
          // is now safe because the reservoir drained).
          if (this.player.parent !== null && this.player.parent.has(Flag.Vehicle)) {
            ctx.tell(
              'The water level has dropped to the point at which the boat can no\n' +
              'longer stay afloat. It sinks into the mud.',
            );
          }
        } else if (hereId === 'DEEP-CANYON') {
          // :1276
          ctx.tell('The roar of rushing water is quieter now.');
        } else if (hereId === 'RESERVOIR-NORTH' || hereId === 'RESERVOIR-SOUTH') {
          // :1280
          ctx.tell(
            'The water level is now quite low here and you could easily cross over\n' +
            'to the other side.',
          );
        }

        return false;  // one-shot: remove after firing
      },
    };
  }

  // I-RFILL — reservoir fills (one-shot, 8 ticks). 1actions.zil:1226–1259.
  // FSET RESERVOIR NONLANDBIT; FCLEAR RESERVOIR RLANDBIT; clear TOUCHBIT;
  // re-hide TRUNK only if still in RESERVOIR (NM-B); set LOW-TIDE=false.
  // Flag mutations complete BEFORE jigsUp call (NM-L).
  private makeIRfillEntry(): import('./clock.js').ClockEntry {
    // LOUD-RUNS: the three possible panic-scramble destinations. 1actions.zil:1261.
    const LOUD_RUNS: readonly string[] = ['DAMP-CAVE', 'ROUND-ROOM', 'DEEP-CANYON'];

    return {
      id: 'I-RFILL',
      turnsLeft: 0,   // parked — armed by BOLT-F via queueClock('I-RFILL', 8, true)
      enabled: false,
      tick: (ctx): boolean => {
        const res = this.world.get('RESERVOIR');
        if (res !== undefined) {
          res.set(Flag.NonLand); // FSET RESERVOIR NONLANDBIT
          res.clear(Flag.Land);  // FCLEAR RESERVOIR RLANDBIT
        }
        const dc = this.world.get('DEEP-CANYON');
        if (dc !== undefined) dc.clear(Flag.Touched);
        const lr = this.world.get('LOUD-ROOM');
        if (lr !== undefined) lr.clear(Flag.Touched);

        // NM-B: re-hide trunk only if it is still in the reservoir (player may have taken it).
        // 1actions.zil:1231 <AND <IN? ,TRUNK ,RESERVOIR> <FSET ,TRUNK ,INVISIBLE>>
        const trunk = this.world.get('TRUNK');
        if (trunk !== undefined && trunk.parent === res) {
          trunk.set(Flag.Invisible);
        }

        // NM-L: LOW-TIDE flip happens BEFORE the switch/jigsUp — must not be rolled back.
        this.flags.set('LOW-TIDE', false);  // SETG LOW-TIDE <>

        // Per-room messages and conditional jigsUp — 1actions.zil:1237–1257.
        const clockFatal = (): void => { this.fatalPending = true; };
        const hereId = this.here.id;

        if (hereId === 'RESERVOIR') {
          // :1238 — in vehicle: float message. On foot: drown. (NM-L: flag mutations above already done)
          if (this.player.parent !== null && this.player.parent.has(Flag.Vehicle)) {
            ctx.tell(
              'The boat lifts gently out of the mud and is now floating on\n' +
              'the reservoir.',
            );
          } else {
            jigsUp(
              'You are lifted up by the rising river! You try to swim, but the\n' +
              'currents are too strong. You come closer, closer to the awesome\n' +
              'structure of Flood Control Dam #3. The dam beckons to you.\n' +
              'The roar of the water nearly deafens you, but you remain conscious\n' +
              'as you tumble over the dam toward your certain doom among the rocks\n' +
              'at its base.',
              this.jigsUpMsgs(),
              this.makeJigsUpCallbacks(ctx.tell, clockFatal),
            );
          }
        } else if (hereId === 'DEEP-CANYON') {
          // :1248
          ctx.tell('A sound, like that of flowing water, starts to come from below.');
        } else if (hereId === 'LOUD-ROOM') {
          // :1251 — panic scramble to a random LOUD-RUNS room
          ctx.tell(
            'All of a sudden, an alarmingly loud roaring sound fills the room.\n' +
            'Filled with fear, you scramble away.',
          );
          const idx = Math.floor(this.rng.next() * LOUD_RUNS.length);
          const destId = LOUD_RUNS[idx] ?? LOUD_RUNS[0]!;
          const dest = this.world.get(destId) as Room;
          if (dest !== undefined) {
            this.player.moveTo(dest);  // ZIL GOTO moves the player
            const enterOut = this.onRoomEntered(dest);
            if (enterOut) ctx.tell(enterOut);
            ctx.tell(this.describeCurrentRoom());
          }
        } else if (hereId === 'RESERVOIR-NORTH' || hereId === 'RESERVOIR-SOUTH') {
          // :1255
          ctx.tell(
            'You notice that the water level has risen to the point that it\n' +
            'is impossible to cross.',
          );
        }

        return false;  // one-shot: remove after firing
      },
    };
  }

  // I-MAINT-ROOM — maintenance-room leak demon. 1actions.zil:1343–1360.
  // Every-turn demon (turnsLeft=-1) armed by the blue button pushing;
  // stops itself (queue 0, disabled) when WATER-LEVEL >= 14.
  private makeIMaintRoomEntry(): import('./clock.js').ClockEntry {
    // DROWNINGS table — 1actions.zil:1284–1293 (9 strings, 0-indexed).
    const DROWNINGS: readonly string[] = [
      'up to your ankles.',
      'up to your shin.',
      'up to your knees.',
      'up to your hips.',
      'up to your waist.',
      'up to your chest.',
      'up to your neck.',
      'over your head.',
      'high in your lungs.',
    ];

    return {
      id: 'I-MAINT-ROOM',
      turnsLeft: 0,   // parked — blue button arms via queueClock(-1, true)
      enabled: false,
      tick: (ctx): boolean => {
        const hereIsMaint = this.here.id === 'MAINTENANCE-ROOM';

        // :1345 — if HERE == MAINTENANCE-ROOM, print drowning level
        if (hereIsMaint) {
          const idx = Math.floor(this.waterLevel / 2);
          const msg = DROWNINGS[idx] ?? DROWNINGS[DROWNINGS.length - 1]!;
          ctx.tell(`The water level here is now ${msg}`);
        }

        // :1347 — increment WATER-LEVEL
        this.waterLevel += 1;

        // :1348 — at or above 14: MUNG-ROOM, stop demon, maybe drown
        if (this.waterLevel >= 14) {
          const mroom = this.world.get('MAINTENANCE-ROOM');
          if (mroom !== undefined) {
            mroom.ldesc = 'The room is full of water and cannot be entered.';
          }
          // :1351 — park the demon
          this.clock.queue('I-MAINT-ROOM', 0, false);

          // :1352 — if HERE, drown
          if (hereIsMaint) {
            const clockFatal = (): void => { this.fatalPending = true; };
            jigsUp(
              "I'm afraid you have done drowned yourself.",
              this.jigsUpMsgs(),
              this.makeJigsUpCallbacks(ctx.tell, clockFatal),
            );
          }
          return true;  // demon stays registered (disabled by the queue call above)
        }

        // :1355 — player in inflated boat in dam-adjacent area → drown in boat
        // "WINNER in INFLATED-BOAT" = player.parent == INFLATED-BOAT
        const inflatedBoat = this.world.get('INFLATED-BOAT');
        if (
          inflatedBoat !== undefined &&
          this.player.parent === inflatedBoat &&
          (this.here.id === 'MAINTENANCE-ROOM' ||
           this.here.id === 'DAM-ROOM' ||
           this.here.id === 'DAM-LOBBY')
        ) {
          const clockFatal = (): void => { this.fatalPending = true; };
          jigsUp(
            'The rising water carries the boat over the dam, down the river, and over\n' +
            'the falls. Tsk, tsk.',
            this.jigsUpMsgs(),
            this.makeJigsUpCallbacks(ctx.tell, clockFatal),
          );
        }

        return true;  // demon: keep registered
      },
    };
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
