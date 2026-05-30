import type { ObjectId, Dir, GameObject, ActionContext } from '../domain/game-object.js';
import type { World } from '../domain/world.js';
import { Flag } from '../domain/flags.js';
import type { Room } from '../domain/room.js';
import type { Actor } from '../domain/actor.js';
import { Clock } from './clock.js';
import type { EventEmitter } from './events.js';
import { Parser } from './parser/parser.js';
import { executeVerb } from './verbs/index.js';
import { Scoring } from './scoring.js';
import { lookupPer, lookupPreAction } from '../actions/registry.js';
import { M_BEG, M_ENTER, M_LOOK, M_END } from './messages.js';

// ---------------------------------------------------------------------------
// Public types — frozen contracts from the implementation plan.
// ---------------------------------------------------------------------------

export interface TurnResult {
  readonly output: string;
  readonly moved: boolean;
}

/**
 * Result of the PERFORM chain (runActionChain).  Mirrors the ZIL tri-state:
 *   handled  — at least one step returned truthy (ZIL RTRUE / M-HANDLED = 1)
 *   fatal    — a handler called ctx.fatal() (ZIL M-FATAL = 2)
 *
 * The caller uses `fatal` to gate M-END and continuation (P-CONT clear).
 */
export interface ChainResult {
  readonly handled: boolean;
  readonly fatal: boolean;
}

/**
 * Read-only snapshot of game state for the UI and assist layers.
 * Shape is frozen — any additions require amending the contract section
 * of the implementation plan first.
 */
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
 * Minimal RNG interface.  A concrete seeded implementation lives in rng.ts
 * (Task 2.8); tests can supply a simple closure.
 */
export interface Rng {
  /** Returns a pseudo-random float in [0, 1). */
  next(): number;
}

// ---------------------------------------------------------------------------
// Game intro — mirrors the text printed on startup in the original.
// ---------------------------------------------------------------------------

const INTRO =
  'ZORK I: The Great Underground Empire\n' +
  'Copyright (c) 1981, 1982, 1983 Infocom, Inc. All rights reserved.\n' +
  'ZORK is a registered trademark of Infocom, Inc.\n' +
  'Revision 88 / Serial number 840726\n';

// ---------------------------------------------------------------------------
// Game — the facade the UI and assist layers talk to.
// ---------------------------------------------------------------------------

export class Game {
  private readonly world: World;
  private readonly clock: Clock;
  readonly events: EventEmitter;

  private readonly parser: Parser;
  private player: Actor;
  private here: Room;

  private readonly scoring: Scoring;
  private moveCount = 0;

  /**
   * Stashed command context for M-END (gmain.zil:151–161).
   * LIVING-ROOM-FCN's M-END branch reads VERB?, PRSO, PRSI to determine whether
   * a treasure was deposited (1actions.zil:478–482), so M-END's ActionContext
   * must carry the JUST-EXECUTED command's verb/dobj/iobj, not the room defaults.
   */
  private lastVerb: string = 'look';
  private lastDobj: GameObject | undefined = undefined;
  private lastIobj: GameObject | undefined = undefined;
  private lastPrep: string | undefined = undefined;

  /** Room ids the player has visited at least once. */
  private readonly visited = new Set<ObjectId>();

  constructor(
    world: World,
    opts: { rng: Rng; clock: Clock; events: EventEmitter },
  ) {
    this.world = world;
    this.clock = opts.clock;
    this.events = opts.events;
    this.parser = new Parser();
    this.scoring = new Scoring(this.events);

    // Resolve the player actor — the Actor whose id is 'PLAYER', or the first
    // Actor found in the world when no canonical id exists (test scenarios).
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

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Print the intro banner and describe the initial room. */
  start(): string {
    const roomDesc = this.describeCurrentRoom();
    this.emitRoomEntered(this.here.id);
    return INTRO + '\n' + roomDesc;
  }

  /** Execute one command line (may contain chained commands via "then" / "."). */
  turn(input: string): TurnResult {
    const results = this.parser.parseChained(
      input,
      this.here,
      this.player,
      this.world,
    );

    const outputs: string[] = [];
    let moved = false;

    for (const pr of results) {
      if (pr.kind !== 'ok') {
        outputs.push(pr.message);
        continue;
      }

      const cmd = pr.command;

      // Resolve objects from ids (single-object callers use dobjIds?.[0]).
      const dobj = cmd.dobjIds?.[0] !== undefined ? this.world.get(cmd.dobjIds[0]!) : undefined;
      const iobj = cmd.iobjIds?.[0] !== undefined ? this.world.get(cmd.iobjIds[0]!) : undefined;

      // Stash the just-resolved command for M-END (gmain.zil:151–161).
      // LIVING-ROOM-FCN's M-END branch reads VERB?/PRSO/PRSI (1actions.zil:478–482)
      // to determine if a treasure was deposited; the stash lets runMEnd carry
      // these values in its ActionContext.
      this.lastVerb = cmd.verb;
      this.lastDobj = dobj;
      this.lastIobj = iobj;
      this.lastPrep = cmd.prep;

      // --- Action-dispatch chain (faithful to PERFORM in gmain.zil) ----------
      // Each step may RTRUE (return true) to short-circuit the remainder.  The
      // handlers print via ctx.tell into `handled`; only if no handler claims
      // the command do we fall through to the default verb routine.
      const handled: string[] = [];
      const tell = (text: string): void => {
        handled.push(text);
      };

      const prevRoom = this.here;

      // ---- 7-step PERFORM chain (gmain.zil:210–224) -------------------------
      // runActionChain covers steps 1–6.  Step 7 (executeVerb) is caller-side,
      // gated on !handled && !fatal, which is behaviourally identical to being
      // the chain's last clause (td4-perform-chain.md §4.1 row 7).
      const chainResult = this.runActionChain(
        cmd.verb, dobj, iobj, cmd.prep, cmd.preAction, tell,
      );

      if (chainResult.fatal) {
        // M-FATAL: skip M-END and abort any remaining chained commands
        // (mirrors SETG P-CONT <> at gmain.zil:161).
        outputs.push(handled.join('\n'));
        break;
      }

      if (chainResult.handled) {
        // At least one step short-circuited: step 7 (executeVerb) is suppressed.
        // Check whether a handler moved the player via ctx.moveTo(actor, dest).
        const newRoomAfterHandler = this.player.parent as Room;
        if (newRoomAfterHandler !== undefined && newRoomAfterHandler !== prevRoom) {
          moved = true;
          const enterOut = this.onRoomEntered(newRoomAfterHandler);
          const roomDesc = this.describeCurrentRoom();
          const parts = [...handled, ...(enterOut ? [enterOut] : []), roomDesc].filter(s => s.length > 0);
          outputs.push(parts.join('\n'));
        } else {
          outputs.push(handled.join('\n'));
        }
      } else {
        // No handler claimed the command — run step 7: default verb routine.
        const verbResult = executeVerb({
          verb: cmd.verb,
          dobj,
          iobj,
          prep: cmd.prep,
          player: this.player,
          here: this.here,
          world: this.world,
          perResolver: (routineName, here) => this.resolvePer(routineName, here, tell),
          mlookRunner: (room) => this.runMLook(room),
        });

        // A handler may have printed something even while falling through
        // (ZIL routines can TELL then RFALSE); prepend that output.
        const parts = [...handled, verbResult.output].filter(s => s.length > 0);
        outputs.push(parts.join('\n'));

        if (verbResult.moved) {
          moved = true;
          // Player moved — update here reference and fire room entry.
          const newRoom = this.player.parent as Room;
          if (newRoom !== undefined && newRoom !== this.here) {
            const enterOut = this.onRoomEntered(newRoom);
            if (enterOut.length > 0) {
              // M-ENTER messages (e.g. trap door crashing shut) prepend the
              // room description already appended above.
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

      // ---- M-END (gmain.zil:151–161) ----------------------------------------
      // Fires on EVERY non-fatal turn — unconditional post-turn room callback on
      // the CURRENT room (post-GOTO).  M-FATAL is already handled above (break).
      // The stashed lastVerb/lastDobj/lastIobj/lastPrep carry the just-executed
      // command so M-END handlers (e.g. LIVING-ROOM-FCN) can read VERB?/PRSO/PRSI.
      const mEndOut = this.runMEnd(this.here);
      if (mEndOut.length > 0) {
        // Append M-END output to the most recent segment's output (same turn).
        const idx = outputs.length - 1;
        if (idx >= 0) {
          outputs[idx] = [outputs[idx], mEndOut].filter(s => s.length > 0).join('\n');
        } else {
          outputs.push(mEndOut);
        }
      }

      // Keep pronoun state up to date.
      this.parser.bindPronouns(cmd);
    }

    this.moveCount += 1;
    this.clock.advance();
    this.events.emit({ type: 'turn-complete', moves: this.moveCount });

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

  // -------------------------------------------------------------------------
  // Action dispatch (PERFORM model)
  // -------------------------------------------------------------------------

  /**
   * Build the ActionContext handed to a translated ZIL routine.  `self` is the
   * object/room whose routine is running; `rarg` is the room-handler message
   * (undefined for object handlers).
   *
   * `onFatal` is an out-of-band callback called when the handler invokes
   * `ctx.fatal()` (ZIL RFATAL / M-FATAL=2).  The dispatcher reads the flag
   * after each step and propagates it via ChainResult.fatal.
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
      tell,
      hasFlag: (obj, flag) => obj.has(flag),
      setFlag: (obj, flag) => obj.set(flag),
      clearFlag: (obj, flag) => obj.clear(flag),
      moveTo: (obj, dest) => obj.moveTo(dest),
      score: (delta) => this.scoring.add(delta),
      enableClock: (id) => this.clock.enable(id),
      disableClock: (id) => this.clock.disable(id),
      /**
       * Signal M-FATAL — stops the PERFORM chain and skips M-END.
       * The handler still returns true (RTRUE) so the chain short-circuits;
       * the out-of-band `onFatal` callback lets the dispatcher know to also
       * set ChainResult.fatal = true.
       */
      fatal: onFatal ?? (() => { /* no-op when not in a dispatch chain */ }),
    };
  }

  /**
   * Run the full 7-step PERFORM dispatch chain (gmain.zil:210–224, PREDGEN
   * variant).  Each step invokes a handler; the first truthy return (ZIL RTRUE
   * = M-HANDLED) short-circuits the remaining steps.  A handler may also call
   * `ctx.fatal()` (ZIL M-FATAL = 2) to signal a fatal outcome — the dispatcher
   * sets ChainResult.fatal and the caller must skip M-END and clear any
   * continuation.
   *
   * Steps (in ZIL order):
   *   1. WINNER (actor) P?ACTION — actor-intercept (step 1: gmain.zil:211)
   *   2. room P?ACTION  rarg=M-BEG — room first-intercept (step 2: gmain.zil:212)
   *   3. PREACTIONS[verb] — verb pre-action guard (step 3: gmain.zil:213)
   *   4. PRSI P?ACTION — indirect-object handler (step 4: gmain.zil:214)
   *   5. LOC(PRSO) P?CONTFCN — container CONTFCN (step 5: gmain.zil:215–219)
   *      GUARD: PRSO exists AND verb ≠ 'walk' AND LOC(PRSO) exists
   *      [INTENTIONALLY INERT until TD-7 supplies CONTFCN extraction data;
   *      the step occupies its ordered position so TD-7 data is a drop-in.]
   *   6. PRSO P?ACTION — direct-object handler (step 6: gmain.zil:220–223)
   *      GUARD: PRSO exists AND verb ≠ 'walk'
   *   7. ACTIONS[verb] default — executeVerb (step 7: gmain.zil:224; caller-side)
   *
   * Returns ChainResult{handled, fatal}.  Step 7 is kept caller-side and gated
   * on !handled && !fatal, which is behaviourally identical to being the chain's
   * last clause (PERFORM spec §4.1 row 7).
   */
  private runActionChain(
    verb: string,
    dobj: GameObject | undefined,
    iobj: GameObject | undefined,
    prep: string | undefined,
    preAction: string | undefined,
    tell: (text: string) => void,
  ): ChainResult {
    let fatal = false;
    const onFatal = (): void => { fatal = true; };

    // Helper: make a context with the shared fatal signal.
    const ctx = (self: GameObject, rarg?: number): ActionContext =>
      this.makeContext(self, verb, dobj, iobj, prep, rarg, tell, onFatal);

    // ---- Step 1: WINNER (actor) P?ACTION (no rarg) -------------------------
    if (this.player.handler !== undefined) {
      if (this.player.handler(ctx(this.player))) {
        return { handled: true, fatal };
      }
    }

    // ---- Step 2: room P?ACTION with rarg = M-BEG ---------------------------
    if (this.here.handler !== undefined) {
      if (this.here.handler(ctx(this.here, M_BEG))) {
        return { handled: true, fatal };
      }
    }

    // ---- Step 3: PREACTIONS[verb] — PRE-* guard ----------------------------
    // The resolved command carries `preAction` (the ZIL PRE-* routine name).
    // lookupPreAction returns the registered handler, or undefined if none yet.
    if (preAction !== undefined) {
      const preHandler = lookupPreAction(preAction);
      if (preHandler !== undefined) {
        if (preHandler(ctx(dobj ?? this.here))) {
          return { handled: true, fatal };
        }
      }
    }

    // ---- Step 4: PRSI P?ACTION (no rarg) -----------------------------------
    if (iobj?.handler !== undefined) {
      if (iobj.handler(ctx(iobj))) {
        return { handled: true, fatal };
      }
    }

    // ---- Step 5: LOC(PRSO) P?CONTFCN (no rarg) ----------------------------
    // Guard: PRSO exists AND verb ≠ 'walk' AND LOC(PRSO) exists AND has contFcn.
    // INTENTIONALLY INERT: contFcn handlers are not yet extracted (TD-7 data).
    // The step occupies its ordered position so TD-7 extraction is a drop-in.
    if (verb !== 'walk' && dobj !== undefined && dobj.parent !== null && dobj.parent !== undefined) {
      const container = dobj.parent;
      if (container.contFcn !== undefined) {
        if (container.contFcn(ctx(container))) {
          return { handled: true, fatal };
        }
      }
    }

    // ---- Step 6: PRSO P?ACTION (no rarg) -----------------------------------
    // Guard: PRSO exists AND verb ≠ 'walk' (gmain.zil:220–223).
    if (verb !== 'walk' && dobj?.handler !== undefined) {
      if (dobj.handler(ctx(dobj))) {
        return { handled: true, fatal };
      }
    }

    // ---- Steps 1–6 all fell through: step 7 is caller-side (executeVerb). --
    return { handled: false, fatal };
  }

  /**
   * Resolve an `Exit.per` routine name to a destination room id, running the
   * registered PER routine.  The routine's output is written through `tell`
   * (the current command's buffer), so it prints before the destination's
   * description.  Returns undefined to block the move.
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
   * Fire room entry: run the room's M-ENTER action, update `here`, and emit
   * the room-entered event.  Returns any M-ENTER output (e.g. trap door
   * crashing shut) so the caller can prepend it to the turn transcript.
   * Mirrors GOTO in 1dungeon.zil (M-ENTER then the description produced by
   * M-LOOK).
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
    this.emitRoomEntered(room.id);
    return enterBuf.join('\n');
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private describeCurrentRoom(): string {
    const lines: string[] = [this.here.desc];

    // Room description, faithful to GOTO/M-LOOK: a room with a static ldesc
    // prints it; an action-driven room (no ldesc) emits its body via the
    // room handler with rarg = M-LOOK.
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

    const loose = Array.from(this.here.children).filter(
      o => !o.has(Flag.Invisible) && o !== this.player,
    );
    if (loose.length > 0) {
      lines.push('You can see: ' + loose.map(o => o.desc).join(', ') + '.');
    }

    return lines.join('\n');
  }

  /**
   * Run a room's M-LOOK handler and return the output.  Used as the
   * `mlookRunner` supplied to the verb layer so that "look" and movement
   * destinations both produce handler-driven descriptions for rooms that lack
   * a static ldesc.
   */
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
   *
   * Called on the CURRENT room (this.here) AFTER any GOTO that fired during the
   * chain — so "go north" fires M-END on the NEW room, not the starting room.
   * Passes the just-executed command's verb/dobj/iobj/prep so that M-END
   * handlers (e.g. LIVING-ROOM-FCN) can read VERB?/PRSO/PRSI exactly as ZIL
   * does (1actions.zil:478–482).
   *
   * Key differences from onRoomEntered (M-ENTER) and runMLook (M-LOOK):
   *   - rarg = M_END (6) instead of M_ENTER (2) or M_LOOK (3)
   *   - verb/dobj/iobj carry the just-executed command (NOT 'walk'/'look')
   *   - this.here is NOT reassigned (room entry already happened)
   *
   * The return value of the handler is currently ignored (the chain result was
   * already checked for M-FATAL before reaching here).  LIVING-ROOM-FCN returns
   * RFALSE; per spec §2 open question #4, no Zork I M-END handler is believed
   * to RFATAL, so the return value is not re-checked for M-FATAL here.
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

  private emitRoomEntered(roomId: ObjectId): void {
    const firstVisit = !this.visited.has(roomId);
    this.visited.add(roomId);
    this.events.emit({ type: 'room-entered', room: roomId, firstVisit });
  }
}
