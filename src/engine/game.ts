import type { ObjectId, Dir } from '../domain/game-object.js';
import type { World } from '../domain/world.js';
import { Flag } from '../domain/flags.js';
import type { Room } from '../domain/room.js';
import type { Actor } from '../domain/actor.js';
import { Clock } from './clock.js';
import type { EventEmitter } from './events.js';
import { Parser } from './parser/parser.js';
import { executeVerb } from './verbs/index.js';

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

  private moveCount = 0;
  private scoreValue = 0;

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

      const verbResult = executeVerb({
        verb: cmd.verb,
        dobj,
        iobj,
        prep: cmd.prep,
        player: this.player,
        here: this.here,
        world: this.world,
      });

      outputs.push(verbResult.output);

      if (verbResult.moved) {
        moved = true;
        // Player moved — update here reference.
        const newRoom = this.player.parent as Room;
        if (newRoom !== undefined && newRoom !== this.here) {
          this.here = newRoom;
          this.emitRoomEntered(this.here.id);
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
      score: this.scoreValue,
      maxScore: 350,
      moves: this.moveCount,
      inMaze: this.here.has(Flag.Maze),
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private describeCurrentRoom(): string {
    const lines: string[] = [this.here.desc];
    if (this.here.ldesc) lines.push(this.here.ldesc);

    const loose = Array.from(this.here.children).filter(
      o => !o.has(Flag.Invisible) && o !== this.player,
    );
    if (loose.length > 0) {
      lines.push('You can see: ' + loose.map(o => o.desc).join(', ') + '.');
    }

    return lines.join('\n');
  }

  private emitRoomEntered(roomId: ObjectId): void {
    const firstVisit = !this.visited.has(roomId);
    this.visited.add(roomId);
    this.events.emit({ type: 'room-entered', room: roomId, firstVisit });
  }
}
