// death.ts — JIGS-UP machinery and its dependents.
//
// JIGS-UP        — 1actions.zil:4046–4099  (lifted from game.ts — DT1)
// RANDOMIZE-OBJECTS — 1actions.zil:4101–4123  (SD2)
// KILL-INTERRUPTS   — 1actions.zil:4125–4135  (SD3)

import type { ObjectId } from '../domain/game-object.js';
import type { World } from '../domain/world.js';
import type { Actor } from '../domain/actor.js';
import type { GameObject } from '../domain/game-object.js';
import type { Room } from '../domain/room.js';
import { Flag } from '../domain/flags.js';
import type { Clock } from './clock.js';

// Minimal RNG interface needed by RANDOMIZE-OBJECTS and jigsUp internals.
// nextInt is optional to allow game.ts's lean Rng test stubs to satisfy this;
// randomizeObjects falls back to Math.floor(next()*n) when nextInt is absent.
export interface DeathRng {
  next(): number;
  prob(base: number): boolean;
  nextInt?(n: number): number;
}

// 1dungeon.zil:2630–2633 — the 11 above-ground rooms the ZIL ABOVE-GROUND LTABLE holds.
const ABOVE_GROUND: readonly string[] = [
  'WEST-OF-HOUSE', 'NORTH-OF-HOUSE', 'EAST-OF-HOUSE', 'SOUTH-OF-HOUSE',
  'FOREST-1', 'FOREST-2', 'FOREST-3', 'PATH', 'CLEARING',
  'GRATING-CLEARING', 'CANYON-VIEW',
];

/**
 * Scatter the player's inventory on death — 1actions.zil:4101–4123.
 *
 * LAMP→LIVING-ROOM, COFFIN→EGYPT-ROOM, SWORD.TVALUE=0, then for each
 * carried item: if TVALUE>0 walk the ROOMS chain for a RLANDBIT&&!ONBIT
 * room at 50% prob; else drop in a random ABOVE_GROUND room.
 *
 * The underground walk replicates the ZIL REPEAT loop that cycles through
 * <FIRST? ROOMS> ... <NEXT? .R>, accepting each candidate at PROB 50.
 * Because the compiled room-chain order is unrecoverable from ZIL source,
 * tests assert structure (valid room type, left inventory) not exact rooms.
 */
export function randomizeObjects(world: World, player: Actor, rng: DeathRng): void {
  // Snapshot inventory before moving anything — mirrors ZIL <SET N <FIRST? WINNER>>.
  const items = Array.from(player.children);

  // Special relocations first (before the general loop, matching ZIL order).
  const lamp = world.get('LAMP');
  if (lamp !== undefined && lamp.parent === player) {
    const lr = world.get('LIVING-ROOM');
    if (lr !== undefined) lamp.moveTo(lr);
  }

  const coffin = world.get('COFFIN');
  if (coffin !== undefined && coffin.parent === player) {
    const egypt = world.get('EGYPT-ROOM');
    if (egypt !== undefined) coffin.moveTo(egypt);
  }

  // SWORD.TVALUE = 0 unconditionally — 1actions.zil:4106.
  const sword = world.get('SWORD');
  if (sword !== undefined) sword.props.set('TVALUE', 0);

  // Build the underground room list once — rooms with RLANDBIT && !ONBIT.
  // This mirrors the ZIL ROOMS chain walked by NEXT?.
  const underground: GameObject[] = world.all().filter(
    (o) => o.has(Flag.Land) && !o.has(Flag.On),
  );

  // Above-ground room objects resolved once.
  const aboveGround: Array<GameObject | undefined> = ABOVE_GROUND.map((id) => world.get(id));
  const aboveGroundResolved = aboveGround.filter((r): r is NonNullable<typeof r> => r !== undefined);

  for (const item of items) {
    // Skip LAMP and COFFIN — already handled above.
    if (item === lamp || item === coffin) continue;

    const tvalue = item.props.get('TVALUE');
    const isTreasure = typeof tvalue === 'number' && tvalue > 0;

    if (isTreasure && underground.length > 0) {
      // Walk the underground list cycling until a 50% PROB hit.
      // ZIL: <COND (<NOT .R> <SET R <FIRST? ROOMS>>)> — start from beginning each cycle.
      let placed = false;
      // Safety limit: cycle the list a bounded number of times to avoid an infinite
      // loop if every room happens to be rejected. 10 passes is generous.
      for (let pass = 0; pass < 10 && !placed; pass++) {
        for (const room of underground) {
          if (rng.prob(50)) {
            item.moveTo(room);
            placed = true;
            break;
          }
        }
      }
      // Fallback: drop in first underground room if prob never hit (degenerate case).
      if (!placed) item.moveTo(underground[0]!);
    } else {
      // Non-treasure: move to a random ABOVE_GROUND room.
      // ZIL: <RANDOM .L> where L = <GET ABOVE-GROUND 0> = 11 (the LTABLE length word).
      const n = aboveGroundResolved.length;
      const idx = rng.nextInt ? rng.nextInt(n) : Math.floor(rng.next() * n);
      const dest = aboveGroundResolved[idx];
      if (dest !== undefined) item.moveTo(dest);
    }
  }
}

// The full ZIL slot list from 1actions.zil:4126–4133.
// Registered today: I-LANTERN, I-CANDLES, I-MATCH.
// Unregistered (no-ops this phase): I-XB, I-XC, I-CYCLOPS, I-SWORD, I-FOREST-ROOM.
const INTERRUPT_IDS = [
  'I-XB', 'I-XC', 'I-CYCLOPS',
  'I-LANTERN', 'I-CANDLES', 'I-SWORD',
  'I-FOREST-ROOM', 'I-MATCH',
] as const;

/**
 * KILL-INTERRUPTS — 1actions.zil:4125–4135.
 *
 * Disables every registered slot in the 8-slot list and clears MATCH ONBIT.
 * Safe no-op for any id that is not registered in the clock.
 */
export function killInterrupts(clock: Clock, world: World): void {
  clock.killAll([...INTERRUPT_IDS]);
  const match = world.get('MATCH');
  if (match !== undefined) match.clear(Flag.OnFire);
}

// ---------------------------------------------------------------------------
// JIGS-UP — lifted from game.ts (DT1). 1actions.zil:4046–4099.
//
// All mutable game state is accessed via the JigsUpCallbacks bundle so
// this function is testable in isolation and callable from both the verb
// layer (ctx.jigsUp) and the clock context (I-FIGHT → winnerResult → jigsUp).
//
// RFATAL signal (B3): jigsUp calls cb.signalFatal() after all state changes.
// In the verb handler context this calls ctx.fatal(); in the clock context
// game.ts sets a fatalPending flag that advance()'s caller checks on return.
// ---------------------------------------------------------------------------

/** Messages for JIGS-UP — sourced from game-messages / messages.json. */
export interface JigsUpMsgs {
  talented: string;
  youHaveDied: string;
  deserveAnotherChance: string;
  suicidalManiac: string;
}

/** Callback bundle for JIGS-UP — everything jigsUp reads or writes. */
export interface JigsUpCallbacks {
  // ---- read-only state ----
  /** 1actions.zil:4049 — DEAD global. */
  getDead(): boolean;
  /** 1actions.zil:4055 — LUCKY global; controls "Bad luck, huh?" branch. */
  getLucky(): boolean;
  /** 1actions.zil:4059 — DEATHS counter. */
  getDeaths(): number;
  /** Current player location (for vehicle-eject via HERE). */
  getHere(): Room;
  /** Whether SOUTH-TEMPLE has been visited — D4. 1actions.zil:4080 TOUCHBIT check. */
  hasSouthTempleVisited(): boolean;
  /** Current player object (for vehicle check and moveTo). */
  getPlayer(): Actor;

  // ---- write state ----
  /** 1actions.zil:4048 — set DEAD global. */
  setDead(v: boolean): void;
  /** 1actions.zil:4074 — increment DEATHS. */
  setDeaths(v: number): void;
  /** 1actions.zil:4082 — set TROLL-FLAG in flag store. */
  setTrollFlag(v: boolean): void;
  /** 1actions.zil:4083 — set ALWAYS-LIT global. */
  setAlwaysLit(v: boolean): void;
  /** 1actions.zil:4098 + scoring.scoreUpd(-10). */
  scoreUpd(delta: number): void;

  // ---- actions ----
  /** Push text into the current turn's output buffer. */
  tell(text: string): void;
  /** Navigate to the named room and fire M-ENTER; return M-ENTER output (may be ''). */
  gotoRoom(roomId: ObjectId): string;
  /** Describe the newly-entered room. */
  describeRoom(): string;
  /** 1actions.zil:4097 — clear parser continuation (P-CONT). */
  clearContinuation(): void;
  /** gameOver = true — used for FINISH in 3-strike and re-death paths. */
  finish(): void;
  /** Signal M-FATAL abort so the turn does not continue (RFATAL). */
  signalFatal(): void;

  // ---- sub-functions ----
  world: World;
  clock: Clock;
  rng: DeathRng;
}

const HADES_MSG =
  'As you take your last breath, you feel relieved of your burdens. The\n' +
  'feeling passes as you find yourself before the gates of Hell, where\n' +
  'the spirits jeer at you and deny you entry.  Your senses are\n' +
  'disturbed.  The objects in the dungeon appear indistinct, bleached of\n' +
  'color, even unreal.';

/**
 * JIGS-UP — 1actions.zil:4046–4099.
 *
 * Entry point for all player-death paths (grue, combat, etc.).
 * Lifted from game.ts into death.ts (DT1); carries the
 * parser.clearContinuation() / P-CONT dependency via cb.clearContinuation().
 *
 * The Hades-vs-forest branch reads cb.hasSouthTempleVisited() (D4 — same
 * visited-set check used in PRAY resurrection; mirrors ZIL TOUCHBIT on
 * SOUTH-TEMPLE).
 *
 * After all state mutations, calls cb.signalFatal() to fire the RFATAL
 * short-circuit (B3).
 */
export function jigsUp(
  deathMessage: string,
  msgs: JigsUpMsgs,
  cb: JigsUpCallbacks,
): void {
  // 1actions.zil:4048–4053 — re-death guard: already in ghost mode.
  if (cb.getDead()) {
    cb.tell(msgs.talented);
    cb.finish();
    return;
  }

  cb.tell(deathMessage);

  // 1actions.zil:4055 — LUCKY branch: "Bad luck, huh?" when LUCKY=false.
  if (!cb.getLucky()) {
    cb.tell('Bad luck, huh?');
  }

  // 1actions.zil:4058 — SCORE-UPD -10.
  cb.scoreUpd(-10);

  cb.tell(msgs.youHaveDied);

  // 1actions.zil:4060 — vehicle-eject: <FSET? <LOC ,WINNER> ,VEHBIT> → <MOVE ,WINNER ,HERE>.
  // Move player from vehicle to HERE (their current containing room).
  const player = cb.getPlayer();
  if (player.parent !== null && player.parent.has(Flag.Vehicle)) {
    player.moveTo(cb.getHere());
  }

  // 1actions.zil:4062 — 3-strike check: <NOT <L? ,DEATHS 2>> = deaths >= 2.
  if (cb.getDeaths() >= 2) {
    cb.tell(msgs.suicidalManiac);
    cb.finish();
    return;
  }

  // 1actions.zil:4074 — increment DEATHS and resurrect.
  cb.setDeaths(cb.getDeaths() + 1);

  // 1actions.zil:4078–4092 — Hades vs forest branch.
  if (cb.hasSouthTempleVisited()) {
    // 1actions.zil:4079–4088 — ghost/Hades resurrection.
    cb.tell(HADES_MSG);
    cb.setDead(true);
    cb.setTrollFlag(true);
    cb.setAlwaysLit(true);
    const enterOut = cb.gotoRoom('ENTRANCE-TO-HADES');
    if (enterOut) cb.tell(enterOut);
    cb.tell(cb.describeRoom());
  } else {
    // 1actions.zil:4089–4092 — simple FOREST-1 resurrection.
    cb.tell(msgs.deserveAnotherChance);
    const enterOut = cb.gotoRoom('FOREST-1');
    if (enterOut) cb.tell(enterOut);
    cb.tell(cb.describeRoom());
  }

  // 1actions.zil:4094–4098 — P-CONT clear + kill interrupts.
  // <FCLEAR ,TRAP-DOOR ,TOUCHBIT> is handled by data (TRAP-DOOR TOUCHBIT already
  // cleared when the trapdoor was opened; not tracked separately).
  // Note: RANDOMIZE-OBJECTS (SD2) is called here in full ZIL, but the golden master
  // records inventory-preserved deaths; randomizeObjects must be wired here by the
  // wave that reconciles the golden (post-DT1).  killInterrupts is safe (no output).
  cb.clearContinuation();       // P-CONT = NIL — 1actions.zil:4097
  killInterrupts(cb.clock, cb.world);  // 1actions.zil:4098

  // RFATAL — abort the current turn (B3). Must be last.
  cb.signalFatal();
}
