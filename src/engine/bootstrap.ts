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
import type { CombatRng } from './combat.js';
import { lookupAction } from '../actions/registry.js';
import { iMatchTick } from '../actions/light-sources.js';

import roomsData from '../data/rooms.json';
import objectsData from '../data/objects.json';

const DEFAULT_SEED = 42;
const DEFAULT_START_ROOM: ObjectId = 'WEST-OF-HOUSE';

// isInfested — 1actions.zil:3879–3884 (INFESTED? routine).
// A room is infested if it contains an ACTORBIT object that is NOT invisible.
function isInfested(room: import('../domain/game-object.js').GameObject): boolean {
  for (const obj of room.children) {
    if (obj.has(Flag.Actor) && !obj.has(Flag.Invisible)) return true;
  }
  return false;
}

/**
 * Load the real world data and return a fully-bootstrapped Game instance.
 */
export function createGame(opts: {
  startRoom?: ObjectId;
  seed?: number;
  events?: EventEmitter;
  rng?: RngInterface;
  combatRng?: CombatRng;
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

  // Load villain base strengths from STRENGTH prop — 1actions.zil:3383.
  // Each villain Actor's pStrength starts at its object's STRENGTH value.
  // The player has no STRENGTH prop; player pStrength stays 0.
  for (const obj of world.all()) {
    if (obj instanceof Actor && obj !== player) {
      const s = obj.props.get('STRENGTH');
      if (typeof s === 'number') obj.pStrength = s;
    }
  }

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

  // I-SWORD: per-turn demon (1actions.zil:3849–3877) — elvish sword glow based
  // on villain proximity. Fires every turn while enabled (turnsLeft=-1 demon).
  // Registered here so KILL-INTERRUPTS (clock.killAll) can disable it; the
  // swordFcn TAKE handler calls clock.enable('I-SWORD') which makes this live.
  //
  // Glow levels (stored in SWORD P?TVALUE):
  //   0 = none  1 = faint blue  2 = very bright
  //
  // Infested: room contains an ACTORBIT object that is NOT invisible.
  const iSwordEntry: ClockEntry = {
    id: 'I-SWORD',
    turnsLeft: -1,   // demon — fires every advance()
    enabled: false,  // armed by swordFcn on TAKE
    tick(ctx): boolean {
      const sword = world.get('SWORD');
      if (sword === undefined) return true;

      // 1actions.zil:3853: if sword not in ADVENTURER → disable demon.
      if (sword.parent !== player) {
        clock.disable('I-SWORD');
        return true;
      }

      const here = player.parent;
      if (here === null || here === undefined) return true;

      const g = (sword.props.get('TVALUE') as number | undefined) ?? 0;
      let ng = 0;

      // 1actions.zil:3854–3868: check current room first, then adjacent rooms.
      if (isInfested(here)) {
        ng = 2;
      } else {
        // Iterate exits — check each reachable adjacent room.
        for (const exit of (here as import('../domain/room.js').Room).exits) {
          if (exit.to === undefined) continue;
          const adj = world.get(exit.to);
          if (adj !== undefined && isInfested(adj)) {
            ng = 1;
            break;
          }
        }
      }

      // 1actions.zil:3869–3875: print on state change only, then update TVALUE.
      if (ng === g) return true;
      if (ng === 2) {
        ctx.tell('Your sword has begun to glow very brightly.');
      } else if (ng === 1) {
        ctx.tell('Your sword is glowing with a faint blue glow.');
      } else {
        ctx.tell('Your sword is no longer glowing.');
      }
      sword.props.set('TVALUE', ng);
      return true;
    },
  };
  clock.schedule(iSwordEntry);

  const rng = opts.rng ?? new Rng(seed);
  // Separate RNG stream for combat — same seed, independent state.
  // Prevents I-FIGHT draws from shifting the main stream used by grue / randomizeObjects.
  const combatRng: CombatRng = opts.combatRng ?? new Rng(seed);
  return new Game(world, { rng, combatRng, clock, events });
}
