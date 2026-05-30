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
import { lookupPer } from '../actions/registry.js';
import { M_BEG, M_ENTER, M_LOOK } from './messages.js';

// ---------------------------------------------------------------------------
// Public types — frozen contracts from the implementation plan.
// ---------------------------------------------------------------------------

export interface TurnResult {
  readonly output: string;
  readonly moved: boolean;
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
      if (pr.kind === 'empty') {
        continue;
      }

      if (pr.kind !== 'ok') {
        outputs.push(pr.message);
        continue;
      }

      const cmd = pr.command;

      // Resolve objects from ids.
      const dobj = cmd.dobjId !== undefined ? this.world.get(cmd.dobjId) : undefined;
      const iobj = cmd.iobjId !== undefined ? this.world.get(cmd.iobjId) : undefined;

      // --- Action-dispatch chain (faithful to PERFORM in gmain.zil) ----------
      // Each step may RTRUE (return true) to short-circuit the remainder.  The
      // handlers print via ctx.tell into `handled`; only if no handler claims
      // the command do we fall through to the default verb routine.
      const handled: string[] = [];
      const tell = (text: string): void => {
        handled.push(text);
      };

      const prevRoom = this.here;
      const shortCircuited = this.runActionChain(cmd.verb, dobj, iobj, cmd.prep, tell);

      if (shortCircuited) {
        // Check whether a handler moved the player via ctx.moveTo(actor, dest).
        // If so, we need to fire onRoomEntered and append the room description.
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
        // No handler claimed the command — run the default verb routine.
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
   */
  private makeContext(
    self: GameObject,
    verb: string,
    dobj: GameObject | undefined,
    iobj: GameObject | undefined,
    prep: string | undefined,
    rarg: number | undefined,
    tell: (text: string) => void,
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
    };
  }

  /**
   * Run the per-command dispatch chain, mirroring PERFORM (gmain.zil ~235).
   * Steps run in order; the first to return true (ZIL RTRUE) short-circuits
   * the rest.  Returns true if any handler claimed the command.
   *
   * Order:
   *   1. Verb PRE-action  (preAction routine — none translated yet; no-op).
   *   2. Room action with rarg = M-BEG  (current room's first intercept).
   *   3. PRSI (indirect object) handler.
   *   4. PRSO (direct object) handler.
   *   5. (caller) default verb routine, only if nothing above claimed it.
   */
  private runActionChain(
    verb: string,
    dobj: GameObject | undefined,
    iobj: GameObject | undefined,
    prep: string | undefined,
    tell: (text: string) => void,
  ): boolean {
    // 2. Room action, M-BEG.
    if (this.here.handler !== undefined) {
      const ctx = this.makeContext(this.here, verb, dobj, iobj, prep, M_BEG, tell);
      if (this.here.handler(ctx)) return true;
    }

    // 3. PRSI handler.
    if (iobj?.handler !== undefined) {
      const ctx = this.makeContext(iobj, verb, dobj, iobj, prep, undefined, tell);
      if (iobj.handler(ctx)) return true;
    }

    // 4. PRSO handler — not for WALK (matches PERFORM's `<NOT <==? .A V?WALK>>`).
    if (verb !== 'walk' && dobj?.handler !== undefined) {
      const ctx = this.makeContext(dobj, verb, dobj, iobj, prep, undefined, tell);
      if (dobj.handler(ctx)) return true;
    }

    return false;
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

  private emitRoomEntered(roomId: ObjectId): void {
    const firstVisit = !this.visited.has(roomId);
    this.visited.add(roomId);
    this.events.emit({ type: 'room-entered', room: roomId, firstVisit });
  }
}
