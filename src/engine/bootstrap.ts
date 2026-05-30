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
import { Flag } from '../domain/flags.js';
import { Rng } from './rng.js';
import { Clock, LanternInterrupt, CandleInterrupt } from './clock.js';
import type { ClockEntry } from './clock.js';
import { SimpleEventEmitter } from './events.js';
import { Game } from './game.js';
import { lookupAction } from '../actions/registry.js';
import { iMatchTick } from '../actions/light-sources.js';

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
 * Lantern interrupt: the I-LANTERN clock entry is registered at startup so the
 * slot exists from turn 0, matching GO() in 1dungeon.zil.  It starts DISABLED;
 * the LANTERN action handler (light-sources.ts) enables it on LAMP-ON and
 * disables it on LAMP-OFF, so fuel only drains while the lamp is actively
 * burning — faithfully mirroring the ZIL logic in I-LANTERN and LANTERN.
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

  // 1b. Resolve each object/room's ZIL ACTION-routine name to a translated
  //     handler from the registry and attach it.  This is the data-driven
  //     binding the dispatch chain relies on: an object with no registered
  //     routine simply has no handler and falls through to the default verb.
  for (const obj of world.all()) {
    if (obj.actionRoutine !== undefined) {
      const handler = lookupAction(obj.actionRoutine);
      if (handler !== undefined) obj.handler = handler;
    }
  }

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

  // Register the I-LANTERN clock entry so the slot exists from game-start
  // (GO() in 1dungeon.zil queues it at turn 0).  Start it DISABLED: in the
  // original, the fuel interrupt only counts down while the lamp is actively
  // on.  The LANTERN action handler (light-sources.ts) calls
  // ctx.enableClock('I-LANTERN') on LAMP-ON and ctx.disableClock('I-LANTERN')
  // on LAMP-OFF, gating drain faithfully.  Burnout turns the lamp off and
  // emits a 'lantern-fuel' event with dark:true.
  const lanternInterrupt = new LanternInterrupt(clock, events);
  lanternInterrupt.disable(); // lamp starts off — no drain until the player turns it on

  // When I-LANTERN fires the burnout event (dark:true), mark the LAMP object
  // as burned out (Flag.Burned = RMUNGBIT) and clear its light flags.
  // This mirrors <ROUTINE LIGHT-INT> in 1actions.zil:2328 which FCLEARs
  // ONBIT and FSETs RMUNGBIT when TICK=0.
  events.on('lantern-fuel', (e) => {
    if (!e.dark) return;
    const lamp = world.get('LAMP');
    if (lamp === undefined) return;
    lamp.clear(Flag.OnFire);
    lamp.clear(Flag.Light);
    lamp.set(Flag.Burned);
    // Disable the entry (it is already removed from the clock after burnout,
    // but this guards against any double-fire edge case).
    clock.disable('I-LANTERN');
  });

  // Register I-CANDLES with the GO() initial countdown of 40 turns.  The
  // candles start lit in the ZIL world data, so the interrupt starts enabled.
  // CANDLES-FCN disables it when the candles are extinguished.
  new CandleInterrupt(clock, events, 40);

  // When I-CANDLES fires the burnout event (dark:true), mark CANDLES as
  // burned out and clear their light/fire flags — mirrors LIGHT-INT with tick=0.
  events.on('candle-fuel', (e) => {
    if (!e.dark) return;
    const candles = world.get('CANDLES');
    if (candles === undefined) return;
    candles.clear(Flag.OnFire);
    candles.clear(Flag.Light);
    candles.set(Flag.Burned);
    clock.disable('I-CANDLES');
  });

  // I-MATCH clock entry: queued for 2 turns when a match is lit.  Starts
  // disabled; MATCH-FUNCTION calls enableClock('I-MATCH') on lighting and
  // disableClock('I-MATCH') on extinguishing.
  const matchOutput: string[] = [];
  const iMatchEntry: ClockEntry = {
    id: 'I-MATCH',
    turnsLeft: 2,
    enabled: false,
    tick(): boolean {
      matchOutput.length = 0;
      iMatchTick(world, (text) => matchOutput.push(text));
      // The match-burnout message surfaces via the 'lantern-fuel'-style approach
      // but for simplicity we emit a turn-complete side-channel.  The current
      // engine does not yet route clock-fired text to the transcript; wire it
      // when the transcript layer supports side-channel output.
      return false; // one-shot; remove after firing
    },
  };
  clock.schedule(iMatchEntry);

  // 6. RNG.
  const rng = new Rng(seed);

  // 7. Construct the Game.
  return new Game(world, { rng, clock, events });
}
