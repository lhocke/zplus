/**
 * Bootstrap factory — builds a fully-wired Game from the real extracted world.
 *
 * createGame() is the single entry point for production and integration tests.
 * It loads rooms.json + objects.json, synthesises a PLAYER actor, places it in
 * the start room, wires the Clock (with the LanternInterrupt), an Rng, and a
 * SimpleEventEmitter, then returns a ready-to-use Game.
 *
 * The newGameAt helper in tests/helpers/new-game.ts wraps this for Phase 3
 * per-room test setup.
 */

import type { ObjectId } from '../domain/game-object.js';
import type { EventEmitter } from './events.js';
import { World } from '../domain/world.js';
import { Actor } from '../domain/actor.js';
import { Rng } from './rng.js';
import { Clock, LanternInterrupt } from './clock.js';
import { SimpleEventEmitter } from './events.js';
import { Game } from './game.js';

import roomsData from '../data/rooms.json';
import objectsData from '../data/objects.json';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BootstrapOptions {
  /**
   * Id of the room to place the player in.  Defaults to 'WEST-OF-HOUSE', the
   * canonical Zork I starting room.
   */
  startRoom?: ObjectId;
  /** Seed for the RNG.  Defaults to a fixed value so test runs are reproducible. */
  seed?: number;
  /** External event emitter.  If omitted, a fresh SimpleEventEmitter is used. */
  events?: EventEmitter;
}

const DEFAULT_SEED = 42;
const DEFAULT_START_ROOM: ObjectId = 'WEST-OF-HOUSE';

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

/**
 * Load the real world data and return a fully-bootstrapped Game instance.
 *
 * Steps:
 *  1. Build the World from the extracted rooms + objects JSON.
 *  2. Synthesise a PLAYER Actor (no parent yet).
 *  3. Register the PLAYER in the world (World.register throws on duplicate).
 *  4. Locate the start room and moveTo it.
 *  5. Create Clock + LanternInterrupt (wired to the LANTERN object if present).
 *  6. Create Rng and EventEmitter.
 *  7. Construct and return Game.
 *
 * Lantern interrupt: the Clock and LanternInterrupt are wired unconditionally;
 * the interrupt counts down from the initial 200-turn period regardless of
 * whether the player is carrying the lantern.  Full lantern-state logic
 * (only draining when lit and carried) belongs in Phase 3 action handlers.
 * TODO (Phase 3): attach the lantern interrupt only when the LANTERN object
 * has Flag.Light set and is in the player's possession, mirroring GO() from
 * 1dungeon.zil which queues I-LANTERN on the first turn the lamp is on.
 */
export function createGame(opts: BootstrapOptions = {}): Game {
  const startRoomId = opts.startRoom ?? DEFAULT_START_ROOM;
  const seed = opts.seed ?? DEFAULT_SEED;

  // 1. Build the world from the real data.  Rooms and objects are kept in
  //    separate files by the extractor; combine them here.
  const allData = [
    ...(roomsData as unknown[]),
    ...(objectsData as unknown[]),
  ];
  const world = World.fromData(allData);

  // 2 & 3. Synthesise and register the PLAYER actor.
  const player = new Actor('PLAYER', 'cretin', {
    synonyms: ['me', 'myself'],
  });
  world.register(player);

  // 4. Place player in the start room.
  const startRoom = world.get(startRoomId);
  if (startRoom === undefined) {
    throw new Error(`bootstrap: start room "${startRoomId}" not found in world data`);
  }
  player.moveTo(startRoom);

  // 5. Wire the event emitter, clock and lantern interrupt.
  const events: EventEmitter = opts.events ?? new SimpleEventEmitter();
  const clock = new Clock();

  // The LanternInterrupt is scheduled unconditionally so the clock entry
  // exists from game-start (matching gclock.zil behaviour where I-LANTERN is
  // queued by GO() during game initialisation).
  new LanternInterrupt(clock, events);

  // 6. RNG.
  const rng = new Rng(seed);

  // 7. Construct the Game.
  return new Game(world, { rng, clock, events });
}
