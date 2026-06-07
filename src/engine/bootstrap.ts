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
import type { Rng as RngInterface } from './game.js';
import { lookupAction } from '../actions/registry.js';
import { iMatchTick } from '../actions/light-sources.js';

import roomsData from '../data/rooms.json';
import objectsData from '../data/objects.json';

const DEFAULT_SEED = 42;
const DEFAULT_START_ROOM: ObjectId = 'WEST-OF-HOUSE';

/**
 * Load the real world data and return a fully-bootstrapped Game instance.
 */
export function createGame(opts: {
  startRoom?: ObjectId;
  seed?: number;
  events?: EventEmitter;
  rng?: RngInterface;
} = {}): Game {
  const startRoomId = opts.startRoom ?? DEFAULT_START_ROOM;
  const seed = opts.seed ?? DEFAULT_SEED;

  const allData = [
    ...(roomsData as unknown[]),
    ...(objectsData as unknown[]),
  ];
  const world = World.fromData(allData);

  // Bind ZIL ACTION-routine names to translated handlers from the registry.
  for (const obj of world.all()) {
    if (obj.actionRoutine !== undefined) {
      const handler = lookupAction(obj.actionRoutine);
      if (handler !== undefined) obj.handler = handler;
    }
  }

  const player = new Actor('PLAYER', 'cretin', {
    synonyms: ['me', 'myself'],
  });
  world.register(player);

  const startRoom = world.get(startRoomId);
  if (startRoom === undefined) {
    throw new Error(`bootstrap: start room "${startRoomId}" not found in world data`);
  }
  player.moveTo(startRoom);

  const events: EventEmitter = opts.events ?? new SimpleEventEmitter();
  const clock = new Clock();

  // I-LANTERN: registered at startup (GO() in 1dungeon.zil), starts disabled.
  // enableClock/disableClock in light-sources.ts gates fuel drain while the lamp burns.
  const lanternInterrupt = new LanternInterrupt(clock, events);
  lanternInterrupt.disable();

  // On burnout, mark LAMP as burned out — mirrors LIGHT-INT in 1actions.zil:2328.
  events.on('lantern-fuel', (e) => {
    if (!e.dark) return;
    const lamp = world.get('LAMP');
    if (lamp === undefined) return;
    lamp.clear(Flag.OnFire);
    lamp.clear(Flag.Light);
    lamp.set(Flag.Burned);
    clock.disable('I-LANTERN');
  });

  // I-CANDLES: queued with a 40-turn countdown at GO() but left dormant —
  // 1dungeon.zil:2641 is <QUEUE> without <ENABLE>. CANDLES-FCN arms it
  // (enableClock in light-sources.ts) only once the candles are actually lit.
  const candleInterrupt = new CandleInterrupt(clock, events, 40);
  candleInterrupt.disable();

  events.on('candle-fuel', (e) => {
    if (!e.dark) return;
    const candles = world.get('CANDLES');
    if (candles === undefined) return;
    candles.clear(Flag.OnFire);
    candles.clear(Flag.Light);
    candles.set(Flag.Burned);
    clock.disable('I-CANDLES');
  });

  // I-MATCH: queued for 2 turns when a match is lit; starts disabled.
  const iMatchEntry: ClockEntry = {
    id: 'I-MATCH',
    turnsLeft: 2,
    enabled: false,
    tick(ctx): boolean {
      iMatchTick(world, ctx.tell);
      return false;
    },
  };
  clock.schedule(iMatchEntry);

  const rng = opts.rng ?? new Rng(seed);
  return new Game(world, { rng, clock, events });
}
