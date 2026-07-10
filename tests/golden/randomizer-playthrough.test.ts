/**
 * Golden-seed end-to-end randomizer playthroughs (Task 11).
 *
 * For each pinned golden seed, this derives a command script mechanically
 * from the fill's placements + the room graph's exits (a BFS solver over
 * rooms.json exits, reusing data already proven correct by the existing
 * map/oracle suites) and drives it turn-by-turn through the real engine
 * (`createGame` + `game.turn`), live, one command at a time — not a
 * pre-generated array replayed separately (the plan's Step 1 sketch), because
 * the thief is a genuinely wandering NPC (I-THIEF demon) whose encounters
 * can't be predicted from the graph/room data alone, and several treasures
 * (the pinned vessels' contents) can only be extracted safely once specific
 * game state is confirmed live.
 *
 * THE PROOF BAR IS A MILESTONE, NOT FULL COMPLETION (AMENDMENT 11 point 2).
 * Per pinned seed, the test asserts: no thrown error from the generator; a
 * deterministic double-run (an identical set of banked treasures and an
 * identical death count between two independent runs of the same seed); and
 * the milestone itself — at least MILESTONE_TREASURE_COUNT (5) shuffled
 * treasures banked in the trophy case, at least one of them drawn from a
 * location behind a deep-mechanism seam (river, dam, the Hades/exorcism
 * area, the coal-mine complex, or the cyclops passage — read off the
 * treasure's SHUFFLED location's region, via computeMilestone() below, not
 * its vanilla slot). The generator still plays every pinned seed as far
 * toward full completion as it can (recorded as a bonus in the survey table
 * below — `won`/score are read but not asserted); the milestone is just the
 * line the committed assertion actually holds.
 *
 * WHY A MILESTONE AND NOT "WINS THE GAME": AMENDMENT 8 already established
 * that turn/fuel budgets are deliberately NOT modeled in the logic graph —
 * matching Archipelago and universal randomizer practice, and matching
 * vanilla Zork itself, where lamp exhaustion is an authentic lose condition.
 * The fill guarantees every item is REACHABLE, not that a scripted bot can
 * reach it before some finite resource (lamp turns, the 6-light MATCH
 * budget, three combat strikes) runs out along whatever route this
 * generator happens to take. AMENDMENT 9–11 closed the worst of that gap
 * (RUSTY-KNIFE — an unconditional-death weapon — pulled from every combat
 * gate; a TORCH early-light placement constraint restoring vanilla's
 * "permanent light source reachable before the lamp runs dry" design; the
 * thief made theft-proof against the TORCH specifically, since losing it is
 * the one robbery that can cascade into genuine unwinnability; the seeded
 * lamp clock budget doubled, since blind randomized exploration is
 * structurally thirstier than vanilla's known routes) — survey evidence
 * after all of that still showed the generator dying like an unskilled
 * human on a meaningful slice of seeds (fuel exhaustion, three-strike
 * combat losses, encounters this generator has no recovery play for). Method
 * acting a genuinely skilled bot is its own project (Amendment 11 notes it
 * doubles as a future Spec-3 Archipelago test-harness seed). What this file
 * proves instead — end to end, through the real engine, no mocks — is
 * engine/graph/fill agreement on a substantive, non-trivial slice of the
 * game: the shuffle is real (treasures show up in places other than their
 * vanilla slots), a scripted player can navigate and solve a real puzzle
 * chain (dam bolt, coal machine, Hades exorcism, river crossing, or the
 * cyclops passage, depending on the seed) to reach one, and bank it. Full
 * human completion is proven separately, by playtesting (external
 * speedrunner playtesters are lined up — the shareable seed-string design
 * serves that directly).
 *
 * DEATHS ARE TOLERATED, EXCEPT ONE KIND (AMENDMENT 10 / AMENDMENT 11): an
 * ordinary death (score-scaled combat loss, a grue in the dark, drowning)
 * costs a -10 penalty and, on the third strike, ends the game — both
 * vanilla-legal outcomes this generator's `deaths` list records rather than
 * treats as failures. The one exception is a death that resurrects the
 * player into GHOST MODE (Hades' second-death resurrection, once
 * SOUTH-TEMPLE has already been visited): the engine's ghost-mode verb table
 * accepts almost nothing (no PRAY recovery is implemented by this
 * generator), so a run that lands there is permanently stuck, not merely
 * set back. `Playthrough.cmd()` hard-throws the instant the engine's own
 * ghost-resurrection banner appears (`GHOST_RESURRECTION_RE`) rather than
 * letting the script grind forward uselessly — this is the one class of
 * death this file refuses to tolerate, and it stays a hard throw regardless
 * of how the proof bar above is calibrated.
 *
 * ARCHITECTURE — placement-driven, not region-assumed. Every item this
 * script fetches is located via `locationIdByItemId.get(realItemId)` — i.e.
 * "wherever fill() actually placed the real LAMP/SCEPTRE/CHALICE/...",
 * never "whatever sits in the traditionally-named slot". A location's own
 * id (e.g. "SCEPTRE") is just a stable *slot* name inherited from vanilla's
 * item-to-slot 1:1 mapping (Task 1) — under full-item-shuffle, an entirely
 * different item can occupy that slot, and the item named SCEPTRE can be
 * sitting anywhere among the shuffle-eligible locations.
 *
 * The generator handles every puzzle chain a golden seed can route through:
 * the dam bolt (push yellow button, turn bolt with wrench, drain the
 * reservoir), the coal-machine basket trick (coal → machine → switch →
 * diamond), the Hades exorcism (bell/book/candles), the river crossing
 * (inflate/launch/drift/deflate the boat), the cyclops passage (the magic
 * word, no combat needed), the troll fight (a pre-troll weapon search that
 * only ever reaches for something surface-reachable before the troll can
 * strand it), and thief recovery (Amendment 4 makes `depositBooty` return
 * the thief's entire bag on death in seeded runs, so a stolen progression
 * item is always recoverable by hunting him down; the pinned vessels' egg
 * contents can only be extracted safely this way too, since every direct
 * `open egg` branch damages what's inside).
 *
 * EMPIRICAL GOLDEN-SEED SELECTION (Amendment 8's criterion, applied against
 * the recalibrated Amendment 11 bar): a survey generator (the same
 * `playSeed`/`computeMilestone` used here, driven by a temporary
 * `RANDOMIZER_SURVEY_SEEDS` env-var hook, stripped before commit) ran
 * candidate seeds 1 through 300 once each. 12 of 300 (4%) reached the
 * milestone with no thrown error:
 *
 *   PASSED (12): 7, 87, 126, 129, 169, 174, 199, 204, 215, 248, 291, 297
 *   PINNED (first three, ascending): 7, 87, 126 — all three re-verified with
 *   a full double-run (this file's actual committed assertion) and all
 *   three clear the bar with room to spare: seed 7 banks 15/17 shuffled
 *   treasures across 4 deep-mechanism regions (dam/mine/river/temple) and
 *   reaches full completion (won, score 350, zero deaths); seed 87 banks
 *   14/17 across the same 4 regions and stops short of full completion
 *   (score 313, zero deaths — still comfortably past the milestone); seed
 *   126 banks 15/17 across 5 regions (cyclops/dam/mine-maze/river/temple)
 *   and also reaches full completion (won, score 350, zero deaths).
 *
 *   FAILED (288) — no single class dominates; the generator fails like an
 *   unskilled human across a long tail of causes, exactly Amendment 11's
 *   own framing:
 *     69  ghost-mode death (the one hard-throw this file never tolerates —
 *         by design, not a bug; see above)
 *     42  died mid-transit through a dark room while navigating (goto)
 *     42  takeItem: the target object wasn't where the script expected
 *         (usually a downstream effect of an earlier missed pickup)
 *     27  match-budget (6 lights) exhausted mid-route with no lamp available
 *     27  river-drift timeout (the boat never reached the expected shore)
 *     21  weapon stolen mid-fight with no reachable substitute
 *     14  goto path diverged after 15 replans (state desync, usually
 *         thief-caused)
 *     14  bfsPath found no route at all between two rooms under the
 *         script's current flag state
 *      9  reclaimParked: a shed item (overload) couldn't be re-taken
 *      7  takeItem: a captive-input room echoed instead of taking
 *      5  died fighting the thief (an ordinary, tolerated death class —
 *         thrown here only because it happened during a specific
 *         emergency-recovery routine this generator gives up on afterward)
 *      4  a non-treasure progression item ended up trapped in the EGG (this
 *         generator's EGG-extraction routine only runs for treasures)
 *      3  troll-fight attempt budget exhausted without a confirmed kill
 *      2  couldn't resolve EGG's current room (NEST itself got shuffled
 *         somewhere the resolver's chain didn't expect)
 *      1  thief-hunt attempt budget exhausted without a confirmed kill
 *      1  Hades exorcism still unconfirmed after the post-thief-hunt
 *         recovery pass
 *   None of these is a single fixable many-seed bug — each is a genuine,
 *   narrow generator limitation (unmodeled fuel, an under-covered recovery
 *   path, a script assumption that doesn't hold for some placements), spread
 *   thin across many different causes. Chasing all of them down is exactly
 *   the "making the bot skilled" project Amendment 11 scoped out; 12 passing
 *   seeds is comfortably over the "at least 3" bar this task needed.
 */
import { describe, it, expect } from 'vitest';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import roomsData from '../../src/data/rooms.json' with { type: 'json' };
import objectsData from '../../src/data/objects.json' with { type: 'json' };
import { fillWithRetry } from '../../src/logic/fill.js';
import { computeReachable } from '../../src/logic/reachability.js';
import { createGame } from '../../src/engine/bootstrap.js';
import type { Game } from '../../src/engine/game.js';
import { toEnginePlacementMap } from '../../src/ui/shell.js';
import type { LogicGraph, AccessRule } from '../../src/logic/logic-graph-types.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';
import { resetThiefState } from '../../src/actions/thief-state.js';

const graph = graphData as LogicGraph;

interface RawRoom { id: string; exits?: { dir: string; to?: string; ifFlag?: string; per?: string }[]; flags?: string[] }
const rooms = roomsData as RawRoom[];
const roomById = new Map(rooms.map(r => [r.id, r]));

/** True for a naturally-lit room (rooms.json flag 'On') — no lamp needed
 *  there at all. Used by goto()'s LAMP-conservation logic. */
function roomIsLit(roomId: string): boolean {
  return roomById.get(roomId)?.flags?.includes('On') ?? false;
}
const roomIds = new Set(rooms.map(r => r.id));

interface RawObject { id: string; parent?: string | null; flags?: string[] }
const objects = objectsData as RawObject[];
const objectById = new Map(objects.map(o => [o.id, o]));

const locByIdGlobal = new Map(graph.locations.map(l => [l.id, l]));

// Module-level ZIL globals persist across createGame() calls within the same
// process (mirrors src/shell/session.ts's resetModuleGlobals) — reset before
// every game so the 3 it.each() seeds in this file never leak state.
function resetModuleGlobals(): void {
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
  resetThiefState();
}

/** Walks an object's vanilla parent chain (objects.json) to its room. Safe
 *  for rooms, vanilla-fixed furniture, and pinned vessels whose OWN vanilla
 *  parent is a room directly (BOTTLE/BUOY/COFFIN/SANDWICH-BAG/TUBE all
 *  resolve straight to a room) — none of these ever move, whether or not
 *  they were ever a shuffle target. NOT safe for EGG — see
 *  resolveCurrentRoom below. */
function resolveVanillaRoom(objectId: string, seen: Set<string> = new Set()): string | undefined {
  if (seen.has(objectId)) return undefined;
  seen.add(objectId);
  if (roomIds.has(objectId)) return objectId;
  const o = objectById.get(objectId);
  if (o === undefined || o.parent === undefined || o.parent === null) return undefined;
  return resolveVanillaRoom(o.parent, seen);
}

/**
 * Resolves objectId to its CURRENT physical room, the way resolveVanillaRoom
 * cannot for EGG: EGG's vanilla parent is NEST, and NEST — unlike the other
 * five "pinned vessel" containers — is itself `Takeable` (objects.json), so
 * it's ordinary shuffle-eligible filler under full-item-shuffle. EGG is
 * pinned (never independently reassigned by fill()), but it just rides
 * along as NEST's child wherever NEST ends up. Confirmed live: seed 1
 * shuffled NEST itself into a vessel elsewhere, and the static vanilla-chain
 * resolver sent this generator to the (now nest-less, egg-less) Up a Tree.
 * At each step, checks whether the current node was ITSELF reassigned by
 * fill() (present as a value in placements) before falling back to the
 * static objects.json parent — generic, so it's correct even if some other
 * graph edit ever introduces a second case like this.
 */
function resolveCurrentRoom(
  objectId: string,
  locationIdByItemId: ReadonlyMap<string, string>,
  seen: Set<string> = new Set(),
): string | undefined {
  if (seen.has(objectId)) return undefined;
  seen.add(objectId);
  if (roomIds.has(objectId)) return objectId;
  const locId = locationIdByItemId.get(objectId);
  if (locId !== undefined) {
    const loc = locByIdGlobal.get(locId);
    if (loc !== undefined) return resolveCurrentRoom(loc.containerId, locationIdByItemId, seen);
  }
  const o = objectById.get(objectId);
  if (o === undefined || o.parent === undefined || o.parent === null) return undefined;
  return resolveCurrentRoom(o.parent, locationIdByItemId, seen);
}

// Precompute, for every containerId appearing in the graph's locations that
// isn't itself a room id, the real room it resolves to (fixed furniture like
// MAILBOX/ALTAR/PEDESTAL/TROLL, or a pinned vessel like BOTTLE/BUOY/TUBE/
// SANDWICH-BAG — COFFIN/EGG are handled separately below, as pinned
// *treasures* fetched directly rather than opened-into). Generic — no
// hardcoded furniture list needed.
const STATIC_ROOM_OF = new Map<string, string>();
for (const loc of graph.locations) {
  if (roomIds.has(loc.containerId) || STATIC_ROOM_OF.has(loc.containerId)) continue;
  const room = resolveVanillaRoom(loc.containerId);
  if (room !== undefined) STATIC_ROOM_OF.set(loc.containerId, room);
}

const VESSELS = new Set(['BOTTLE', 'BUOY', 'COFFIN', 'EGG', 'SANDWICH-BAG', 'TUBE']);
const PINNED_TREASURE_VESSELS = new Set(['COFFIN', 'EGG']); // taken directly, never "opened into"

// Canonical noun for every item this test ever issues a TAKE/PUT for
// (progression items, all 19 treasures, and the two filler tools the
// coal-machine ritual needs). Deliberately omits every other filler id.
const NOUN: Record<string, string> = {
  LAMP: 'lamp', SWORD: 'sword', KNIFE: 'knife', 'RUSTY-KNIFE': 'knife', AXE: 'axe', SCEPTRE: 'sceptre',
  ROPE: 'rope', GARLIC: 'garlic', WRENCH: 'wrench', SHOVEL: 'shovel', PUMP: 'pump',
  'INFLATABLE-BOAT': 'boat', BELL: 'bell', BOOK: 'book', CANDLES: 'candles', MATCH: 'match',
  SCREWDRIVER: 'screwdriver', COAL: 'coal', TORCH: 'torch',
  SKULL: 'skull', CHALICE: 'chalice', TRIDENT: 'trident', COFFIN: 'coffin', JADE: 'figurine',
  'BAG-OF-COINS': 'coins', EMERALD: 'emerald', PAINTING: 'painting', BAR: 'bar',
  'POT-OF-GOLD': 'pot', BRACELET: 'bracelet', SCARAB: 'scarab', TRUNK: 'trunk',
  EGG: 'egg', CANARY: 'canary', DIAMOND: 'diamond', BAUBLE: 'bauble',
  BOTTLE: 'bottle', BUOY: 'buoy', 'SANDWICH-BAG': 'sack', TUBE: 'tube',
};

// Room-look signature text for the 3 non-treasure pinned vessels (BOTTLE/
// SANDWICH-BAG/TUBE — COFFIN/EGG are PINNED_TREASURE_VESSELS, handled
// separately) — used by Playthrough.recoverRelocatedVessel below to notice
// when one has physically moved out from under this generator's static
// room resolution. TUBE has a dedicated ldesc (objects.json); BOTTLE/
// SANDWICH-BAG fall back to the generic "There is a(n) <desc> here"/"On
// the X is a(n) <desc>" room-listing phrasing, so their signature is just
// the object's own `desc` noun phrase.
const VESSEL_SIGNATURE: Record<string, RegExp> = {
  BOTTLE: /glass bottle/i,
  'SANDWICH-BAG': /brown sack/i,
  TUBE: /tube of toothpaste/i,
};

// RUSTY-KNIFE is deliberately excluded: Flag.Weapon is set, but
// rustyKnifeFcn (src/actions/weapons.ts:87-113) makes ANY attack with it
// unconditionally fatal (REMOVE-CAREFULLY + jigsUp, no probability check) —
// a faithfully-ported vanilla curse item, never a usable weapon.
const WEAPON_IDS = ['SWORD', 'KNIFE', 'AXE', 'SCEPTRE'];

// SWORD/KNIFE/RUSTY-KNIFE are progression ONLY because Amendment 5's
// rule-cited invariant auto-promotes every Weapon-flagged item the
// cellar-core troll-passage `any` clause names (`logic-graph.json`:
// `any: [{needs:[SWORD]},{needs:[KNIFE]},{needs:[RUSTY-KNIFE]}]`) — owning
// ANY ONE of the three satisfies it, and `weapon` (whichever this generator
// actually fought the troll with) already is one of them on every pinned
// golden seed. The other two serve no further purpose once that gate is
// open: TVALUE 0 (never scored), no dependent location/rule cites them
// individually, and this generator only ever wields one weapon at a time —
// fetching (or rescuing from the troll's corpse) a redundant second/third
// copy is pure, sometimes-unrecoverable weight for zero benefit. Checked
// both in the forward-order loop and the pre-troll AXE-slot rescue (see
// each call site's own comment).
const REDUNDANT_WEAPON_CLASS = new Set(['SWORD', 'KNIFE', 'RUSTY-KNIFE']);

// The regions whose every room is naturally lit ('On', rooms.json) AND
// freely walkable with zero prerequisites — no troll, no light source, no
// items. `surface` is the obvious one; `canyon` is the other (its own
// region access is a bare `{region:"surface"}`, its rooms all carry 'On',
// and the forest path down to End of Rainbow is ungated). An earlier
// version modeled only `surface`, which under logicVersion 10's earlyLight
// fill constraint mislabeled a LAMP placed at End of Rainbow as needing a
// match-dash bootstrap — 9 of 57 survey seeds threw a spurious
// "reportable upstream gap" over placements that are physically a plain
// daylight walk.
const LIT_GROUND_REGIONS = new Set(['surface', 'canyon']);

// The two items that carry Flag.Invisible from world-init (objects.json) —
// hidden until their reveal ritual (the sceptre wave / the beach dig)
// wherever the shuffle placed them. Used to tell REVEAL-shaped location
// needs apart from physical ones: the END-OF-RAINBOW slot's
// `needs:["SCEPTRE"]` models vanilla's pot-of-gold invisibility, but the
// flag travels with the ITEM — any other occupant of that slot is
// physically takeable bare-handed, no wave needed (verified live: "take
// lamp" at End of Rainbow succeeds with nothing held).
const INVISIBLE_CLASS_ITEMS = new Set(['POT-OF-GOLD', 'SCARAB']);

function evalLitGroundOnly(rule: AccessRule, owned: ReadonlySet<string>): boolean {
  if (rule.needs !== undefined && !rule.needs.every(id => owned.has(id))) return false;
  if (rule.region !== undefined && !LIT_GROUND_REGIONS.has(rule.region)) return false;
  if (rule.all !== undefined && !rule.all.every(r => evalLitGroundOnly(r, owned))) return false;
  if (rule.any !== undefined && !rule.any.some(r => evalLitGroundOnly(r, owned))) return false;
  return true;
}

/** Fixpoint over lit-ground locations only (see LIT_GROUND_REGIONS) —
 *  approximates "obtainable with zero prior underground progress" (no
 *  weapon, no light source). Used both to pick a pre-troll weapon and to
 *  check whether LAMP itself needs a match-assisted bootstrap dash (see
 *  file header on the darkness hazard). */
function computeSurfaceOwned(placements: Record<string, string>): Set<string> {
  const itemByLoc = new Map(Object.entries(placements));
  const owned = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const loc of graph.locations) {
      if (!LIT_GROUND_REGIONS.has(loc.region)) continue;
      const item = itemByLoc.get(loc.id);
      if (item === undefined || owned.has(item)) continue;
      // Physical-access view of the slot's rule: drop the reveal-ritual
      // SCEPTRE need on the END-OF-RAINBOW slot when its occupant isn't
      // one of the Invisible-class items (see INVISIBLE_CLASS_ITEMS).
      let rule = loc.access;
      if (loc.id === 'POT-OF-GOLD' && !INVISIBLE_CLASS_ITEMS.has(item) && rule.needs !== undefined) {
        rule = { ...rule, needs: rule.needs.filter(n => n !== 'SCEPTRE') };
      }
      if (evalLitGroundOnly(rule, owned)) {
        owned.add(item);
        changed = true;
      }
    }
  }
  return owned;
}

// The one pocket of `cellar-core` that's freely walkable WITHOUT ever facing
// the troll: Cellar's own "south" exit (unconditional) reaches East of
// Chasm/Gallery/Studio, and Troll Room itself (entered from Cellar's "north",
// also unconditional — only its OWN east/west exits are troll-gated) can
// hold an item too. All are dark (need LAMP for visibility/TAKE), but
// require nothing else. A Weapon-flagged item landing here (seed 1's KNIFE,
// on the troll's own table) is just as valid a pre-combat pickup as a
// surface one — restricting the weapon search to `region: "surface"` alone
// is too conservative.
const PRE_COMBAT_POCKET_ROOMS = new Set(['CELLAR', 'TROLL-ROOM', 'EAST-OF-CHASM', 'GALLERY', 'STUDIO']);

/** True if itemId's real placement is reachable before ever facing the
 *  troll: either genuinely surface (`surfaceOwned`), or in the pocket above
 *  with an access rule needing nothing but LAMP (which — per the darkness
 *  bootstrap elsewhere — may itself need a match-dash, but never requires
 *  passing the troll). */
function isPreCombatReachable(itemId: string, placements: Record<string, string>, surfaceOwned: ReadonlySet<string>): boolean {
  if (surfaceOwned.has(itemId)) return true;
  const foundLocId = Object.entries(placements).find(([, item]) => item === itemId)?.[0];
  if (foundLocId === undefined) return false;
  const loc = locByIdGlobal.get(foundLocId);
  if (loc === undefined) return false;
  const room = roomIds.has(loc.containerId) ? loc.containerId : STATIC_ROOM_OF.get(loc.containerId);
  if (room === undefined || !PRE_COMBAT_POCKET_ROOMS.has(room)) return false;
  const needsOnlyLamp = loc.access.needs === undefined || loc.access.needs.every(n => n === 'LAMP');
  return needsOnlyLamp && loc.access.any === undefined && loc.access.all === undefined;
}

function findPreTrollWeapon(placements: Record<string, string>, surfaceOwned: ReadonlySet<string>): string {
  const found = WEAPON_IDS.find(w => isPreCombatReachable(w, placements, surfaceOwned));
  if (found === undefined) {
    throw new Error(
      `no Weapon-flagged item is reachable before the troll (surface-owned: ${[...surfaceOwned].join(',')}) — ` +
      'reportable upstream logic-graph gap (troll passage models no weapon requirement), not a script bug.',
    );
  }
  return found;
}

/** True forward-realizable progression pickup order: repeatedly add every
 *  not-yet-owned progression item whose CURRENT (post-shuffle) location is
 *  reachable given only previously-added items, to a fixpoint. Unlike
 *  `fill()`'s own `spheres` (placement order, not a collection order —
 *  see AMENDMENT 2's fixpoint-sweep note), this is directly forward-walkable.
 *  Uses the REAL `computeReachable` (same evaluator `fill()` itself uses),
 *  including its `region: "mirror"` alternative for PUMP/TRIDENT-class
 *  locations — this generator's navigator implements the physical
 *  counterpart ("rub mirror" as a synthetic bfsPath edge, see
 *  `Playthrough.bfsPath`), so forward order and physical navigation agree
 *  on which routes are real. (An earlier draft restricted mirror away here
 *  without implementing the teleport physically, which produced false
 *  "stuck" results — fill()'s assumed-fill sweep can legitimately place an
 *  item like ROPE itself behind the mirror route, since ROPE is excluded
 *  from its own assumed-owned set.) */
function computeForwardOrder(placements: Record<string, string>): string[] {
  const locationIdByItemId = new Map(Object.entries(placements).map(([loc, item]) => [item, loc]));
  const owned = new Set<string>();
  const order: string[] = [];
  const progressionItems = graph.items.filter(i => i.class === 'progression' && i.pinned !== true).map(i => i.id);
  const remaining = new Set(progressionItems);
  while (remaining.size > 0) {
    const { reachableLocations } = computeReachable(graph, { ownedItems: owned, flags: new Set() });
    let progressed = false;
    for (const item of [...remaining]) {
      const locId = locationIdByItemId.get(item);
      if (locId !== undefined && reachableLocations.has(locId)) {
        order.push(item);
        owned.add(item);
        remaining.delete(item);
        progressed = true;
      }
    }
    if (!progressed) throw new Error(`computeForwardOrder: stuck on ${[...remaining].join(',')}`);
  }
  return order;
}

/** Drives the room graph + the fill's placements into an executable script,
 *  live, against a real `Game`. `flags`/`currentRoom` track OUR OWN model of
 *  world state (flipped only once we know the corresponding action has been
 *  issued) — used purely to compute BFS paths; the real state lives in the
 *  engine and is what the test's final assertion checks. */
class Playthrough {
  currentRoom = 'WEST-OF-HOUSE';
  // COFFIN-CURE tracks hades.ts's southTempleFcn gate — South Temple's
  // "down" exit (rooms.json: ifFlag COFFIN-CURE) is blocked while the
  // player holds the coffin ("You haven't a prayer of getting the coffin
  // down there.") and open otherwise. This generator only ever holds the
  // coffin briefly (fetched then immediately deposited — see playSeed) so
  // it starts true, but takeItem()/depositAll() flip it live around that
  // window: confirmed live (seed 1) that leaving this permanently true
  // let bfsPath route a return trip straight through South Temple's "down"
  // shortcut WHILE the coffin was actually in hand, diverging from the
  // real (correctly blocked) engine.
  readonly flags = new Set<string>(['COFFIN-CURE']);
  readonly locationIdByItemId: Map<string, string>;
  /** Items already fetched — takeItem is a no-op on repeat calls. This
   *  matters beyond mere efficiency: some areas (the river/rainbow escape,
   *  the coal-machine's basket) are reachable exactly once in this script's
   *  route, so a naive duplicate takeItem call for an item already grabbed
   *  opportunistically (e.g. during doRiverJourney's sweep) would try to
   *  re-navigate to a now-unreachable room and throw, rather than harmlessly
   *  no-op like a normal duplicate TAKE would in the real engine. */
  readonly takenItems = new Set<string>();
  /** The weapon noun currently in play — set once in playSeed. Used by
   *  cmd()'s auto-recovery (see below), not for navigation. */
  weaponNoun: string | undefined;
  /** The weapon's real item id (e.g. 'SCEPTRE') — set alongside weaponNoun,
   *  cleared once the thief is confirmed dead. depositAll() must never put
   *  this item in the case while it's set: on 2 of 3 golden seeds the
   *  chosen pre-troll weapon is ALSO one of the 19 isTreasure items
   *  (SCEPTRE), so a naive "deposit every treasure" pass — the score-boost
   *  pass's own depositAll() call runs BEFORE the thief hunt — silently
   *  disarmed the player by depositing the weapon out of hand (confirmed
   *  live: seed 2's "kill thief with sceptre" failed "You can't see any
   *  sceptre here!" right after the score-boost pass's deposit). */
  weaponItemId: string | undefined;
  /** True once doThiefHunt() has confirmed the kill. Guards takeItem()
   *  against ever navigating into TREASURE-ROOM before then (see
   *  takeItem's own comment) — the thief hunt is now deferred until nearly
   *  everything else is collected (see playSeed's doThiefHunt call site),
   *  so anything genuinely placed in the Treasure Room must wait for his
   *  death rather than being fetched raw, unprotected by the
   *  diagnose/retreat cure loop. */
  thiefDead = false;
  /** Tracks whether the lamp is currently lit — kept in sync by every
   *  "turn on/off lamp" this class issues (goto()'s own conservation logic
   *  included), so goto() never needs a live world read to decide whether
   *  a toggle is actually necessary. Starts false (lamp isn't fetched yet
   *  at construction time). */
  lampOn = false;
  /** True once LAMP_TABLE's burnout sentinel (clock.ts) has fired — the
   *  lamp is then PERMANENTLY unlightable ("A burned-out lamp won't
   *  light.") for the rest of the game, never just "currently off". See
   *  cmd()'s own handling of this message for why lampOn tracking alone
   *  isn't enough (the message doesn't match the "toggle failed" patterns
   *  that would otherwise leave lampOn correctly false). */
  lampBurnedOut = false;
  /** Whether TORCH is CURRENTLY in hand (not just "was it ever taken" —
   *  `takenItems` alone can't answer that: TORCH gets deposited for real
   *  at the very end (depositAll's `keepTorch: false`) and also cycles
   *  out/back during the coal-machine's EMPTY-HANDED basket-lowering
   *  window). goto()'s lamp-conservation logic keys off THIS, not
   *  takenItems — confirmed live: leaving it keyed on takenItems meant
   *  goto() kept treating the lamp as unnecessary even after torch had
   *  actually been deposited, leaving navigation with no light source at
   *  all and dying to a grue soon after. */
  hasTorch = false;
  /** True while deliberately sitting in the dark on purpose (the thief-hunt
   *  retreat's cure-wait, and the "waiting for the thief to show up" search
   *  cycles) — cmd()'s own INVENTORY_ROBBED_RE auto-recovery must NOT
   *  relight the lamp during one of these windows just because a robbery
   *  happened to land mid-wait (robbery can strike literally any turn,
   *  including a "wait"). Confirmed live: seed 1's thief robbed the player
   *  DURING an already-in-progress, deliberately-dark cure-wait retreat,
   *  and the auto-recovery's unconditional "turn on lamp" burned fuel for
   *  the ENTIRE REMAINDER of that wait (cure times run up to ~89 moves,
   *  uncapped) — pure waste, since nothing in a cure-wait or a
   *  thief-search actually needs light (this file's own established point,
   *  repeated at every one of those call sites). Callers flip this true
   *  right before entering such a window and false right before they
   *  actually need light again. */
  darkOnPurpose = false;
  /** Set to the room TORCH was left in whenever goto() had to drop it to
   *  cross the coal-gas hazard (see goto()'s own comment) — an explicit
   *  reclaim step (playSeed, right before the final deposit) walks back
   *  and re-takes it from here. undefined once reclaimed (or if it was
   *  never dropped this way at all). */
  torchDroppedAt: string | undefined;
  /** Set to the room COAL was left in whenever takeItem()'s overload-
   *  recovery (see that method's own comment) had to shed it for some
   *  OTHER take and couldn't immediately reclaim it (the other item alone
   *  was still too heavy without coal's help). undefined once reclaimed (or
   *  if it was never left behind this way). Mirrors torchDroppedAt/
   *  reclaimTorchIfDropped — COAL is TVALUE==0 so it's exactly as
   *  vulnerable to stealJunk while sitting exposed in a room as it was
   *  before ever being fetched (see the WRENCH-detour comment), so this
   *  must be reclaimed at the first safe opportunity, not left indefinitely. */
  coalDroppedAt: string | undefined;
  /** Set to the room the current weapon was left in whenever takeItem()'s
   *  overload-recovery had to shed IT (rather than COAL) for some other
   *  take and the immediate reclaim right there also failed (see that
   *  method's own comment). undefined once reclaimed (or if it was never
   *  left behind this way). Mirrors coalDroppedAt/reclaimCoalIfDropped —
   *  the weapon is very often ordinary TVALUE==0 filler (KNIFE/SWORD/AXE),
   *  exactly as vulnerable to thief.ts's stealJunk while sitting exposed as
   *  COAL is, and — unlike a TVALUE>0 treasure — never returned by
   *  depositBooty if genuinely stolen, so this must be reclaimed (or
   *  substituted) at the first safe opportunity. */
  weaponDroppedAt: string | undefined;
  /** Set to the room SCREWDRIVER was left in whenever COFFIN's own overload
   *  recovery (see takeItem()'s PINNED_TREASURE_VESSELS branch) had to shed
   *  it to make room for the coffin itself. undefined once reclaimed (or
   *  if it was never left behind this way). Always the SAME room COFFIN
   *  was just fetched from (SCREWDRIVER is deliberately extracted from the
   *  coffin's interior immediately beforehand — see that call site's own
   *  comment — so this is a same-room, short-lived shed, reclaimed right
   *  after COFFIN is deposited and frees its own 55 SIZE, not a
   *  cross-map one like torchDroppedAt/coalDroppedAt can be). */
  screwdriverDroppedAt: string | undefined;
  /** Set to the room GARLIC was left in whenever COFFIN/EGG's own overload
   *  recovery (see takeItem()'s PINNED_TREASURE_VESSELS branch) had to
   *  shed it. undefined once reclaimed (or if it was never left behind
   *  this way). Mirrors coalDroppedAt/screwdriverDroppedAt — GARLIC is
   *  needed EVERY time Bat Room is crossed (bat protection), not just
   *  once, and the coal-machine section's own route crosses it again this
   *  late in the game, so — unlike an earlier version of this tier
   *  assumed — it is never safe to abandon permanently. */
  garlicDroppedAt: string | undefined;
  /** Running count of successful "light match" commands this generator has
   *  issued, from ANY call site (goto()'s own per-step fallback,
   *  gotoWithMatch(), the Hades exorcism, the COFFIN/EGG "too dark"
   *  retry). Tracked centrally in cmd() (see its own comment) against the
   *  SAME MATCH-COUNT(6) budget the real engine enforces (clock.ts) — lets
   *  goto() reason about whether it can afford a dark step BEFORE
   *  attempting it, rather than discovering the budget is spent via a
   *  failed command (or a random grue death) after the fact. */
  matchesUsed = 0;
  /** Every death this playthrough has hit, recorded (not thrown — AMENDMENT
   *  10 drops the zero-death bar). death.ts's jigsUp scatters the player's
   *  entire held inventory and teleports to FOREST-1/ENTRANCE-TO-HADES; a
   *  death before the trophy case ever reaches exactly 350 makes the run
   *  permanently unwinnable on its own (WEST-OF-HOUSE's barrow exit is
   *  gated `ifFlag: WON-FLAG`, and WON-FLAG only ever latches at SCORE===350
   *  — gverbs.zil's own SCORE-UPD, faithfully ported — so a death's
   *  permanent -10 forecloses that exact value for the rest of the game).
   *  No special recovery is attempted here: cmd()'s existing
   *  post-every-command `this.currentRoom = this.game.view().here` resync
   *  already keeps navigation correct after a death-teleport, and an
   *  unrecoverable one fails this seed's survey candidacy loudly later
   *  (a missing item, a "no route" BFS error, or gameOver never firing) —
   *  never a silent false pass, since the final assertion checks the
   *  engine's own victory text, not just gameOver. */
  readonly deaths: string[] = [];

  constructor(
    private readonly game: Game,
    readonly placements: Record<string, string>,
  ) {
    this.locationIdByItemId = new Map(Object.entries(placements).map(([loc, item]) => [item, loc]));
  }

  /** The thief (and the troll, mid-fight) can disarm the player at ANY
   *  point — not just during a deliberate "kill X" command — via a
   *  wandering random encounter on an ordinary movement turn (confirmed
   *  live: seed 1's knife was knocked away by the thief during a plain
   *  "east" between rooms). combat.ts's dropPlayerWeapon always drops the
   *  weapon in the player's CURRENT room, so recovery is always just a
   *  same-turn "take <weapon>" — done automatically here so the rest of
   *  this script doesn't need a disarm check after every single command. */
  private static readonly DISARM_RE =
    /goes flying|falls to the floor|drops to the floor|knocks it spinning|out of your hand/i;

  /** death.ts's exact jigsUp banner (messages.json's youHaveDied) — printed
   *  on EVERY death, whether or not it's the terminal (3rd) one. Detected
   *  here rather than via `gameOver()`: death.ts only sets the engine's own
   *  gameOver flag on the 3rd death (the "3-strike" FINISH) or on winning —
   *  the 1st/2nd deaths are, by design, recoverable (SCORE-UPD -10, then a
   *  FOREST-1/Hades respawn) and `gameOver()` stays false straight through
   *  them (confirmed live: a `p.gameOver()` check placed right after a
   *  fatal "diagnose" call never fired — the death was real but not
   *  terminal). This test's own scoring floor (file header) requires EXACT
   *  350 with zero deaths — death.ts's -10 penalty makes that permanently
   *  unreachable after even one recoverable death — so ANY death here,
   *  terminal or not, is a hard failure for this playthrough and must be
   *  caught at the exact command that caused it, not left to cascade
   *  through however many further commands a since-respawned, teleported,
   *  inventory-stripped player happens to blunder through before some much
   *  later, unrelated-looking assertion finally trips. AMENDMENT 10 drops
   *  the exact-350/zero-death floor this comment originally described — see
   *  the death-handling block at this pattern's call site for the bar that
   *  replaced it (deaths are recorded, not thrown, UNLESS they resurrect
   *  the player into ghost mode — see GHOST_RESURRECTION_RE). */
  private static readonly DEATH_RE = /\*{4}\s*You have died\s*\*{4}/;

  /** death.ts's jigsUp takes one of two resurrection branches: a simple
   *  FOREST-1 respawn (alive, inventory scattered but otherwise ordinary),
   *  or — once SOUTH-TEMPLE has ever been visited, true for essentially
   *  every route this generator takes — a GHOST resurrection at Entrance to
   *  Hades (HADES_MSG, death.ts). Ghost mode (game.ts's `dead` flag) is not
   *  a minor inconvenience: DEAD-FUNCTION intercepts TAKE/RUB/DROP/THROW/
   *  INVENTORY/DIAGNOSE with flavor-text no-ops ("Your hand passes through
   *  its object.", etc.) for every verb this generator relies on, and the
   *  ONLY way out is PRAY while standing in SOUTH-TEMPLE (game.ts's V-PRAY
   *  handler) — a whole recovery routine this generator has no equivalent
   *  of anywhere else. Confirmed live, seed 13: an untreated ghost death
   *  left "rub mirror" silently no-opping ("hand passes through") for the
   *  rest of the run, burning the entire replan budget on a divergence that
   *  was never actually about routing. Detected via HADES_MSG's own
   *  signature line (death.ts) so a ghost death can be told apart from the
   *  ordinary FOREST-1 one without duplicating hasSouthTempleVisited()'s
   *  own logic here. */
  private static readonly GHOST_RESURRECTION_RE = /relieved of your burdens/i;

  /** thief.ts's rob() steals EVERY currently-held TVALUE>0 item in one go
   *  (i-thief.ts's ctx.rob('PLAYER', 'THIEF'), no per-item probability gate)
   *  — TORCH (TVALUE=6) is exactly this kind of target, and it's carried
   *  for a very long stretch as this generator's permanent lamp substitute.
   *  Matches BOTH of i-thief.ts's inventory-theft phrasings ("wandered
   *  through... abstracted some valuables from your possession" when not
   *  directly visible, "robbed you blind" when he's standing right there) —
   *  deliberately broader than just thief.ts's own "left you in the dark"
   *  sub-message: confirmed live (seed 1) that a robbery which DID steal the
   *  torch was followed by a dark-room grue death one move later WITHOUT
   *  that sub-message ever printing, so waiting for it specifically misses
   *  real cases. Reacting to every inventory robbery costs nothing when
   *  light wasn't actually the thing lost (an extra, harmless "turn on
   *  lamp"). `hasTorch` only updates on takeItem()/depositAll() calls this
   *  generator itself issues, so it can't see this any other way. */
  private static readonly INVENTORY_ROBBED_RE = /abstracted some valuables from your possession|robbed you blind/i;

  async cmd(c: string): Promise<string> {
    const before = this.currentRoom;
    const r = await this.game.turn(c);
    if (process.env.DEBUG_RANDOMIZER !== undefined) {
      // eslint-disable-next-line no-console
      console.log(`[${before}] > ${c}\n${r.output}\n`);
    }
    if (Playthrough.DEATH_RE.test(r.output)) {
      // Ghost-mode deaths are NOT tolerated (see GHOST_RESURRECTION_RE's own
      // doc comment) — this generator has no PRAY-at-SOUTH-TEMPLE recovery
      // routine, and every verb it depends on becomes a flavor-text no-op
      // until one exists, so continuing would just cascade into an
      // unrelated-looking failure far from the real cause. Thrown here,
      // loudly and specifically, rather than left to surface as a confusing
      // "diverged after N replans" or "can't see any X" much later.
      if (Playthrough.GHOST_RESURRECTION_RE.test(r.output)) {
        throw new Error(
          `player died into ghost mode: "${c}" in ${before} — SOUTH-TEMPLE was already visited, so death.ts's ` +
          'Hades resurrection applies; this generator has no PRAY recovery, not a tolerable AMENDMENT 10 death.',
        );
      }
      // Ordinary (non-ghost) death: record, don't throw (AMENDMENT 10) —
      // see the `deaths` field's own comment for why no bespoke recovery is
      // attempted beyond this. Clear the "light source currently in hand"
      // tracking since death.ts's randomizeObjects scatters whatever was
      // carried (LAMP always resurfaces in Living Room, everything else
      // lands wherever the RNG sends it); leaving these stale-true would
      // make goto() skip needed relighting.
      this.deaths.push(`"${c}" in ${before} -> ${JSON.stringify(r.output)}`);
      this.lampOn = false;
      this.hasTorch = false;
    }
    if (Playthrough.INVENTORY_ROBBED_RE.test(r.output)) {
      this.hasTorch = false; // torch (TVALUE>0) may well have been among what was robbed
      // Do NOT relight if we're deliberately sitting in the dark right now
      // (see darkOnPurpose's own doc comment) — a robbery can strike on
      // literally any turn, including a "wait" inside an already-in-progress
      // cure-wait or thief-search, and relighting there just burns fuel for
      // no benefit until the caller's own logic decides light is needed
      // again.
      if (!this.darkOnPurpose) {
        const recover = await this.game.turn('turn on lamp');
        // Same burnout-detection this method's own main body applies to
        // every OTHER command's output (see below) — the recovery attempt
        // itself is just as capable of hitting LAMP_TABLE's burnout
        // sentinel as any other "turn on lamp" call, and missing it here
        // has a worse consequence than elsewhere: confirmed live, seed 1,
        // this exact recovery attempt printed "A burned-out lamp won't
        // light." (matches neither "can't see any" nor "don't see") and
        // the naive `!test(...)` check below used to read that as SUCCESS,
        // setting lampOn=true for a lamp that was — and remains —
        // genuinely dead. Every subsequent goto() then trusted that
        // phantom light and skipped its own match-fallback entirely (the
        // `!this.lampOn` gate), walking the next dark room completely
        // blind and dying to a grue.
        if (/burned-out lamp won't light|You'd better have more light than from the brass lantern/i.test(recover.output)) {
          this.lampBurnedOut = true;
          this.lampOn = false;
        } else if (!/can't see any|don't see/i.test(recover.output)) {
          this.lampOn = true;
        }
        if (process.env.DEBUG_RANDOMIZER !== undefined) {
          // eslint-disable-next-line no-console
          console.log(`[auto-recover] > turn on lamp\n${recover.output}\n`);
        }
      }
    }
    if (this.weaponNoun !== undefined && Playthrough.DISARM_RE.test(r.output)) {
      const recover = await this.game.turn(`take ${this.weaponNoun}`);
      if (process.env.DEBUG_RANDOMIZER !== undefined) {
        // eslint-disable-next-line no-console
        console.log(`[auto-recover] > take ${this.weaponNoun}\n${recover.output}\n`);
      }
    }
    // Source of truth: sync from the real engine after EVERY command, rather
    // than trusting our own "this move should have succeeded" bookkeeping.
    // A silent divergence here (a movement failing for a reason our BFS
    // model didn't predict — an extra grue/thief encounter, a mistimed
    // river-drift assumption) used to cascade into every subsequent
    // navigation call silently computing routes from the WRONG room —
    // confirmed live (seed 1: a mistimed river-drift wait schedule left
    // the model 1 room behind reality for the rest of the game, and every
    // take/deposit after silently no-op'd instead of throwing).
    this.currentRoom = this.game.view().here;
    // Track lamp on/off centrally (every call site, including goto()'s own
    // conservation logic) rather than updating a flag at each of the several
    // "turn on/off lamp" call sites individually — one place to keep right.
    // "can't see any lamp" (not holding it) was assumed to be the only
    // realistic failure mode here — WRONG: LAMP_TABLE's burnout sentinel
    // (clock.ts) makes the lamp PERMANENTLY unlightable once its 385-turn
    // budget is spent ("A burned-out lamp won't light."), and that message
    // matches neither "can't see any" nor "don't see" — confirmed live,
    // seed 2: this silently recorded lampOn=true for a dead lamp, and every
    // downstream goto()/darkness decision trusted that phantom light for
    // the rest of the game, sending navigation straight into unlit rooms
    // ("It's too dark to see!" on the very next take attempt) instead of
    // ever recognizing there was no light left at all.
    const cmdLower = c.trim().toLowerCase();
    // Two DISTINCT burnout phrasings exist, not one: "A burned-out lamp
    // won't light." (a LATER "turn on" attempt against an already-dead
    // lamp) and "You'd better have more light than from the brass
    // lantern." (clock.ts's LIGHT-INT sentinel, printed the SAME turn the
    // 385-turn LAMP_TABLE budget actually expires — during whatever
    // ordinary command happened to be current, not just a toggle attempt).
    // Only the first was detected here — confirmed live, seed 3: the
    // sentinel fired mid-navigation (a plain "west" between maze rooms),
    // this generator's own lampOn bookkeeping stayed stale-true (neither
    // regex matched), and the very next move walked into another unlit
    // room believing light was still available, dying to a grue.
    if (/burned-out lamp won't light|You'd better have more light than from the brass lantern/i.test(r.output)) {
      this.lampBurnedOut = true;
      this.lampOn = false;
    } else if (!/can't see any|don't see/i.test(r.output)) {
      if (cmdLower === 'turn on lamp') this.lampOn = true;
      else if (cmdLower === 'turn off lamp') this.lampOn = false;
    }
    // Track MATCH-COUNT(6, clock.ts) usage centrally — every "light match"
    // this generator issues, from any call site, decrements the SAME
    // global engine budget, and this is the one place ALL of them pass
    // through. "starts to burn" is the exact, unambiguous success text
    // (matchFunction, src/actions/light-sources.ts) — never matches a
    // failure ("too dark to see", "run out of matches"). Used by goto()'s
    // own budget check to fail loudly (a clear, catchable error) instead
    // of blindly walking a dark room it can no longer light, gambling on
    // the 80%-probability grue check.
    if (cmdLower === 'light match' && /starts to burn/i.test(r.output)) {
      this.matchesUsed++;
    }
    // See recoverRelocatedVessel's own doc comment — cheap on the
    // overwhelming majority of turns (3 substring tests, no match).
    await this.recoverRelocatedVessel(r.output);
    await this.recoverStrandedCoal(r.output);
    return r.output;
  }

  gameOver(): boolean {
    return this.game.view().gameOver;
  }

  /** Returns both the direction commands AND the room visited after each
   *  one — the room sequence lets goto() decide, up front, whether the
   *  WHOLE upcoming path ever needs light (see the LAMP conservation
   *  comment in goto()). */
  bfsPathWithRooms(from: string, to: string, avoid?: ReadonlySet<string>): { dirs: string[]; rooms: string[] } {
    if (from === to) return { dirs: [], rooms: [] };
    const queue: { room: string; dirs: string[]; rooms: string[] }[] = [{ room: from, dirs: [], rooms: [] }];
    const seen = new Set([from]);
    while (queue.length > 0) {
      const { room, dirs, rooms } = queue.shift()!;
      const exits = [...(roomById.get(room)?.exits ?? [])];
      // "rub mirror" (no instrument) swaps + teleports between the two
      // mirror rooms (src/actions/mirror.ts / tools/oracle/corpus/mirror.txt)
      // — a real action, not a rooms.json exit, so it's synthesized here.
      // This is the physical route the logic graph's `region: "mirror"`
      // alternative (PUMP/TRIDENT, and anything fill() placed behind it —
      // see computeForwardOrder's doc comment) actually resolves to.
      if (room === 'MIRROR-ROOM-1') exits.push({ dir: 'rub mirror', to: 'MIRROR-ROOM-2' });
      if (room === 'MIRROR-ROOM-2') exits.push({ dir: 'rub mirror', to: 'MIRROR-ROOM-1' });
      // "pray" at SOUTH-TEMPLE (verbs/index.ts's verbPray) teleports
      // straight to FOREST-1 unconditionally — the vanilla escape for
      // leaving the Egyptian Room area WITH the coffin, since South
      // Temple's only ordinary exit (down, to Tiny Cave) is flag-gated
      // shut while holding it (COFFIN-CURE — southTempleFcn). TORCH-ROOM's
      // "up" exit (rooms.json: elseMessage "You cannot reach the rope.", no
      // `to`) is NOT a real route back either — the rope is a one-way
      // descent (confirmed live: "up" from Torch Room fails even with
      // DOME-FLAG set) — "pray" is the only way out with the coffin.
      if (room === 'SOUTH-TEMPLE') exits.push({ dir: 'pray', to: 'FOREST-1' });
      for (const exit of exits) {
        let dest = exit.to;
        if (exit.per === 'TRAP-DOOR-EXIT') {
          if (!this.flags.has('TRAP-DOOR')) continue;
          dest = 'CELLAR';
        } else if (exit.per !== undefined) {
          continue; // GRATING-EXIT / MAZE-DIODES / UP-CHIMNEY-FUNCTION — unused on this route
        }
        if (dest === undefined) continue;
        if (exit.ifFlag !== undefined && !this.flags.has(exit.ifFlag)) continue;
        if (seen.has(dest)) continue;
        if (avoid?.has(dest) === true && dest !== to) continue; // see the `avoid` param's caller (goto)
        const nextDirs = [...dirs, exit.dir];
        const nextRooms = [...rooms, dest];
        if (dest === to) return { dirs: nextDirs, rooms: nextRooms };
        seen.add(dest);
        queue.push({ room: dest, dirs: nextDirs, rooms: nextRooms });
      }
    }
    throw new Error(`bfsPath: no route from ${from} to ${to} (flags=${[...this.flags].join(',')})`);
  }

  /** Like bfsPathWithRooms, but minimizes MATCH-COUNT(6) cost instead of
   *  step count: a 0-1 BFS (Dijkstra with only 0/1 edge weights, so a
   *  deque suffices) where leaving a DARK room costs 1 (needs a lit match
   *  per goto()'s own needsMatchFallback rule) and leaving a naturally-lit
   *  one costs 0. Used ONLY when hasNoReliableLight is true (no TORCH, no
   *  working LAMP) — the plain step-count-shortest path can require MORE
   *  matches than a route that's a few steps longer but passes through
   *  more lit ground (rooms.json's dam/canyon regions are naturally lit —
   *  DAM-ROOM/DAM-LOBBY/DAM-BASE/CANYON-BOTTOM/CANYON-VIEW). Confirmed
   *  live, seed 1: the plain-shortest route from a mid-dam-region robbery
   *  back to Treasure Room needed 6 matches (over MATCH-COUNT's own
   *  effective 5-successful-light ceiling — matchFunction,
   *  src/actions/light-sources.ts, decrements before checking exhaustion,
   *  so the 6th attempt always fails) — a route weighted by match cost
   *  instead of step count exists and needs fewer. Shares
   *  bfsPathWithRooms's exact same synthetic-edge/flag-gating rules (kept
   *  in careful sync — see that method's own comments for why each one is
   *  there) rather than delegating, since 0-1 BFS needs its own
   *  edge-weight-aware queue (a deque, not a plain FIFO). */
  bfsPathMinimizingMatches(from: string, to: string): { dirs: string[]; rooms: string[] } {
    if (from === to) return { dirs: [], rooms: [] };
    interface Node { room: string; dirs: string[]; rooms: string[]; cost: number }
    const best = new Map<string, number>([[from, 0]]);
    const deque: Node[] = [{ room: from, dirs: [], rooms: [], cost: 0 }];
    let result: Node | undefined;
    while (deque.length > 0 && result === undefined) {
      const node = deque.shift()!;
      if (node.cost > (best.get(node.room) ?? Infinity)) continue; // stale entry
      const exits = [...(roomById.get(node.room)?.exits ?? [])];
      if (node.room === 'MIRROR-ROOM-1') exits.push({ dir: 'rub mirror', to: 'MIRROR-ROOM-2' });
      if (node.room === 'MIRROR-ROOM-2') exits.push({ dir: 'rub mirror', to: 'MIRROR-ROOM-1' });
      if (node.room === 'SOUTH-TEMPLE') exits.push({ dir: 'pray', to: 'FOREST-1' });
      const edgeCost = roomIsLit(node.room) ? 0 : 1;
      for (const exit of exits) {
        let dest = exit.to;
        if (exit.per === 'TRAP-DOOR-EXIT') {
          if (!this.flags.has('TRAP-DOOR')) continue;
          dest = 'CELLAR';
        } else if (exit.per !== undefined) {
          continue;
        }
        if (dest === undefined) continue;
        if (exit.ifFlag !== undefined && !this.flags.has(exit.ifFlag)) continue;
        const nextCost = node.cost + edgeCost;
        if (nextCost >= (best.get(dest) ?? Infinity)) continue;
        best.set(dest, nextCost);
        const next: Node = { room: dest, dirs: [...node.dirs, exit.dir], rooms: [...node.rooms, dest], cost: nextCost };
        if (dest === to) { result = next; break; }
        if (edgeCost === 0) deque.unshift(next); else deque.push(next);
      }
    }
    if (result === undefined) {
      throw new Error(`bfsPathMinimizingMatches: no route from ${from} to ${to} (flags=${[...this.flags].join(',')})`);
    }
    return { dirs: result.dirs, rooms: result.rooms };
  }

  bfsPath(from: string, to: string): string[] {
    return this.bfsPathWithRooms(from, to).dirs;
  }

  /** `replanAttempt` counts route recomputations WITHIN one logical trip —
   *  see the divergence check in the step loop below. Callers never pass
   *  it. */
  async goto(room: string, replanAttempt = 0): Promise<void> {
    if (room === this.currentRoom) return;
    if (process.env.DEBUG_RANDOMIZER !== undefined) {
      // eslint-disable-next-line no-console
      console.log(`[goto-debug] -> ${room} hasTorch=${this.hasTorch} lampOn=${this.lampOn} lampBurnedOut=${this.lampBurnedOut} EMPTY-HANDED=${this.flags.has('EMPTY-HANDED')}`);
    }
    // With no reliable light (no TORCH, LAMP already dead — see
    // hasNoReliableLight's own doc comment), route by MATCH cost instead
    // of step count: bfsPathMinimizingMatches's own doc comment explains
    // why the plain shortest-by-steps path can need more matches than
    // MATCH-COUNT(6) can ever supply (only 5 successful lights, ever),
    // when a slightly longer route through naturally-lit ground exists.
    let { dirs: path, rooms: pathRooms } = hasNoReliableLight(this)
      ? this.bfsPathMinimizingMatches(this.currentRoom, room)
      : this.bfsPathWithRooms(this.currentRoom, room);
    // GAS-ROOM's coal gas ignites on ANY held open flame (coal-mine.ts's
    // BOOM-ROOM, checked via `parent === actor`) — and unlike CANDLES,
    // TORCH can NEVER be put out (torchObject's V-LAMP-OFF: "You nearly
    // burn your hand..."). Carrying it as this generator's permanent light
    // source (see the tryEarly fetch's comment) is fundamentally
    // incompatible with ever crossing the coal-gas hazard again — confirmed
    // live: "down" into Gas Room while holding the torch was fatal.
    //
    // First choice: route AROUND Gas Room entirely, even if longer — the
    // shortest path merely HAPPENING to pass through it (this map has
    // several ways through the mine region) shouldn't force a drop/reclaim
    // at all. Only fall back to dropping torch (below) when Gas Room is
    // truly unavoidable for this destination. Confirmed live (seed 2):
    // without preferring the detour, the drop-here/reclaim-later dance
    // left an entirely lamp-reliant stretch so long the lamp genuinely
    // burned out partway through it, well before the reclaim ever ran.
    if (this.hasTorch && pathRooms.includes('GAS-ROOM')) {
      try {
        const detour = this.bfsPathWithRooms(this.currentRoom, room, new Set(['GAS-ROOM']));
        path = detour.dirs;
        pathRooms = detour.rooms;
      } catch {
        // No route avoiding Gas Room exists for this destination — fall
        // through to the drop-torch handling below.
      }
    }
    // BAT-ROOM's vampire bat (FLY-ME, bat.ts / 1actions.zil:2469) grabs the
    // player and TELEPORTS them to a random mine room whenever they enter
    // without GARLIC in hand — a mid-path relocation this generator's
    // step-by-step walking cannot predict. Same avoid-first strategy as
    // GAS-ROOM above: prefer any route around it when garlic isn't
    // genuinely held (fetched once AND not currently shed by an overload
    // recovery); when it's truly unavoidable, walk it anyway and let the
    // step loop's divergence replan (below) recover from wherever the bat
    // drops us. Confirmed by survey: 8 candidate seeds failed exactly this
    // way ("ended at LADDER-TOP/MINE-1/... instead") when GARLIC's shuffled
    // placement was late in their forward order.
    const garlicHeld = this.takenItems.has('GARLIC') && this.garlicDroppedAt === undefined;
    if (!garlicHeld && pathRooms.includes('BAT-ROOM')) {
      try {
        const detour = this.bfsPathWithRooms(this.currentRoom, room, new Set(['BAT-ROOM']));
        path = detour.dirs;
        pathRooms = detour.rooms;
      } catch {
        // No garlic-free route exists — proceed; the divergence replan
        // below absorbs the teleport.
      }
    }
    // Drop it right before the step that actually ENTERS Gas Room — not
    // immediately here in the room the call started from. An earlier
    // version dropped it unconditionally at call-start the instant Gas
    // Room appeared ANYWHERE in the path, however many rooms away — fine
    // for the short hops this was originally exercised by, but confirmed
    // live (seed 2): a LONG cross-map trek (a mid-thief-fight
    // weapon-substitute detour, many rooms from Gas Room) dropped torch
    // immediately, then relied entirely on the (here, already burned-out)
    // lamp / this file's own match-fallback for the ENTIRE remaining
    // distance — MATCH-COUNT(6, clock.ts) was spent in full just crossing
    // the pre-Gas-Room stretch, leaving nothing for the actual hazard or
    // anything after, and the walk died to a grue well short of the
    // destination. Torch safely lights that whole earlier stretch on its
    // own (skip the lamp-conservation block entirely below, exactly as
    // before) — only the segment from Gas Room onward needs the lamp/match
    // handling, so the drop (and the path this function still walks below)
    // is deferred to right there.
    const gasRoomIdx = pathRooms.indexOf('GAS-ROOM');
    let droppedTorchThisCall = false;
    if (this.hasTorch && gasRoomIdx !== -1) {
      for (let i = 0; i < gasRoomIdx; i++) {
        await this.cmd(path[i]!);
        if (this.gameOver()) {
          throw new Error(`goto(${room}): player died mid-path (path ${JSON.stringify(path)}, reached ${this.currentRoom})`);
        }
        // Same divergence replan as the main step loop below — a bat
        // teleport or mispredicted flag can strike on this segment too.
        if (this.currentRoom !== pathRooms[i]) {
          // Budget raised 5 -> 15: BAT-ROOM's teleport target is uniform
          // over 8 rooms (bat-garlic.ts), and without garlic each replan
          // that still crosses Bat Room risks another teleport — 5 attempts
          // is statistically tight for that combination. Bounded, not
          // unbounded: a genuinely impossible trip still fails loudly.
          if (replanAttempt >= 15) {
            throw new Error(`goto(${room}): path ${JSON.stringify(path)} diverged at ${this.currentRoom} (expected ${pathRooms[i]}) after ${replanAttempt} replans`);
          }
          return this.goto(room, replanAttempt + 1);
        }
      }
      await this.cmd('drop torch');
      this.torchDroppedAt = this.currentRoom;
      this.hasTorch = false;
      droppedTorchThisCall = true;
      // The pre-Gas-Room steps are done — everything below now operates on
      // just the remainder (Gas Room onward), which is what actually needs
      // the lamp/match handling.
      path = path.slice(gasRoomIdx);
      pathRooms = pathRooms.slice(gasRoomIdx);
    }
    // LAMP fuel is a hard, finite, non-rechargeable budget (LAMP_TABLE in
    // clock.ts — 385 turns total, ticking down every turn the lamp is ON,
    // regardless of what's actually being done) — burning it while walking
    // through naturally-lit rooms ('On' flag, rooms.json) is pure waste.
    // goto() is the single choke point for essentially all movement in this
    // generator, so decide ONCE per call, from the full upcoming room
    // sequence, rather than threading this through every call site
    // individually: if the whole path never needs light, turn the lamp off
    // first (if it's on); if any room along the way IS dark, make sure it's
    // on first. Confirmed live: without this, the lamp ran out partway
    // through ordinary navigation (not just the already-conserved thief-hunt
    // cure-waits) and a subsequent move in the resulting darkness triggered
    // the same grue check as any other dark room.
    // EMPTY-HANDED (coal-mine.ts's NO-OBJS gate) means the lamp has been
    // deliberately dropped — LOWER-SHAFT/MACHINE-ROOM are lit by the torch
    // already riding in the basket instead (TRANSBIT) — skip entirely so
    // this doesn't try (and harmlessly fail) a "turn on lamp" while it's
    // not even in hand.
    // Once TORCH is in hand it's a permanent substitute for the lamp — it's
    // already lit (objects.json: Flag.OnFire) and can never be put out
    // (torchObject's V-LAMP-OFF refuses: "You nearly burn your hand...") —
    // so there's nothing left to conserve or manage; skip the lamp entirely
    // for the rest of the game once it's held (see the tryEarly fetch's own
    // comment on why TORCH is grabbed as early as reachable).
    if (!this.flags.has('EMPTY-HANDED') && !this.hasTorch) {
      // Must also check the room we're standing in RIGHT NOW, not just the
      // rooms the path passes through — confirmed live: turning the lamp
      // off before the FIRST step, while still standing in a dark CELLAR
      // (because the destination and everything beyond it happened to be
      // lit), plunged the room into darkness one full turn before ever
      // moving, and the very next "up" then risked (and hit) the same grue
      // check as any other dark-room move.
      const pathNeedsLight = !roomIsLit(this.currentRoom) || pathRooms.some(r => !roomIsLit(r));
      if (pathNeedsLight && !this.lampOn) {
        await this.cmd('turn on lamp');
      } else if (!pathNeedsLight && this.lampOn) {
        await this.cmd('turn off lamp');
      }
    }
    for (let i = 0; i < path.length; i++) {
      const dir = path[i]!;
      // Emergency match fallback: whenever no TORCH is held and the lamp
      // isn't currently lit — whether because LAMP_TABLE's budget is truly
      // spent (lampBurnedOut) OR the lamp simply isn't in hand right now
      // (left behind for weight, never yet reclaimed) — this generator has
      // NO guaranteed light source left for a dark room — the ordinary
      // lamp-conservation block above only ever manages a lamp that's
      // actually HELD, so without this a dark→dark step here is walked
      // completely blind (confirmed live, seed 2: exactly this combination
      // with a truly dead lamp, reached via a mid-fight weapon-substitute
      // detour, walked several unlit rooms with nothing held and died to a
      // grue; confirmed again, seed 13: the SAME blind-step shape with a
      // merely-unheld-not-dead lamp — "rub mirror" silently no-opped
      // ("Your hand passes through its object.") 15 times running against
      // a dark Mirror Room instead of ever lighting a match). Originally
      // gated on `lampBurnedOut` specifically (narrower than this) on the
      // assumption a merely-off-but-held lamp would always already be
      // handled by the conservation block above — true only while the lamp
      // is actually IN HAND; dropped it, and neither block ever notices.
      // MATCH-COUNT(6, clock.ts) has ample budget for this rare combination
      // (confirmed live: at most 1 match spent all game, on the Hades
      // exorcism, before this ever triggers). Never light one while
      // standing in, or about to step into, GAS-ROOM — a lit match is
      // exactly the kind of held open flame that ignites the coal gas there
      // (this file's own established point for TORCH/CANDLES elsewhere).
      const needsMatchFallback =
        !this.hasTorch && !this.lampOn &&
        this.currentRoom !== 'GAS-ROOM' && pathRooms[i] !== 'GAS-ROOM' &&
        !roomIsLit(this.currentRoom);
      if (needsMatchFallback) {
        // Spend a match only if the global budget genuinely still has one
        // LEFT, rather than issuing a doomed "light match" (parser-level
        // "I'm afraid that you have run out of matches." once truly
        // exhausted — confirmed live, seed 1 — followed by a blind,
        // ~80%-probability-fatal step). MATCH-COUNT(6, clock.ts) only ever
        // yields 5 SUCCESSFUL lights, not 6: matchFunction
        // (src/actions/light-sources.ts) decrements BEFORE checking
        // exhaustion, so the 6th call decrements 1->0 and reports failure
        // in the SAME call — there is no successful 6th light. Threshold
        // is 5, matching matchesUsed's own doc comment (counts only
        // successes). Throwing a clear, distinguishable error here
        // (rather than gambling the blind step) lets tryEarly-wrapped and
        // hasNoReliableLight-guarded callers defer gracefully; a call with
        // no such tolerance (e.g. the Hades exorcism's own goto) surfaces
        // this as a genuine, reportable failure instead of a random death
        // — confirmed live: an earlier, broader version of this guard also
        // aborted trips that started safely lit and only lost light
        // mid-transit, but that fired on essential, unwrapped calls too
        // (the Hades trip itself), crashing outright instead of failing
        // usefully.
        if (this.matchesUsed >= 5) {
          throw new Error(
            `goto(${room}): MATCH-COUNT(6) exhausted (5 successful lights already spent) at ${this.currentRoom} with no other light source — ` +
            'cannot safely take another dark step; reportable if this trip was essential.',
          );
        }
        await this.cmd('light match');
      }
      const stepStart = this.currentRoom;
      await this.cmd(dir);
      // Check for death after EVERY step, not just once the whole path is
      // exhausted — a mid-path death (grue, gas explosion, a wandering
      // combat encounter) otherwise leaves the loop blindly issuing the
      // REST of the path's directions against a respawned, disoriented,
      // inventory-stripped player, producing a nonsensical cascade whose
      // eventual thrown error points at the wrong room entirely (confirmed
      // live: seed 3's real death was a Gas Room explosion several steps
      // into an earlier goto(), but the surfaced error was a much later,
      // unrelated "ended at FOREST-3" from a goto() long after the real
      // failure). Fail loudly at the exact step that killed the player.
      if (this.gameOver()) {
        throw new Error(`goto(${room}): player died mid-path (path ${JSON.stringify(path)}, reached ${this.currentRoom})`);
      }
      // Divergence replan: the engine can put the player somewhere OTHER
      // than the step's expected next room — the vampire bat's FLY-ME
      // teleport (a random mine room, whenever BAT-ROOM is entered without
      // garlic), or a move blocked by a flag the model mispredicted (the
      // room simply doesn't change). Recompute the whole route from
      // wherever we ACTUALLY are and walk again (recursive call — re-runs
      // all of this method's own hazard handling freshly from the new
      // location), bounded so a genuinely impossible trip still fails
      // loudly instead of ping-ponging forever. Confirmed by survey: 8
      // candidate seeds previously hard-failed "ended at <mine room>
      // instead" on exactly the bat case.
      if (this.currentRoom !== pathRooms[i]) {
        // Budget raised 5 -> 15 (same rationale as the segment-level check
        // above): BAT-ROOM's teleport is uniform over 8 rooms, and each
        // garlic-less replan through it risks another one.
        if (replanAttempt >= 15) {
          throw new Error(`goto(${room}): path ${JSON.stringify(path)} diverged at ${this.currentRoom} (expected ${pathRooms[i]}) after ${replanAttempt} replans`);
        }
        // TRAP-DOOR model resync — the one flag the ENGINE genuinely
        // flips back under us: the trap door re-bars itself (rooms.json
        // gates both LIVING-ROOM's "down" and CELLAR's "up" on the
        // engine-side TRAP-DOOR flag; vanilla-faithful — it stays
        // treacherous until the thief is dealt with), while this
        // generator's model held it permanently open after the one
        // post-cyclops "open trap door". When the blocked step was
        // exactly this door: from ABOVE, just open it again and re-walk;
        // from BELOW it cannot be opened — drop the model flag so the
        // replan reroutes through the Strange Passage shortcut
        // (MAGIC-FLAG, permanent once the cyclops has fled). Confirmed by
        // survey: 3 candidate seeds hard-failed "diverged at CELLAR
        // (expected LIVING-ROOM) after 5 replans" retrying the same
        // barred door.
        if (this.currentRoom === stepStart) {
          const attemptedExit = roomById.get(stepStart)?.exits?.find(e => e.dir === dir);
          const wasTrapDoor = attemptedExit?.per === 'TRAP-DOOR-EXIT' || attemptedExit?.ifFlag === 'TRAP-DOOR';
          if (wasTrapDoor) {
            if (this.currentRoom === 'LIVING-ROOM') {
              await this.cmd('open trap door');
            } else {
              this.flags.delete('TRAP-DOOR');
            }
          }
        }
        return this.goto(room, replanAttempt + 1);
      }
    }
    // currentRoom is synced from the real engine inside cmd() — verify we
    // actually arrived, rather than assume the whole path succeeded (the
    // per-step divergence check above should make this unreachable; kept
    // as a loud final invariant).
    if (this.currentRoom !== room) {
      throw new Error(`goto(${room}): path ${JSON.stringify(path)} ended at ${this.currentRoom} instead`);
    }
    // Reclaim TORCH immediately — within this SAME goto() call — rather
    // than leaving it dropped for however long until some later, separate
    // reclaim step. Confirmed live (seed 2): deferring the reclaim to
    // "right before doThiefHunt" left a long, entirely lamp-reliant
    // stretch in between (everything else this call's caller and later
    // callers needed to do), and the lamp genuinely ran out partway
    // through THAT stretch — a dark-room move then died to a grue exactly
    // like any other unlit move. Bounding the exposure to a single round
    // trip, immediately, is the only way to make the lamp budget for it
    // predictable rather than dependent on how much unrelated navigation
    // happens to follow before some later call gets around to it.
    //
    // BUT only when the return trip (dropRoom -> room) does NOT itself
    // cross GAS-ROOM again — when `room` is genuinely on the far side of
    // the hazard from where torch got dropped, reclaiming it immediately
    // would just require dropping it AGAIN for the trip back, which
    // recurses (confirmed live: 7+ nested goto() frames, the exact
    // ping-pong this guard exists to prevent). In that case leave it
    // dropped — the later explicit reclaimTorchIfDropped() calls still
    // pick it up once we're done with this side of the hazard.
    if (droppedTorchThisCall && this.torchDroppedAt !== undefined) {
      const dropRoom = this.torchDroppedAt;
      const returnTrip = this.bfsPathWithRooms(dropRoom, room);
      if (!returnTrip.rooms.includes('GAS-ROOM')) {
        await this.goto(dropRoom);
        const reclaim = await this.cmd('take torch');
        // Never assume the reclaim succeeded just because we asked —
        // TORCH is TVALUE>0 (a treasure), so it's exactly the kind of item
        // thief.ts's ROOM-treasure robbery (`ctx.rob(here, 'THIEF', 100)`)
        // can take straight out of a room, unconditionally, while it's
        // sitting here exposed for however long elapses before this
        // reclaim runs (confirmed live: this exact deferred-reclaim branch
        // — dropped here because the return trip re-crosses GAS-ROOM, so
        // the "immediate" reclaim above is skipped by design — left torch
        // exposed for a long stretch, and it was gone by the time this ran:
        // "You can't see any torch here!"). Blindly setting hasTorch=true
        // and clearing torchDroppedAt regardless used to make every
        // downstream goto() call trust a torch that wasn't actually held,
        // skipping its own lamp-conservation entirely (the `!hasTorch`
        // gate) and sending navigation into unlit rooms with nothing lit —
        // exactly the class of desync this file's own checkTakeSucceeded
        // discipline exists to prevent elsewhere. If it's genuinely gone,
        // leave torchDroppedAt as-is (not this room specifically — the
        // thief moved it, so there's nothing further to reclaim FROM here —
        // clear it so a future call doesn't keep retrying an empty room);
        // it'll come back on its own once the thief dies (depositBooty
        // returns every treasure he's touched to Treasure Room — doThiefHunt's
        // own post-kill code already reclaims it from there the same
        // careful way).
        if (!/can't see any|don't see|nothing here/i.test(reclaim)) {
          this.hasTorch = true;
        }
        this.torchDroppedAt = undefined;
        await this.goto(room);
      }
    }
  }

  /** Like goto(), but relights a match before EVERY step of the path — for
   *  the pre-lamp dark-room dash. A single "light match" does NOT cover a
   *  multi-step path: I-MATCH arms a 2-tick countdown, but the very next
   *  turn already ticks it to 0 and extinguishes it (confirmed live: seed
   *  3 died to a grue on the SECOND move after lighting, one move further
   *  than "light match" actually covers) — so light fresh before each step,
   *  not once at the start. MATCH-COUNT(6) comfortably covers the longest
   *  dash needed on the 3 pinned golden seeds (at most 3 steps) plus the
   *  one match hades' exorcism needs later. */
  async gotoWithMatch(room: string): Promise<void> {
    if (room === this.currentRoom) return;
    const path = this.bfsPath(this.currentRoom, room);
    for (const dir of path) {
      await this.cmd('light match');
      await this.cmd(dir);
      if (this.gameOver()) {
        throw new Error(`gotoWithMatch(${room}): player died mid-path (path ${JSON.stringify(path)}, reached ${this.currentRoom})`);
      }
    }
    if (this.currentRoom !== room) {
      throw new Error(`gotoWithMatch(${room}): path ${JSON.stringify(path)} ended at ${this.currentRoom} instead`);
    }
  }

  roomOfContainer(containerId: string): string {
    if (roomIds.has(containerId)) return containerId;
    const room = STATIC_ROOM_OF.get(containerId);
    if (room === undefined) throw new Error(`cannot resolve containerId ${containerId} to a room`);
    return room;
  }

  /** ZIL WEIGHT (gverbs.zil:1988, ported literally in
   *  src/engine/verbs/index.ts's own `weight()`) computed directly against
   *  the REAL, live engine object graph — SIZE (falls back to 5 when the
   *  property is absent, `<PROPDEF SIZE 5>`, NOT 0) plus the recursive sum
   *  over every child. Used for `objId === 'PLAYER'` to get the player's
   *  current total load (their own base SIZE plus everything held), and
   *  for any other id to get a single object's own weight (its take-time
   *  contribution to loadAllowed) — both match verbTake's own check
   *  exactly, so this predicts a "Your load is too heavy" failure BEFORE
   *  issuing the command, rather than discovering it via trial and error. */
  private liveWeight(objId: string): number {
    const obj = this.game.world.get(objId);
    if (obj === undefined) return 0;
    let w = (obj.props.get('SIZE') as number | undefined) ?? 5;
    for (const child of obj.children) w += this.liveWeight(child.id);
    return w;
  }

  /** Drops every one-time-ritual tool whose job is PROVABLY done (the
   *  ritual's own flag is set) and which is still physically in hand —
   *  returns the total weight freed. The dedicated ritual sites already
   *  drop their tool immediately after use, but a tool can re-enter the
   *  inventory afterward anyway (chiefly doThiefHunt's post-kill sweep,
   *  which force-takes every unheld progression item the thief was
   *  carrying — a stolen-then-returned BELL/BOOK/PUMP lands back in hand
   *  with its ritual already long complete), and unlike treasures these
   *  can never be banked in the case to shed weight. First tier of every
   *  overload recovery: zero cost (the items have no remaining use), no
   *  reclaim tracking needed. Confirmed by survey: 6 candidate seeds blew
   *  loadMax on COFFIN/EGG/MATCH/SHOVEL takes with exactly this class of
   *  dead weight aboard. */
  private async shedSpentJunk(): Promise<number> {
    const player = this.game.world.get('PLAYER');
    if (player === undefined) return 0;
    const held = new Set([...player.children].map(o => o.id));
    const spent: Array<[string, string, boolean]> = [
      ['ROPE', 'rope', this.flags.has('DOME-FLAG')],
      ['WRENCH', 'wrench', this.flags.has('LOW-TIDE')],
      ['BELL', 'bell', this.flags.has('LLD-FLAG')],
      ['BOOK', 'book', this.flags.has('LLD-FLAG')],
      ['CANDLES', 'candles', this.flags.has('LLD-FLAG')],
      ['PUMP', 'pump', this.flags.has('RIVER-DONE')],
      ['SHOVEL', 'shovel', this.flags.has('RIVER-DONE')],
    ];
    let freed = 0;
    for (const [id, noun, done] of spent) {
      if (!done || !held.has(id)) continue;
      const w = this.liveWeight(id);
      await this.cmd(`drop ${noun}`);
      freed += w;
    }
    return freed;
  }

  /** Items deliberately set down to make room for a heavy take, each still
   *  needed LATER (unlike shedSpentJunk's tools) — id -> the room it waits
   *  in. Distinct from the torch/coal/weapon/garlic/screwdriver droppedAt
   *  fields only in that these are reclaimed AT their consumer site
   *  (reclaimParked, called by whatever step actually needs the item)
   *  rather than at recurring checkpoints — a parked SHOVEL/BOAT has
   *  exactly one future consumer each (the beach dig; the boat run), so
   *  hauling it along every intervening checkpoint would just recreate the
   *  very overload it was parked to relieve. */
  readonly parkedAt = new Map<string, string>();

  /** Walks back and re-takes a parked item (see parkedAt) — a no-op if the
   *  item was never parked. Throws on failure: every caller genuinely
   *  needs the item in hand for the step it is about to perform. */
  async reclaimParked(itemId: string): Promise<void> {
    const room = this.parkedAt.get(itemId);
    if (room === undefined) return;
    await this.goto(room);
    const out = await this.cmd(`take ${NOUN[itemId] ?? itemId.toLowerCase()}`);
    if (/can't see any|don't see|nothing here|your load is too heavy|too dark to see/i.test(out)) {
      throw new Error(`reclaimParked(${itemId}): parked at ${room} but could not re-take — output: ${JSON.stringify(out)}`);
    }
    this.parkedAt.delete(itemId);
  }

  /** Predictive overload relief, shared by both takeItem branches: computes
   *  the exact WEIGHT deficit the upcoming take would hit (liveWeight — the
   *  same recursive SIZE sum verbTake itself runs, player base SIZE
   *  included) and sheds in one pass, cheapest-consequence first, only as
   *  much as needed. Predict-then-take (rather than take/shed/retry) keeps
   *  the exposed-turn count minimal — confirmed live, seed 1: a reactive
   *  shed ladder needed FIVE separate "take coffin" attempts, and the extra
   *  turns were exactly what let a thief robbery land mid-sequence.
   *
   *  Tiers, in order:
   *   0. Spent ritual tools (shedSpentJunk — free, no reclaim).
   *   1. TORCH — ONLY while LAMP is still a working fallback
   *      (!lampBurnedOut): a lit object on the ground still lights THIS
   *      room (`lit()`, src/engine/parser/scope.ts, checks Flag.OnFire on
   *      the room's own children), but once LAMP_TABLE's budget is spent
   *      TORCH is the ONLY light left for every other dark room.
   *   2/3. COAL / the active weapon — tracked via the SAME coalDroppedAt/
   *      weaponDroppedAt fields their dedicated overload paths use,
   *      reclaimed at the established checkpoints.
   *   4. GARLIC — tracked (garlicDroppedAt), NOT abandoned: Bat Room is
   *      crossed again by the coal-machine route (confirmed live, seed 1).
   *   5. SCREWDRIVER — tracked (screwdriverDroppedAt); the coal machine
   *      still needs it.
   *   6. SHOVEL / INFLATABLE-BOAT — PARKED (parkedAt): each has exactly
   *      one future consumer (the beach dig / the boat run), which
   *      reclaims it on the spot via reclaimParked. Confirmed by survey:
   *      with the river journey legitimately deferred (its own boat/pump/
   *      sceptre preflights), these two ride along as 35 combined SIZE of
   *      dead weight, and COFFIN (55) cannot fit past them on 4 candidate
   *      seeds.
   *  LAMP itself is deliberately NEVER shed, dead or not: an earlier
   *  version dropped it once burned out, and a torch robbery landing on
   *  that SAME turn left literally no light source anywhere to even
   *  attempt recovery with. */
  private async prepareLoadFor(itemId: string): Promise<void> {
    let deficit = this.liveWeight('PLAYER') + this.liveWeight(itemId) - 100;
    if (deficit <= 0) return;
    deficit -= await this.shedSpentJunk();
    if (deficit <= 0) return;
    const held = new Set([...(this.game.world.get('PLAYER')?.children ?? [])].map(o => o.id));
    const candidates: { id: string; noun: string }[] = [];
    if (this.hasTorch && !this.lampBurnedOut) candidates.push({ id: 'TORCH', noun: 'torch' });
    if (this.takenItems.has('COAL') && this.coalDroppedAt === undefined) candidates.push({ id: 'COAL', noun: 'coal' });
    if (this.weaponNoun !== undefined && this.weaponDroppedAt === undefined && itemId !== (this.weaponItemId ?? '')) {
      candidates.push({ id: this.weaponItemId ?? this.weaponNoun, noun: this.weaponNoun });
    }
    if (this.takenItems.has('GARLIC') && this.garlicDroppedAt === undefined) candidates.push({ id: 'GARLIC', noun: 'garlic' });
    if (this.takenItems.has('SCREWDRIVER') && this.screwdriverDroppedAt === undefined) {
      candidates.push({ id: 'SCREWDRIVER', noun: 'screwdriver' });
    }
    for (const parkable of ['SHOVEL', 'INFLATABLE-BOAT']) {
      if (parkable !== itemId && held.has(parkable) && !this.parkedAt.has(parkable)) {
        candidates.push({ id: parkable, noun: NOUN[parkable]! });
      }
    }
    for (const c of candidates) {
      if (deficit <= 0) break;
      if (!held.has(c.id)) continue; // tracked as held by our model but physically gone (robbed) — nothing to shed
      const w = this.liveWeight(c.id);
      await this.cmd(`drop ${c.noun}`);
      deficit -= w;
      if (c.id === 'TORCH') {
        this.torchDroppedAt = this.currentRoom;
        this.hasTorch = false;
      } else if (c.id === 'COAL') {
        this.coalDroppedAt = this.currentRoom;
      } else if (c.id === 'SCREWDRIVER') {
        this.screwdriverDroppedAt = this.currentRoom;
      } else if (c.id === 'GARLIC') {
        this.garlicDroppedAt = this.currentRoom;
      } else if (c.id === 'SHOVEL' || c.id === 'INFLATABLE-BOAT') {
        this.parkedAt.set(c.id, this.currentRoom);
      } else {
        this.weaponDroppedAt = this.currentRoom; // whatever's left is the weapon candidate
      }
    }
  }

  /** Fetch the REAL item `itemId`, wherever fill() actually placed it (or,
   *  for the two pinned treasure-vessels COFFIN/EGG, its fixed vanilla
   *  room). No-ops for event-created treasures (DIAMOND/BAUBLE) and for
   *  anything with no current placement. Refuses locations nested in EGG —
   *  those must come out via the thief (see file header). */
  async takeItem(itemId: string): Promise<void> {
    if (this.takenItems.has(itemId)) return;
    if (PINNED_TREASURE_VESSELS.has(itemId)) {
      const room = resolveCurrentRoom(itemId, this.locationIdByItemId);
      if (room === undefined) throw new Error(`cannot resolve current room for pinned treasure ${itemId}`);
      if (room === 'TREASURE-ROOM' && !this.thiefDead) return; // deferred — see the guard below
      await this.goto(room);
      // COFFIN alone is SIZE 55 — over half of loadMax=100 — and playSeed's
      // own call site already fetches it in as much isolation as it can
      // (depositing every treasure first), but that still leaves whatever
      // NON-treasure progression tools happen to be held at the time
      // (TORCH/COAL/LAMP/GARLIC/the weapon/SCREWDRIVER/etc., none of them
      // depositable — they aren't treasures). ZIL's WEIGHT
      // (gverbs.zil:1988, ported literally in src/engine/verbs/index.ts)
      // falls back to SIZE 5 for ANY object with no explicit SIZE property
      // (`<PROPDEF SIZE 5>`) — NOT 0 — and ALSO counts the PLAYER's own
      // base SIZE (same fallback) on top of every held item's. Confirmed
      // live, seed 1: a naive "shed one at a time, retry the take after
      // each" loop (an earlier version of this block) needed FIVE separate
      // "take coffin" attempts before it finally fit — each one an extra
      // turn sitting exposed to the still-alive thief's wandering robbery,
      // and on one run that padding was exactly what let a TORCH robbery
      // land mid-sequence. Computing the shed set from the REAL live
      // object graph (this.game.world, not a hand-maintained SIZE table)
      // upfront instead — drop everything actually needed in one pass,
      // take once — cuts that exposure to the minimum possible.
      await this.prepareLoadFor(itemId);
      let out = await this.cmd(`take ${NOUN[itemId]}`);
      // A DIFFERENT failure mode than weight: the thief can rob TORCH (a
      // TVALUE>0 treasure — thief.ts's rob(PLAYER,'THIEF'), unconditional,
      // fires on literally any turn while he's alive, including one of the
      // drop turns right above) straight out of the player's own
      // inventory, and with LAMP already burned out (this branch's own
      // established situation whenever TORCH needed shedding at all) there
      // is genuinely no light left. cmd()'s own INVENTORY_ROBBED_RE
      // auto-recovery already tried "turn on lamp" and failed the same
      // way. MATCH is the one remaining, still-unspent light source at
      // this point — light one and retry; its ~2-tick burn comfortably
      // covers this single retry, PROVIDED matches aren't already
      // exhausted (MATCH-COUNT(6), clock.ts — a genuinely dry budget makes
      // this a reportable upstream-adjacent dead end, not a script bug: no
      // further light source exists at all).
      if (/too dark to see/i.test(out)) {
        await this.cmd('light match');
        out = await this.cmd(`take ${NOUN[itemId]}`);
      }
      this.checkTakeSucceeded(itemId, out);
      this.takenItems.add(itemId);
      if (itemId === 'COFFIN') this.flags.delete('COFFIN-CURE'); // see the flag's own doc comment
      return;
    }
    // Preserve the tightly bounded MATCH-COUNT(6) budget for whatever
    // genuinely NEEDS reliable light (progression items, and EGG's own
    // PINNED_TREASURE_VESSELS fetch above) rather than spending it
    // navigating to an optional treasure — skip entirely (not even
    // goto()) here when there's no reliable light and this item isn't
    // progression; the safety-net sweep's own tryEarly wrapper and
    // doThiefHunt's post-kill retry pass both give it a real second
    // chance once light is restored. See hasNoReliableLight's own doc
    // comment for the full rationale (confirmed live, seed 1: several
    // ordinary treasure fetches during this exact window burned matches
    // that EGG's own, genuinely-required trip then didn't have left).
    if (hasNoReliableLight(this) && graph.items.find(i => i.id === itemId)?.class !== 'progression') {
      return;
    }
    const locId = this.locationIdByItemId.get(itemId);
    if (locId === undefined) return; // event-created (DIAMOND/BAUBLE) or not placed
    const loc = locByIdGlobal.get(locId);
    if (loc === undefined) throw new Error(`unknown location ${locId}`);
    if (loc.containerId === 'EGG') {
      throw new Error(`${itemId} sits inside the EGG — must come out via the thief, not takeItem`);
    }
    // TREASURE-ROOM is thief-guarded and only ever safely entered from
    // within doThiefHunt's own diagnose/retreat cure loop — the thief hunt
    // is deferred until nearly everything else is collected (see
    // playSeed's doThiefHunt call site), so ANYTHING whose real placement
    // resolves there — treasure or, in principle, a shuffled progression
    // item — must wait. Silently skip (not an error): doThiefHunt's own
    // final `grabAllAt('TREASURE-ROOM')` picks up whatever's really there
    // once he's dead, and the forward-order/safety-net loops that called
    // takeItem() harmlessly move on and retry later via their own
    // idempotent re-attempts.
    if (this.roomOfContainer(loc.containerId) === 'TREASURE-ROOM' && !this.thiefDead) return;
    await this.goto(this.roomOfContainer(loc.containerId));
    // LOUD-ROOM intercepts EVERY command (not just ones targeting BAR
    // specifically) while it's still "loud" (game.ts's isLoudRoomActive) —
    // gverbs.zil:1693-1728's captive-input mode routes anything that isn't
    // W/E/U movement, SAVE/RESTORE/QUIT, or the literal word ECHO into the
    // "echo the last word twice" fallback, INCLUDING "take <noun>". Saying
    // "echo" first solves the room (sets LOUD-FLAG, clears BAR's own Sacred
    // flag) unconditionally and is a harmless flavor-text no-op
    // ("echo echo...") if the room's already quiet — safe to always emit.
    // Confirmed live: seed 1's "take bar" here printed "bar bar ..." (the
    // literal echo fallback) instead of "Taken.", and — since that text
    // matches neither this generator's own checkTakeSucceeded failure
    // patterns NOR the "already have"/"too heavy"/"can't see" patterns
    // forceTakeHere later checked — it was silently recorded as a
    // successful take despite the object never actually leaving the room,
    // permanently hiding it from every later retry (the same class of bug
    // takenItems already causes for a genuinely-stolen treasure).
    if (this.roomOfContainer(loc.containerId) === 'LOUD-ROOM') {
      await this.cmd('echo');
    }
    // Open the container first if it's a real, currently-closed Container
    // — generalizes VESSELS (the 6 pinned vessels always need this) to
    // ANY closed container the graph can place an item inside: full-item-
    // shuffle can put a placeable item in the MAILBOX slot (ADVERTISEMENT's
    // vanilla home) too, and MAILBOX starts closed like any other ordinary
    // container (objects.json: flags ['Container','TryTake'], no 'Open') —
    // confirmed live (seed 2: "take bell" failed "You can't see any bell
    // here!" at West of House because the mailbox holding it was never
    // opened). Objects already flagged 'Open' (ALTAR/ATTIC-TABLE/PEDESTAL —
    // open surfaces, not real closed containers) are correctly skipped.
    const containerObj = objectById.get(loc.containerId);
    const needsOpen = VESSELS.has(loc.containerId) ||
      (containerObj?.flags?.includes('Container') === true && containerObj.flags?.includes('Open') !== true);
    if (needsOpen) {
      await this.cmd(`open ${NOUN[loc.containerId] ?? loc.containerId.toLowerCase()}`);
    }
    // CANDLES start with Flag.OnFire/Flag.On already set ("On the two ends
    // of the altar are burning candles." — objects.json) — a genuine open
    // flame, unlike the battery-powered LAMP. coal-mine.ts's BOOM-ROOM
    // (GAS-ROOM's M-END handler) fires at the END of the very turn a lit
    // flame becomes HELD, checking `candles.parent === actor` — so
    // extinguishing AFTER a successful "take" is already one turn too late
    // if the candles' real placement is physically inside the Gas Room
    // itself (confirmed live: seed 2's "take candles" in GAS-ROOM printed
    // "Taken." and the fatal explosion in the SAME turn's output, before
    // this function ever got a chance to issue the extinguish command).
    // Must extinguish BEFORE taking — CANDLES-FCN's V-LAMP-OFF only checks
    // the object's own flag, not who's holding it, so this is a safe no-op
    // ("The candles are not lighted.") whenever they're already out, and
    // works equally well for every other pickup site (e.g. the End of
    // Rainbow case) that isn't gas-hazardous at all. The later Hades ritual
    // explicitly re-lights them with a match, so this never blocks it.
    if (itemId === 'CANDLES') {
      await this.cmd('extinguish candles');
    }
    const noun = NOUN[itemId];
    if (noun === undefined) throw new Error(`no noun mapped for item ${itemId}`);
    // Predictive overload relief — same shared ladder the pinned-vessel
    // branch uses (see prepareLoadFor's own doc comment); zero commands
    // issued when the take already fits.
    await this.prepareLoadFor(itemId);
    let out = await this.cmd(`take ${noun}`);
    // COAL (SIZE 20) is carried continuously from its own early, theft-safe
    // fetch (see the WRENCH-detour comment on why: stealJunk only ever
    // targets a ROOM's children, never held inventory, so once taken it's
    // permanently safe — but that means it also permanently adds 20 to
    // every later WEIGHT check, unlike the original script's late,
    // theft-exposed re-fetch). Confirmed live: this pushed an unrelated
    // later take (SHOVEL, at whatever room full-item-shuffle actually put
    // it) over loadMax=100. Shedding COAL for the single "too heavy" take
    // and reclaiming it immediately (same room, zero exposure window) fixes
    // the overload without reopening the theft risk this fetch was moved
    // early to close in the first place.
    if (
      /your load is too heavy/i.test(out) && itemId !== 'COAL' &&
      this.takenItems.has('COAL') && this.coalDroppedAt === undefined
    ) {
      await this.cmd('drop coal');
      out = await this.cmd(`take ${noun}`);
      // The target item alone can still be too heavy even with coal shed
      // (confirmed live: TRUNK) — don't assume the reclaim succeeds just
      // because we asked. If it's still too heavy even alone, leave coal
      // behind and record where, exactly like torchDroppedAt, rather than
      // silently treating it as reclaimed while it's actually abandoned on
      // the ground (confirmed live: a silent assumption here left COAL
      // sitting in MAZE-5 for the rest of the game, and the coal-machine
      // section's own takeItem('COAL') no-op'd on the stale `takenItems`
      // entry instead of re-fetching it, failing "can't see any coal here"
      // right when the machine actually needed it).
      const reclaim = await this.cmd('take coal');
      if (/your load is too heavy/i.test(reclaim)) {
        this.coalDroppedAt = this.currentRoom;
      }
    }
    // Second-tier shed: the substitute weapon a mid-thief-fight theft can
    // force onto us (findSubstituteWeapon) is drawn from WEAPON_IDS in
    // order (SWORD/KNIFE/AXE/SCEPTRE) with no weight awareness — SWORD
    // alone is SIZE 30, ~10x the original SCEPTRE (SIZE 3) it replaced —
    // and this class of overload doesn't involve COAL at all (confirmed
    // live: COAL's own fetch failing "too heavy" post-substitution, where
    // the coal-shed branch above can't apply since itemId IS COAL here).
    // Weapon is safe to shed-and-reclaim the same way: nothing needs it
    // held except an active fight, and this call site is never mid-combat.
    // Guarded on weaponDroppedAt === undefined — mirrors the COAL branch
    // above's own guard — so this never clobbers an already-dropped,
    // not-yet-reclaimed record from an earlier call.
    if (
      /your load is too heavy/i.test(out) && this.weaponNoun !== undefined &&
      NOUN[itemId] !== this.weaponNoun && this.weaponDroppedAt === undefined
    ) {
      await this.cmd(`drop ${this.weaponNoun}`);
      this.weaponDroppedAt = this.currentRoom;
      out = await this.cmd(`take ${noun}`);
      const reclaim = await this.cmd(`take ${this.weaponNoun}`);
      // Do NOT throw here just because the immediate reclaim failed on
      // weight alone — confirmed live: shedding the weapon to fetch
      // BAG-OF-COINS (itself heavy) can leave the weapon still too heavy to
      // reclaim in that SAME breath, even though it's sitting right here,
      // completely recoverable a few turns later once something else is
      // deposited. Leaving weaponDroppedAt set (exactly like COAL's own
      // overload-shedding branch) lets reclaimWeaponIfDropped() retry at
      // the next checkpoint instead of hard-failing an otherwise-successful
      // take of `itemId`. A genuinely MISSING weapon ("can't see any") is
      // the harder case — thief.ts's stealJunk can relocate an ordinary
      // TVALUE==0 weapon like COAL, and unlike a treasure it's never
      // auto-returned — left for reclaimWeaponIfDropped's own
      // findSubstituteWeapon fallback rather than thrown here, since this
      // takeItem() call for `itemId` itself already succeeded and hard-
      // failing it too would discard that real progress over an unrelated
      // problem.
      if (!/can't see any|your load is too heavy/i.test(reclaim)) {
        this.weaponDroppedAt = undefined;
      }
    }
    this.checkTakeSucceeded(itemId, out);
    this.takenItems.add(itemId);
    if (itemId === 'TORCH') this.hasTorch = true; // see hasTorch's own doc comment
  }

  /** Loudly fail on a known TAKE-failure pattern (never silently mark it
   *  taken) — most importantly "Your load is too heavy" (loadMax=100
   *  exceeded), confirmed live: silently marking an overload-failed take as
   *  "taken" permanently skipped it (ROPE never actually collected, later
   *  DOME-FLAG tie failed with "You can't see any rope here!" far from
   *  where it could be re-fetched). Surfacing this immediately makes the
   *  fix obvious (deposit more often), rather than a silent, distant no-op. */
  private checkTakeSucceeded(itemId: string, output: string): void {
    if (/your load is too heavy|can't see any|don't see|nothing here|too dark to see/i.test(output)) {
      throw new Error(`takeItem(${itemId}): "take" did not succeed — output: ${JSON.stringify(output)}`);
    }
    // LOUD-ROOM's captive-input echo fallback ("<word> <word> ...", e.g.
    // "bar bar ...") matches none of the patterns above but is just as much
    // a non-take — defense in depth alongside the dedicated "echo" call
    // this class issues before ever fetching anything there (see that call
    // site's own comment for the underlying mechanic).
    if (/^\S+ \S+ \.\.\.$/.test(output.trim())) {
      throw new Error(`takeItem(${itemId}): LOUD-ROOM echoed instead of taking — output: ${JSON.stringify(output)}`);
    }
  }

  /** Whichever real item currently sits at a given location slot (used only
   *  for the "what's inside the egg" lookup — the one place the SLOT, not
   *  an item id, is what we know ahead of time). */
  itemAt(locationId: string): string | undefined {
    for (const [item, loc] of this.locationIdByItemId) if (loc === locationId) return item;
    return undefined;
  }

  /** True if itemId's current placement is nested inside the (pinned,
   *  never-safe-to-open-directly) EGG. Any filler/treasure item can in
   *  principle land in the EGG's one interior slot under full shuffle. */
  isInEgg(itemId: string): boolean {
    const locId = this.locationIdByItemId.get(itemId);
    if (locId === undefined) return false;
    return locByIdGlobal.get(locId)?.containerId === 'EGG';
  }

  /** Fetch a treasure directly UNLESS it's currently trapped inside the egg
   *  — those are deferred to the thief-hunt phase's egg-contents handling. */
  async takeTreasure(itemId: string): Promise<void> {
    if (this.isInEgg(itemId)) return;
    await this.takeItem(itemId);
  }

  /** Fetches whatever real item currently sits inside the named pinned
   *  vessel (BOTTLE/SANDWICH-BAG/TUBE — the vessels not already handled as
   *  pinned treasures themselves). A no-op if the vessel's interior slot is
   *  empty/unmapped or the item has no noun. Idempotent via takeItem's own
   *  takenItems guard, so safe to call more than once for the same vessel —
   *  used both for the early, low-exposure pre-fetch AND a later retry (see
   *  the retry call sites' own comments for why one attempt alone isn't
   *  always enough: an item that's genuinely still Invisible at fetch time,
   *  e.g. POT-OF-GOLD before the rainbow's ever been waved, fails this
   *  silently no matter how early it's tried, and only becomes takeable
   *  once its own reveal condition — unmodeled in the logic graph, exactly
   *  like the troll's weapon requirement or SCARAB's dig ritual — has
   *  actually fired). */
  async fetchVesselInterior(vesselId: string): Promise<void> {
    const loc = graph.locations.find(l => l.containerId === vesselId);
    const item = loc !== undefined ? this.placements[loc.id] : undefined;
    if (item !== undefined && NOUN[item] !== undefined) await this.takeItem(item);
  }

  /** Opportunistically recovers a non-treasure pinned vessel's interior item
   *  when the vessel's OWN room-look text shows up somewhere this generator
   *  didn't expect it — i.e. thief.ts's stealJunk/dropJunk relocated the
   *  WHOLE vessel elsewhere. Amendment 3 pins the vessel's PLACEMENT-SEAM
   *  position (fill() never reassigns it), but that says nothing about the
   *  thief's ordinary wandering, which can and does physically move it —
   *  and fetchVesselInterior/roomOfContainer only ever resolve to the
   *  vessel's STATIC vanilla room, so once it's actually been relocated,
   *  every other recovery path (the early tryEarly fetch, the post-reveal
   *  retry, the endgame safety-net sweep) permanently misses it, no matter
   *  how many times it's retried — they're all asking the wrong room.
   *  Confirmed live, seed 1: TUBE (holding POT-OF-GOLD this seed) was
   *  stolen from Maintenance Room and dropped in Sandy Cave — a room this
   *  script visits anyway (the river journey) — yet POT-OF-GOLD was never
   *  recovered because every lookup kept pointing at Maintenance Room.
   *  Called after EVERY command (see cmd()), not just goto()'s own steps,
   *  since a room-look can arrive via any path (a scripted river/beach
   *  stop, a retreat, a plain "look"). Gated on `this.currentRoom` being
   *  something OTHER than the vessel's own static home room — the vessel
   *  sitting exactly where it's expected is the overwhelming common case,
   *  already handled by fetchVesselInterior's own early/retry attempts, and
   *  this generator's own severe RNG-sensitivity to added turns (this
   *  file's header/task-report note: any extra command shifts thief-
   *  encounter timing for every seed at once) means this must add real
   *  turns (an "open"/"take" pair via `game.turn()`) ONLY on the genuine,
   *  rare relocation case it exists to catch, not on every ordinary visit
   *  to the vessel's own room. Tolerant of failure (still-Invisible
   *  contents, nothing to do) — a miss here is no worse than the
   *  static-resolution paths it backstops. Uses `this.game.turn()` directly
   *  rather than `this.cmd()`, matching this file's own established
   *  convention for recovery actions issued from inside cmd() itself
   *  (INVENTORY_ROBBED_RE/DISARM_RE do the same, just above) — avoids
   *  recursing back into cmd()'s own logging/death-check plumbing mid-call. */
  private async recoverRelocatedVessel(output: string): Promise<void> {
    for (const [vesselId, signature] of Object.entries(VESSEL_SIGNATURE)) {
      if (!signature.test(output)) continue;
      if (this.roomOfContainer(vesselId) === this.currentRoom) continue; // still where it belongs
      const loc = graph.locations.find(l => l.containerId === vesselId);
      const item = loc !== undefined ? this.placements[loc.id] : undefined;
      if (item === undefined || this.takenItems.has(item) || NOUN[item] === undefined) continue;
      const vesselNoun = NOUN[vesselId];
      if (vesselNoun === undefined) continue;
      await this.game.turn(`open ${vesselNoun}`);
      const takeOut = await this.game.turn(`take ${NOUN[item]}`);
      if (!/can't see any|don't see|nothing here|too dark to see|your load is too heavy/i.test(takeOut.output)) {
        this.takenItems.add(item);
      }
    }
  }

  /** Recovers COAL from wherever the thief relocated it after stealing it
   *  off the ground while it sat dropped (coalDroppedAt tracks exactly
   *  this — see takeItem()'s own overload-shedding comment). Unlike a
   *  pinned vessel, COAL is ordinary filler with no `open` step: its own
   *  room-listing text ("There is a small pile of coal here.") is a direct
   *  take target. COAL is TVALUE==0, so unlike TORCH/POT-OF-GOLD-class
   *  treasures, a thief who takes it NEVER gives it back (depositBooty only
   *  returns TVALUE>0 items) — once genuinely gone, it's gone for good, and
   *  the coal-machine ritual (hence DIAMOND, 20 points) becomes
   *  unreachable. Confirmed live, seed 1: COAL sat dropped at LOUD-ROOM for
   *  thousands of turns (chronically too heavy to reclaim — see
   *  reclaimCoalIfDropped's own retry, which kept deferring rather than
   *  failing loud) before the thief took it, and it was never seen again.
   *  Gated on `coalDroppedAt !== undefined` (we know it's NOT currently
   *  held) rather than takenItems (COAL is marked taken from its ORIGINAL
   *  early fetch and stays so even after being dropped) — same "static
   *  tracking goes stale once the thief acts" class this file's vessel
   *  recovery above exists for, just without a container to open first. */
  private async recoverStrandedCoal(output: string): Promise<void> {
    if (this.coalDroppedAt === undefined) return;
    if (this.currentRoom === this.coalDroppedAt) return; // reclaimCoalIfDropped's own normal path covers this
    if (!/small pile of coal/i.test(output)) return;
    const out = await this.game.turn('take coal');
    if (!/can't see any|don't see|nothing here|your load is too heavy/i.test(out.output)) {
      this.coalDroppedAt = undefined;
    }
  }

  /** Attempts `take <noun>` in the CURRENT room regardless of `takenItems` —
   *  unlike takeItem()/takeTreasure(), which no-op the instant an item has
   *  EVER been taken once (see takenItems's own doc comment: "already
   *  fetched" is conflated with "still held"). Needed for exactly one case:
   *  a TVALUE>0 treasure already marked taken, then robbed straight out of
   *  the player's own inventory by thief.ts's rob(PLAYER,'THIEF') sometime
   *  later — depositBooty (robber-fcn.ts's F_DEAD) returns it by moving it
   *  to wherever he died (always TREASURE-ROOM here), but every ordinary
   *  recovery path (grabAllAt's itemsPlacedAt, the retry-pass's
   *  takeTreasure) is keyed off the STATIC fill placement, not "what's
   *  physically here now," so a treasure whose real slot ISN'T
   *  TREASURE-ROOM is invisible to all of them even after depositBooty
   *  drops it right here. Confirmed live: seed 1 lost PAINTING, BRACELET,
   *  TRIDENT, BAG-OF-COINS, and SCEPTRE this way — all confirmed "Taken."
   *  once, all still missing from the case at the final deposit, none of
   *  them ever attempted again anywhere in the transcript (the takenItems
   *  no-op silently ate every retry). Returns true if this actually
   *  collected it (and updates takenItems accordingly); false for anything
   *  not really here (the overwhelmingly common case for most callers) —
   *  never throws, since "not here" is the expected outcome for whichever
   *  treasures were NOT stolen. */
  async forceTakeHere(itemId: string): Promise<boolean> {
    const noun = NOUN[itemId];
    if (noun === undefined) return false;
    const out = await this.cmd(`take ${noun}`);
    // "Your load is too heavy" is NOT a "not here" failure — the item IS
    // physically present, we're just overloaded — and treating it as one
    // (the original version of this method did, via an incomplete regex)
    // silently marked the item "taken" without ever actually holding it:
    // confirmed live, PAINTING/TRIDENT both hit exactly this, permanently
    // (and falsely) recorded as recovered while sitting untouched in
    // Treasure Room, invisible to every later retry for the same reason
    // takenItems hides a stolen item in the first place. Treat it as a
    // genuine miss so the caller's interleaved depositAll()+retry loop
    // gets a real chance once weight clears.
    if (/your load is too heavy/i.test(out)) return false;
    if (/can't see any|don't see|nothing here/i.test(out)) return false;
    // "You already have that!" (holding it already) and "Taken."
    // (freshly picked up) are both genuine success — either way we now
    // hold it.
    this.takenItems.add(itemId);
    return true;
  }

  /** The physical room a real item currently resolves to, or undefined if
   *  it's event-created, unplaced, or nested in the EGG (those cases are
   *  each handled by their own dedicated logic elsewhere). */
  roomOfItem(itemId: string): string | undefined {
    if (PINNED_TREASURE_VESSELS.has(itemId)) return resolveCurrentRoom(itemId, this.locationIdByItemId);
    const locId = this.locationIdByItemId.get(itemId);
    if (locId === undefined) return undefined;
    const loc = locByIdGlobal.get(locId);
    if (loc === undefined || loc.containerId === 'EGG') return undefined;
    return this.roomOfContainer(loc.containerId);
  }

  /** Every real item whose current placement physically resolves to
   *  roomId (used for opportunistic pickup while passing through a room
   *  reachable only via a scripted sequence — e.g. mid-river — rather than
   *  free BFS navigation). */
  itemsPlacedAt(roomId: string): string[] {
    const result: string[] = [];
    for (const [itemId, locId] of this.locationIdByItemId) {
      const loc = locByIdGlobal.get(locId);
      if (loc === undefined || loc.containerId === 'EGG') continue;
      const room = roomIds.has(loc.containerId) ? loc.containerId : STATIC_ROOM_OF.get(loc.containerId);
      if (room === roomId) result.push(itemId);
    }
    return result;
  }

  /** Take wanted (NOUN-mapped) items physically at roomId. Assumes the
   *  caller has already arranged `currentRoom === roomId` (so takeItem's
   *  internal goto is a no-op) — used for scripted-sequence rooms like the
   *  river drift where free BFS navigation doesn't apply.
   *  `progressionOnly` skips treasures entirely — loadMax=100 (src/engine/
   *  game.ts) can be exceeded well before a multi-stop opportunistic sweep
   *  finishes (confirmed live: an overloaded "take rope" at End of Rainbow),
   *  and there's no Living-Room deposit stop anywhere in the river/beach/
   *  rainbow run to relieve it. Structurally-required progression items are
   *  never worth risking for an optional treasure grabbed a step early —
   *  callers pass true here and come back for the treasures after a deposit
   *  trip once Shore/Sandy Beach/Sandy Cave/End of Rainbow are reachable
   *  again via the (by-then-permanent) rainbow crossing. */
  async grabAllAt(roomId: string, progressionOnly = false): Promise<void> {
    const isProgression = (id: string): boolean => graph.items.find(i => i.id === id)?.class === 'progression';
    const items = this.itemsPlacedAt(roomId)
      .filter(id => NOUN[id] !== undefined)
      .filter(id => !progressionOnly || isProgression(id))
      // A redundant weapon-class item (see REDUNDANT_WEAPON_CLASS's own doc
      // comment) is never worth an opportunistic pickup — it serves no
      // purpose once some OTHER weapon is already in hand, and this sweep
      // has no per-item "shed and reclaim" logic to fall back on if it
      // pushes something else over loadMax. Confirmed live, seed 1:
      // RUSTY-KNIFE (SIZE 20), opportunistically grabbed here at Sandy
      // Beach purely because it happened to be sitting in the river area,
      // was carried for the entire rest of the game and was enough on its
      // own to push the much-later COFFIN (SIZE 55) fetch over loadMax.
      .filter(id => !(REDUNDANT_WEAPON_CLASS.has(id) && id !== this.weaponItemId));
    items.sort((a, b) => Number(isProgression(b)) - Number(isProgression(a)));
    for (const itemId of items) {
      if (isProgression(itemId)) {
        // A progression item genuinely missing here IS a real problem (see
        // takeItem()'s own hard-failure contract) — must still propagate.
        await this.takeItem(itemId);
        continue;
      }
      // Non-progression treasures/filler are best-effort: this is an
      // OPPORTUNISTIC sweep (this method's own doc comment), and a treasure
      // temporarily unreachable — stolen by the thief before this sweep got
      // to it, thief.ts's ROOM-treasure robbery is unconditional whenever
      // he visits ANY room with one sitting exposed — is expected and
      // recoverable later (the endgame safety-net sweep over
      // ALL_TREASURE_IDS, and doThiefHunt's own post-kill forceTakeHere
      // pass, both retry every treasure regardless of where this sweep left
      // off). Confirmed live, seed 1: POT-OF-GOLD sat exposed in Sandy Cave
      // for hundreds of turns before doRiverJourney's own grabAllAt call
      // here ever reached it, the thief took it in the meantime, and a hard
      // throw over that one unlucky treasure crashed the entire river
      // journey (and everything scripted after it) instead of just moving
      // on to whatever else this sweep still had to do.
      try {
        await this.takeItem(itemId);
      } catch {
        // left for the endgame safety-net sweep / doThiefHunt's own retry
      }
    }
  }
}

const ALL_TREASURE_IDS = graph.items.filter(i => i.isTreasure).map(i => i.id);
const RIVER_AREA_ROOMS = new Set(['RIVER-1', 'RIVER-2', 'RIVER-3', 'RIVER-4', 'RIVER-5', 'SHORE', 'SANDY-BEACH', 'SANDY-CAVE']);

/** Retries all three non-treasure pinned vessels' interior fetch — called
 *  immediately after EVERY `wave sceptre` that sets RAINBOW-FLAG (both call
 *  sites: this file's own SCEPTRE-as-weapon canyon detour, and
 *  doRiverJourney below), since that's the earliest point an item like
 *  POT-OF-GOLD (Flag.Invisible baked into its own object data, cleared only
 *  by SCEPTRE-FUNCTION's reveal) could possibly have stopped being
 *  invisible. See Playthrough.fetchVesselInterior's own doc comment for why
 *  a single early attempt alone isn't enough. Each vessel is tried
 *  independently and tolerantly (idempotent via takenItems, harmless if the
 *  vessel holds nothing revealed yet, or nothing at all) — a still-failing
 *  fetch here is left for the endgame safety-net sweep, exactly as before
 *  this retry existed. */
async function retryVesselInteriors(p: Playthrough): Promise<void> {
  for (const vesselId of ['BOTTLE', 'SANDWICH-BAG', 'TUBE']) {
    try {
      await p.fetchVesselInterior(vesselId);
    } catch {
      // Still not reachable/visible from here (e.g. the vessel itself has
      // since been relocated by the thief) — the later sweep gets one more
      // try.
    }
  }
}

/** Inflate/board/launch/drift the boat down the Frigid River, opportunistically
 *  grabbing whatever real items physically sit at each stop (RIVER-1..5,
 *  SHORE, SANDY-BEACH, SANDY-CAVE) — not just the treasures traditionally
 *  found there, since full-item-shuffle can place a progression item (e.g.
 *  SCEPTRE itself, on one of the pinned golden seeds) anywhere in this area.
 *  Idempotent (guarded by RIVER-DONE) — safe to call speculatively from the
 *  progression loop AND from the later treasure pass. */
// Drifts by repeatedly waiting until the engine's OWN reported room (synced
// into p.currentRoom by cmd() after every turn) actually advances — rather
// than trusting a fixed wait-count copied from tools/oracle/corpus/c-river.txt.
// That fixed schedule assumed a specific number of commands per stage; this
// script's own opportunistic pickups (grabAllAt) issue a variable number of
// extra turns at each stop, which ticks the same I-RIVER clock and throws a
// fixed count off (confirmed live: it silently desynced the whole rest of
// seed 1's script from the real engine state).
async function driftUntil(p: Playthrough, nextRoom: string, maxWaits = 12): Promise<void> {
  for (let i = 0; i < maxWaits && p.currentRoom !== nextRoom; i++) {
    await p.cmd('wait');
  }
  if (p.currentRoom !== nextRoom) {
    throw new Error(`river drift: expected to reach ${nextRoom} within ${maxWaits} waits, stuck at ${p.currentRoom}`);
  }
}

async function doRiverJourney(p: Playthrough): Promise<void> {
  if (p.flags.has('RIVER-DONE')) return;
  // The boat run is only possible with BOTH the boat and the pump genuinely
  // in hand (p.takenItems records confirmed takes only) — the survey found
  // 6 candidate seeds where a river-area item's forward-order position
  // preceded PUMP/INFLATABLE-BOAT ownership, because the logic graph's
  // shore-side locations (SHORE/SANDY-BEACH/SANDY-CAVE/ARAGAIN-FALLS) carry
  // an `any` alternative accepting SCEPTRE (the rainbow crossing) instead
  // of boat+pump, and the fill is free to justify them that way — or
  // because PUMP itself sat thief-deferred in TREASURE-ROOM. The old
  // version barreled into "inflate boat with pump" regardless ("You can't
  // see any pump here!") and got stuck at DAM-BASE forever. Defer instead
  // (no RIVER-DONE flag set): shore-side items are fetched on foot via the
  // rainbow by the progression pass's own fallback, and the boat run is
  // retried by the post-thief-hunt recovery once boat+pump are complete.
  if (!p.takenItems.has('INFLATABLE-BOAT') || !p.takenItems.has('PUMP')) return;
  // Return-crossing preflight: once beached, the rainbow is the ONLY way
  // back (see the comment at the Aragain wave below), and that requires
  // either RAINBOW-FLAG already solid or SCEPTRE recoverable EN ROUTE
  // (the seed-1 case: sceptre itself shuffled into the river area, grabbed
  // mid-drift, waved at Aragain Falls). The survey found 5 candidate seeds
  // where NEITHER held: the journey launched with the sceptre sitting
  // somewhere else entirely, and the Aragain wave failed "You can't see
  // any sceptre here!" — a genuine stranding. So: try to fetch the sceptre
  // and solidify the rainbow from the canyon side FIRST (ensureRainbow —
  // the sceptre is a treasure, so the journey-start depositAll right below
  // banks it before boarding, which also keeps it clear of RBOAT's sharp-
  // object puncture check); if the rainbow still isn't solid and the
  // sceptre is NOT waiting in the river area either, DEFER the whole
  // journey (no RIVER-DONE) — the post-thief-hunt recovery pass retries
  // once the sceptre becomes obtainable.
  if (!p.flags.has('RAINBOW-FLAG')) {
    if (!p.takenItems.has('SCEPTRE')) {
      try {
        await p.takeItem('SCEPTRE');
      } catch {
        // not obtainable yet — the deferral below decides what that means
      }
    }
    await ensureRainbow(p); // no-op if the sceptre still isn't in hand
    if (!p.flags.has('RAINBOW-FLAG')) {
      const sceptreRoom = p.roomOfItem('SCEPTRE');
      if (sceptreRoom === undefined || !RIVER_AREA_ROOMS.has(sceptreRoom)) return;
      // else: the sceptre awaits mid-river — the Aragain-side wave covers the return
    }
  }
  // If either journey tool was parked by an earlier overload relief (see
  // prepareLoadFor's parking tier), fetch it back first — this is the one
  // consumer site the parking contract promises to reclaim at.
  await p.reclaimParked('INFLATABLE-BOAT');
  await p.reclaimParked('PUMP');
  // Deposit everything carryable first — loadMax=100 (src/engine/game.ts) is
  // easily exceeded by the time several treasures/progression items have
  // been collected, and the river's several back-to-back opportunistic
  // grabAllAt calls (with no Living-Room stop in between — there isn't one
  // once past Dam Base until the rainbow escape) have no chance to unload
  // partway through. Confirmed live: an overloaded "take rope" at End of
  // Rainbow failed with "Your load is too heavy," and — before takeItem
  // checked its own output — that failure was silently recorded as success.
  await depositAll(p);
  await p.goto('DAM-BASE');
  await p.cmd('drop boat'); // IBOAT-FUNCTION requires the boat ON THE GROUND (parent === here) to inflate
  await p.cmd('inflate boat with pump');
  await p.cmd('drop pump'); // no longer needed — its SIZE(5) would later block EMPTY-HANDED (coal machine)
  // RBOAT-FUNCTION punctures the boat on BOARD if carrying ANY of SCEPTRE/
  // KNIFE/SWORD/RUSTY-KNIFE/AXE/STILETTO (src/actions/boat.ts's explicit
  // SHARP_OBJECT_IDS check) — i.e. every weapon candidate this generator
  // could have picked. Drop it here at Dam Base; retrieved via a detour back
  // here once BFS connectivity is fully restored (LOW-TIDE + the permanent
  // trap door + — if it was the sceptre — RAINBOW-FLAG already set by the
  // early canyon detour, so the weapon's absence during the crossing never
  // strands anything).
  if (p.weaponNoun !== undefined) await p.cmd(`drop ${p.weaponNoun}`);
  await p.cmd('board boat');
  await p.cmd('launch'); // currentRoom synced to RIVER-1 by cmd() itself
  await p.grabAllAt('RIVER-1');
  await driftUntil(p, 'RIVER-2');
  await p.grabAllAt('RIVER-2');
  await driftUntil(p, 'RIVER-3');
  await p.grabAllAt('RIVER-3');
  await driftUntil(p, 'RIVER-4');
  await p.grabAllAt('RIVER-4');
  await driftUntil(p, 'RIVER-5');
  await p.grabAllAt('RIVER-5');
  await p.cmd('east');
  if (p.currentRoom !== 'SHORE') {
    throw new Error(`river drift: "east" from RIVER-5 landed at ${p.currentRoom}, expected SHORE`);
  }
  await p.cmd('disembark'); // rboatMBeg blocks all non-east/west/land movement until this — tools/oracle/corpus/c-sand.txt
  // Progression-only on this first pass — see grabAllAt's doc comment.
  // Treasures here are collected on the second pass below, after depositing.
  await p.grabAllAt('SHORE', true);
  await p.goto('SANDY-BEACH');
  await p.grabAllAt('SANDY-BEACH', true);
  await p.goto('SANDY-CAVE');
  await p.grabAllAt('SANDY-CAVE', true);
  p.flags.add('RIVER-DONE');

  // Once beached, the ONLY way back to the rest of the map is via the
  // rainbow (Aragain Falls <-> On Rainbow <-> End of Rainbow, ifFlag
  // RAINBOW-FLAG) — there is no walking path back upstream. This requires
  // SCEPTRE, which by this point is always already owned on all 3 pinned
  // golden seeds (fetched earlier in forward order, or — seed 1 — just now,
  // opportunistically, at Sandy Cave itself).
  await p.goto('SHORE');
  await p.goto('ARAGAIN-FALLS');
  if (!p.flags.has('RAINBOW-FLAG')) {
    const waveOut = await p.cmd('wave sceptre');
    // Verify the engine's own success text before recording the crossing
    // as open (see ensureRainbow's doc comment for the desync this
    // prevents) — but unlike the canyon-side call sites, a failure HERE is
    // a hard stop, not a deferral: this side of the river has no other way
    // back (the whole point of this wave), so a stolen/missing sceptre at
    // this exact moment is a genuine stranding.
    if (!/rainbow appears to become solid/i.test(waveOut)) {
      throw new Error(`river journey: "wave sceptre" at Aragain Falls did not solidify the rainbow — stranded on the shore side; output: ${JSON.stringify(waveOut)}`);
    }
    p.flags.add('RAINBOW-FLAG');
    await retryVesselInteriors(p); // see this function's own doc comment
  }
  await p.goto('END-OF-RAINBOW');
  await p.grabAllAt('END-OF-RAINBOW', true); // progression only — see above
  await p.goto('CLEARING'); // reconnect to the surface map

  // Retrieve the weapon left at Dam Base — fully reachable again now (trap
  // door permanently open, LOW-TIDE set, and the rainbow crossing no longer
  // needed to get back out).
  if (p.weaponNoun !== undefined) {
    await p.goto('DAM-BASE');
    await p.cmd(`take ${p.weaponNoun}`);
    await p.goto('CLEARING');
  }

  // Deposit everything from the RIVER-1..5 leg (can't be deferred — no
  // return there), THEN come back — now empty-handed — for the treasures
  // left behind at Shore/Sandy Beach/Sandy Cave/End of Rainbow, all
  // permanently reachable via the rainbow crossing set above.
  await depositAll(p);
  await p.goto('SHORE');
  await p.grabAllAt('SHORE');
  await p.goto('SANDY-BEACH');
  await p.grabAllAt('SANDY-BEACH');
  await p.goto('SANDY-CAVE');
  // SCARAB (objects.json) starts with Flag.Invisible baked in — vanilla's
  // "hidden until dug up" mechanic — and beach.ts's SAND-FUNCTION clears it
  // via a GLOBAL `ctx.world.get('SCARAB')` lookup (not scoped to whatever
  // currently sits in Sandy Cave), so performing the dig ritual HERE
  // reveals the real SCARAB item wherever full-item-shuffle actually placed
  // it — confirmed live: without ever digging, "take scarab" failed
  // "You can't see any scarab here!" even standing directly in the room
  // SCARAB had been shuffled into (seed 1: the SKULL slot, Land of the
  // Living Dead) — the object was physically present but still flagged
  // invisible from world-init. BEACH-DIG must land on EXACTLY next===3 (the
  // 4th dig) to reveal; a 5th collapses the hole and is fatal
  // (next>3 → jigsUp) — dig exactly 4 times, no more.
  await p.reclaimParked('SHOVEL'); // the dig is the parking contract's one consumer site for SHOVEL
  await p.takeItem('SHOVEL');
  for (let i = 0; i < 4; i++) await p.cmd('dig sand with shovel');
  await p.cmd('drop shovel'); // done its one-time job (SIZE 15) — drop now rather than
  // carry it all the way to the coal machine's junk-drop list; confirmed
  // live: the accumulated weight (SCARAB/CANARY/BAUBLE/SHOVEL/GARLIC/...)
  // made the later safety-net sweep's "take coffin" (COFFIN alone is SIZE
  // 55) fail "Your load is too heavy."
  await p.grabAllAt('SANDY-CAVE');
  await p.goto('ARAGAIN-FALLS');
  await p.goto('END-OF-RAINBOW');
  await p.grabAllAt('END-OF-RAINBOW');
  await depositAll(p);
}

/** `keepTorch`: TORCH (objects.json: isTreasure) is ALSO this generator's
 *  permanent light-source substitute for the (finite, burns-out) lamp once
 *  fetched early (see the tryEarly fetch's comment) — every depositAll()
 *  call defaults to holding onto it rather than banking its TVALUE
 *  immediately, since goto()'s lamp-conservation logic keys off
 *  `takenItems.has('TORCH')`, not "is it in the case." Confirmed live:
 *  depositing it during the safety-net sweep (as soon as it was taken)
 *  handed navigation back to the finite lamp for the rest of the game,
 *  which then genuinely ran out and a subsequent dark-room move died to a
 *  grue — deposit it for real only once, explicitly, right before the
 *  final walk home (playSeed passes `keepTorch: false` there). */
async function depositAll(
  p: Playthrough,
  opts: { keepTorch?: boolean; exclude?: ReadonlySet<string> } = {},
): Promise<void> {
  const keepTorch = opts.keepTorch ?? true;
  // No reliable light (TORCH stolen by the still-alive thief, LAMP already
  // burned out — see hasNoReliableLight's own doc comment) and not already
  // standing in Living Room: skip this deposit pass entirely rather than
  // gambling a cross-map round trip on the tightly bounded MATCH-COUNT(6)
  // budget. depositAll() is called extremely often (the safety-net sweep
  // alone calls it once per treasure, up to 19 times) — confirmed live,
  // seed 1: several of those calls landing back-to-back during exactly
  // this window collectively burned through the whole match budget and
  // died to a grue mid-walk. Nothing here is lost permanently: whatever
  // would have been deposited stays safely held (subject to its own
  // ordinary weight limits) and gets banked by a LATER depositAll() call
  // once light is reliable again (doThiefHunt's post-kill recovery, or
  // simply TORCH/LAMP never having needed shedding at all on a luckier
  // seed).
  if (hasNoReliableLight(p) && p.currentRoom !== 'LIVING-ROOM') return;
  // The upfront check above only catches "no light BEFORE this call even
  // starts" — a robbery can still land mid-transit on a call that started
  // safely lit, and goto()'s own match-budget check can then throw a
  // specific, distinguishable "MATCH-COUNT(6) exhausted" error instead of
  // a blind, possibly-fatal continuation. Catch exactly that known pattern
  // here (this call's own destination was never itself the essential
  // trip) and defer to a later depositAll(), same as the upfront skip;
  // anything else (a genuine death, an unrelated desync) must still
  // propagate as a real failure.
  try {
    await p.goto('LIVING-ROOM');
  } catch (err) {
    if (err instanceof Error && /MATCH-COUNT\(6\) exhausted/.test(err.message)) {
      return;
    }
    throw err;
  }
  await p.cmd('open trophy case');
  for (const t of ALL_TREASURE_IDS) {
    if (t === p.weaponItemId) continue; // still needed in hand — see weaponItemId's doc comment
    if (t === 'TORCH' && keepTorch) continue; // see this function's own doc comment
    if (opts.exclude?.has(t) === true) continue; // caller still needs it in hand (e.g. EGG, unopened)
    const noun = NOUN[t];
    if (noun !== undefined) {
      await p.cmd(`put ${noun} in case`);
      if (t === 'TORCH') p.hasTorch = false; // genuinely out of hand now — see hasTorch's own doc comment
    }
  }
  p.flags.add('COFFIN-CURE'); // no longer held (deposited, or never taken) — see the flag's own doc comment
  // Depositing treasures is exactly what frees up load-bearing weight, so
  // this is the natural, recurring moment to retry a COAL reclaim that
  // earlier failed purely on weight (coalDroppedAt tracks this — see
  // takeItem()'s own overload-shedding comment and reclaimCoalIfDropped's
  // own doc comment). Previously only attempted at a handful of dedicated
  // checkpoints scattered through playSeed, which could leave COAL sitting
  // exposed, dropped, for a huge stretch of the game — confirmed live,
  // seed 1: thousands of turns between the drop and the next checkpoint,
  // long enough for the thief to take it (COAL is TVALUE==0 filler, so
  // unlike a treasure it's gone for good once he does — no depositBooty
  // return). depositAll() itself runs FAR more often than those checkpoints
  // (after nearly every meaningful pickup throughout the whole script), so
  // retrying here closes the exposure window to "until the next deposit"
  // instead of "until some later, dedicated checkpoint happens to run."
  await reclaimCoalIfDropped(p);
  // Same rationale, same choke point, for a shed-and-stuck weapon
  // (weaponDroppedAt — see takeItem()'s own overload-shedding comment and
  // reclaimWeaponIfDropped's own doc comment).
  await reclaimWeaponIfDropped(p);
  // Same again for a shed-and-stuck SCREWDRIVER (screwdriverDroppedAt —
  // see reclaimScrewdriverIfDropped's own doc comment).
  await reclaimScrewdriverIfDropped(p);
  // ...and for a shed-and-stuck GARLIC (garlicDroppedAt — see
  // reclaimGarlicIfDropped's own doc comment).
  await reclaimGarlicIfDropped(p);
}

/**
 * Hunts and kills the thief — deliberately done LATE (after nearly every
 * other treasure is collected and deposited), not right after the troll as
 * an earlier draft had it. verbDiagnose (1actions.zil:3993) ties player
 * combat survivability directly to SCORE: `MS = 2 + floor(score/70)`,
 * `RS = MS + pStrength`. At low score (MS=2), even "perfect health" (no
 * active wound) is only `RS=2` — "you can be killed by a serious wound" —
 * so NO amount of retreating-to-heal actually makes the fight safe; only a
 * higher score does. Confirmed live (twice): fighting him early, near-zero
 * score, got the player killed outright even after a full "wait out the
 * wound" recovery — an unaffordable outcome (death.ts's -10 penalty makes
 * the exact-350 target permanently unreachable). By the time this runs,
 * score already reflects most of the 19 treasures, comfortably raising MS.
 * Also the first SAFE visit to the (thief-guarded) Treasure Room (see the
 * Cyclops-interlude comment) — its +25 first-visit score lands here — and
 * gives the egg (already in hand — see its early, safe, non-combat fetch)
 * a chance to be opened safely via the thief's death (depositBooty's
 * EGG-SOLVE hook; required for 2 of 3 golden seeds where a required
 * treasure landed inside the pinned EGG).
 */
/** Walks back and re-takes TORCH from wherever goto()'s coal-gas guard had
 *  to drop it (see that comment) — a no-op if it was never dropped this
 *  way. Called BEFORE doThiefHunt specifically: the fight's own
 *  diagnose/kill loop can run up to 150 turns with the lamp continuously
 *  ON (it genuinely needs light to see the thief — unlike the cure-wait
 *  retreat, which already turns the lamp off) — confirmed live: entering
 *  the fight relying on an already-depleted lamp burned through its
 *  remaining fuel entirely partway through, and every subsequent "kill
 *  thief" failed "It's too dark to see!" for the rest of the 150-attempt
 *  budget, never landing the confirming blow. TORCH never runs out, so
 *  reclaiming it before the fight removes the risk entirely rather than
 *  budgeting turns against it. */
/** True when this generator currently has NO reliable light source at all —
 *  no TORCH in hand, and LAMP permanently dead (lampBurnedOut). The only
 *  thing left in that state is MATCH's own tightly bounded, whole-game
 *  budget (MATCH-COUNT(6), clock.ts) — fine for goto()'s own single-step
 *  emergency dash, but a multi-room reclaim trip can burn through the
 *  entire remaining budget mid-walk and die to a grue with no light left
 *  at all for the final step (confirmed live, seed 1: exactly this,
 *  reclaiming COAL from three rooms away). Used to DEFER a reclaim attempt
 *  rather than gamble it on the match budget — the item stays tracked
 *  (dropped) for the next checkpoint, by which point doThiefHunt's own
 *  post-kill recovery (`if (!p.hasTorch) { take torch }`, once he's dead —
 *  depositBooty returns any TVALUE>0 item he stole, TORCH included)
 *  should have restored real light. Never gates reclaiming TORCH itself
 *  (reclaimTorchIfDropped) — that scenario is a short, KNOWN-safe hop from
 *  a deliberate goto()-side drop, not the thief's theft, and reclaiming it
 *  IS the fix for having no light in the first place. */
function hasNoReliableLight(p: Playthrough): boolean {
  return !p.hasTorch && p.lampBurnedOut;
}

async function reclaimTorchIfDropped(p: Playthrough): Promise<void> {
  if (p.torchDroppedAt === undefined) return;
  await p.goto(p.torchDroppedAt);
  const out = await p.cmd('take torch');
  // Same "never assume the reclaim succeeded" discipline as goto()'s own
  // deferred-reclaim branch (see its own doc comment) — TORCH sitting here,
  // exposed, for however long elapsed since it was dropped is exactly what
  // thief.ts's ROOM-treasure robbery (`ctx.rob(here, 'THIEF', 100)`) can
  // take, unconditionally, before this ever runs. Confirmed live: assuming
  // success here left `hasTorch` falsely true, and every subsequent goto()
  // then skipped its own lamp-conservation entirely (the `!hasTorch` gate),
  // sending navigation into unlit rooms with nothing actually lit.
  if (!/can't see any|don't see|nothing here/i.test(out)) {
    p.hasTorch = true;
  }
  p.torchDroppedAt = undefined;
}

/** Walks back and re-takes COAL from wherever takeItem()'s overload-
 *  recovery had to leave it (see that comment) — a no-op if it was never
 *  left behind this way. Unlike reclaimTorchIfDropped, this doesn't
 *  unconditionally clear coalDroppedAt: if we're STILL too heavy to hold it
 *  again (whatever pushed COAL out in the first place hasn't been shed
 *  yet), leave it recorded so a later, lighter opportunity can retry —
 *  exactly the same "leave a clear trail rather than silently drop
 *  tracking" discipline as its take-side counterpart just above. */
async function reclaimCoalIfDropped(p: Playthrough): Promise<void> {
  if (p.coalDroppedAt === undefined) return;
  if (hasNoReliableLight(p)) return; // see hasNoReliableLight's own doc comment — retried at the next checkpoint
  const room = p.coalDroppedAt;
  await p.goto(room);
  const out = await p.cmd('take coal');
  if (!/your load is too heavy/i.test(out)) {
    p.coalDroppedAt = undefined;
  }
}

/** Walks back and re-takes SCREWDRIVER from wherever COFFIN's own overload
 *  recovery had to leave it (see takeItem()'s PINNED_TREASURE_VESSELS
 *  branch) — a no-op if it was never left behind this way. Mirrors
 *  reclaimCoalIfDropped exactly (same weight-retry tolerance, same
 *  hasNoReliableLight deferral) — SCREWDRIVER is only ever shed right
 *  where COFFIN itself was fetched, immediately after being extracted from
 *  the coffin's own interior specifically so it wouldn't be lost with it
 *  (see that call site's own comment), so losing track of it here would
 *  silently strand the coal-machine puzzle much later (`turn switch with
 *  screwdriver`) with no vessel left to blame it on. */
async function reclaimScrewdriverIfDropped(p: Playthrough): Promise<void> {
  if (p.screwdriverDroppedAt === undefined) return;
  if (hasNoReliableLight(p)) return; // see hasNoReliableLight's own doc comment — retried at the next checkpoint
  const room = p.screwdriverDroppedAt;
  await p.goto(room);
  const out = await p.cmd('take screwdriver');
  if (!/your load is too heavy/i.test(out)) {
    p.screwdriverDroppedAt = undefined;
  }
}

/** Walks back and re-takes GARLIC from wherever COFFIN/EGG's own overload
 *  recovery had to leave it (see takeItem()'s PINNED_TREASURE_VESSELS
 *  branch) — a no-op if it was never left behind this way. Mirrors
 *  reclaimScrewdriverIfDropped exactly. MUST succeed before the
 *  coal-machine section's own Bat Room crossing (playSeed's own dedicated
 *  hard-check right before that excursion enforces this — see that call
 *  site's own comment) — garlicDroppedAt's own doc comment explains why
 *  this can never be treated as a permanent, un-reclaimed shed. */
async function reclaimGarlicIfDropped(p: Playthrough): Promise<void> {
  if (p.garlicDroppedAt === undefined) return;
  if (hasNoReliableLight(p)) return; // see hasNoReliableLight's own doc comment — retried at the next checkpoint
  const room = p.garlicDroppedAt;
  await p.goto(room);
  const out = await p.cmd('take garlic');
  if (!/your load is too heavy/i.test(out)) {
    p.garlicDroppedAt = undefined;
  }
}

/** Finds and fetches any Weapon-flagged item OTHER than `excludeId`, at its
 *  real current placement, using the normal takeItem() navigation (full map
 *  access at this point in the game — post-troll, post-cyclops). Needed
 *  when the in-hand weapon is itself a treasure (SCEPTRE, on 2 of 3 golden
 *  seeds) and gets stolen mid-fight by thief.ts's rob(PLAYER,'THIEF') —
 *  TVALUE>0 items are exactly what that robbery targets, and unlike TORCH
 *  (recoverable once the thief dies), a stolen WEAPON leaves the player with
 *  literally nothing to land the killing blow with, a genuine soft-lock
 *  otherwise. Confirmed live: seed 2 lost SCEPTRE this way and burned an
 *  entire 400-attempt budget on "can't see any sceptre here!" with zero
 *  attacks ever actually reaching combat resolution. Returns the new
 *  weapon's noun+id, or undefined if none of WEAPON_IDS is currently
 *  fetchable (a genuine reportable-upstream dead end, not a script bug). */
async function findSubstituteWeapon(
  p: Playthrough,
  excludeId: string,
): Promise<{ noun: string; itemId: string } | undefined> {
  // Weight- and combat-conscious search order, NOT WEAPON_IDS's own order
  // (SWORD/KNIFE/AXE/SCEPTRE, chosen for the pre-troll search's different
  // priority): KNIFE (SIZE 5) is both the thief's OWN vBest weapon (a real
  // combat advantage — combat.ts's villainStrength) and far lighter than
  // AXE (SIZE 25) or SWORD (SIZE 30). This weapon is carried permanently
  // from here to the end of the game (never deposited, no more fights to
  // return it after), so weight compounds — confirmed live: SWORD alone
  // pushed a later, unrelated COAL fetch over loadMax=100 with no way to
  // shed it back down (everything else held was already load-bearing).
  let SUBSTITUTE_PRIORITY = ['KNIFE', 'AXE', 'SWORD'];
  // Emergency lighting: by the time a weapon is stolen mid-fight, both
  // normal light sources can be gone (TORCH stolen alongside/instead of the
  // weapon; LAMP genuinely burned out — LAMP_TABLE's 385-turn budget,
  // clock.ts, confirmed live spent entirely by this point on seed 2) —
  // takeItem()'s own goto() has no light-source option beyond those two, so
  // its navigation throws "It's too dark to see!" for every candidate whose
  // real placement isn't already lit, even though a genuine (if temporary)
  // light source is still sitting unused in inventory: MATCH. Pre-position
  // via gotoWithMatch (relights every step, exactly like the initial LAMP
  // bootstrap dash elsewhere in this file) BEFORE calling takeItem, so its
  // own internal goto() finds us already there and skips navigation
  // entirely — the final "take" then happens within the same match's
  // 2-tick burn window.
  const needsEmergencyLight = !p.hasTorch && !p.lampOn;
  // MATCH-COUNT(6, clock.ts) is a GLOBAL, whole-game budget, not something
  // this rescue gets to itself — every match this search burns getting to a
  // candidate is one fewer left for whatever ordinary combat/navigation
  // comes after it (confirmed live, seed 2: the weight-first order sent
  // this search on a long dash to KNIFE's real placement, spending every
  // remaining match to get there, and the very next ordinary combat
  // retreat — needing light for an entirely unrelated dark room — had
  // none left and died to a grue). When emergency lighting is needed at
  // all, distance is the dominant cost (one match per dark step,
  // ~irreplaceable), so re-sort by ACTUAL PATH LENGTH from here first —
  // weight is still a real cost (see above) but it's a survivable one;
  // running out of matches later isn't. Falls back to the original
  // weight-first order for any candidate bfsPath can't reach at all
  // (sorts after every reachable one, so it's still tried last, exactly
  // as before).
  if (needsEmergencyLight) {
    const pathLength = (id: string): number => {
      try {
        const room = p.roomOfItem(id);
        if (room === undefined || room === p.currentRoom) return 0;
        return p.bfsPath(p.currentRoom, room).length;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    };
    SUBSTITUTE_PRIORITY = [...SUBSTITUTE_PRIORITY].sort((a, b) => pathLength(a) - pathLength(b));
  }
  for (const candidate of SUBSTITUTE_PRIORITY) {
    if (candidate === excludeId) continue;
    try {
      if (needsEmergencyLight) {
        const room = p.roomOfItem(candidate);
        if (room !== undefined && room !== p.currentRoom) {
          await p.gotoWithMatch(room);
        }
      }
      await p.takeItem(candidate);
      if (p.takenItems.has(candidate)) {
        return { noun: NOUN[candidate]!, itemId: candidate };
      }
    } catch (err) {
      // A genuine player death must NEVER be swallowed here — it's exactly
      // as fatal (death.ts's -10 penalty) as a death anywhere else in this
      // script, and continuing to try the next candidate afterward runs
      // every subsequent takeItem()/goto() against a respawned, teleported,
      // possibly light-source-stripped player, which just produces a second,
      // unrelated failure further downstream (confirmed live, seed 2: a
      // KNIFE-candidate fetch died to a grue mid-goto(), this catch silently
      // moved on to AXE/SWORD, and the eventual reported failure was a much
      // later, unrelated "no substitute reachable" instead of the real death).
      // Everything else caught here IS meant to be swallowed — unreachable,
      // not placed, out of matches — so only re-throw the specific death
      // shapes goto()/cmd() throw (see their own doc comments).
      if (err instanceof Error && /player died/i.test(err.message)) throw err;
    }
  }
  return undefined;
}

/** Walks back and re-takes the current weapon from wherever takeItem()'s
 *  overload-recovery had to leave it (see that method's own comment) — a
 *  no-op if it was never left behind this way. Mirrors
 *  reclaimCoalIfDropped's "leave a clear trail rather than silently drop
 *  tracking" discipline for the ordinary weight case (still too heavy right
 *  where it was left — retry again once something else has been deposited).
 *  Genuinely MISSING ("can't see any") is the harder case a plain weight
 *  retry can't fix — thief.ts's stealJunk can relocate an ordinary
 *  TVALUE==0 weapon (KNIFE/SWORD/AXE) exactly like COAL, and unlike a
 *  treasure it's never returned by depositBooty — so this falls back to
 *  findSubstituteWeapon (the same recovery doThiefHunt's own fight loop
 *  uses for a mid-fight theft) rather than leaving the player with nothing
 *  to fight the thief with later. If no substitute is reachable either,
 *  weaponNoun/weaponItemId are left as-is — whichever later call site
 *  actually needs the weapon (chiefly doThiefHunt) surfaces a clear,
 *  reportable error at the point it's genuinely required, exactly as it
 *  already does for a mid-fight theft with no substitute available. */
async function reclaimWeaponIfDropped(p: Playthrough): Promise<void> {
  if (p.weaponDroppedAt === undefined) return;
  if (hasNoReliableLight(p)) return; // see hasNoReliableLight's own doc comment — retried at the next checkpoint
  const room = p.weaponDroppedAt;
  await p.goto(room);
  const out = await p.cmd(`take ${p.weaponNoun}`);
  if (/can't see any|don't see/i.test(out)) {
    p.weaponDroppedAt = undefined;
    const sub = await findSubstituteWeapon(p, p.weaponItemId ?? '');
    if (sub !== undefined) {
      p.weaponNoun = sub.noun;
      p.weaponItemId = sub.itemId;
    }
    return;
  }
  if (!/your load is too heavy/i.test(out)) {
    p.weaponDroppedAt = undefined;
  }
}

// The four items the Hades exorcism physically requires IN HAND (bell rung
// held, candles lit+held, book read, match to light the candles).
const HADES_ITEMS = ['BELL', 'BOOK', 'CANDLES', 'MATCH'];

/** Waves the (held) SCEPTRE at End of Rainbow to solidify the rainbow —
 *  idempotent (RAINBOW-FLAG guard), a silent no-op when SCEPTRE isn't
 *  actually in hand yet. The flag is set ONLY on the engine's own success
 *  text: an earlier version set it unconditionally after issuing "wave
 *  sceptre", and a sceptre stolen mid-transit (thief robbery can land on
 *  any turn of the goto) made the wave silently fail while the model
 *  recorded the rainbow as solid — every later crossing then bounced off
 *  the (really still gaseous) rainbow, desyncing bfsPath's ON-RAINBOW
 *  routes from reality (confirmed by survey: 3 candidate seeds failed
 *  exactly this way, "ended at ARAGAIN-FALLS instead"). */
async function ensureRainbow(p: Playthrough): Promise<void> {
  if (p.flags.has('RAINBOW-FLAG')) return;
  if (!p.takenItems.has('SCEPTRE')) return;
  await p.goto('END-OF-RAINBOW');
  const out = await p.cmd('wave sceptre');
  if (/rainbow appears to become solid/i.test(out)) {
    p.flags.add('RAINBOW-FLAG');
  }
}

/** One-time DOME-FLAG rope tie — gated on ROPE genuinely in hand
 *  (p.takenItems only records confirmed takes), not on loop progress.
 *  Callable from both the main progression pass and the post-thief-hunt
 *  recovery pass (a ROPE placed in the thief-guarded TREASURE-ROOM is
 *  silently deferred by takeItem until he's dead — see that guard). */
async function doRopeTie(p: Playthrough): Promise<void> {
  if (p.flags.has('DOME-FLAG')) return;
  if (!p.takenItems.has('ROPE')) return;
  await p.goto('DOME-ROOM');
  await p.cmd('tie rope to railing');
  p.flags.add('DOME-FLAG');
  await p.cmd('drop rope'); // done its one-time job; SIZE 10 — drop now, not batched later
}

/** One-time LOW-TIDE dam drain — same possession-honest gating and
 *  dual-call-site rationale as doRopeTie. */
async function doDamDrain(p: Playthrough): Promise<void> {
  if (p.flags.has('LOW-TIDE')) return;
  if (!p.takenItems.has('WRENCH')) return;
  await p.goto('MAINTENANCE-ROOM');
  await p.cmd('push yellow button');
  await p.goto('DAM-ROOM');
  await p.cmd('turn bolt with wrench');
  for (let i = 0; i < 8; i++) await p.cmd('wait');
  p.flags.add('LOW-TIDE');
  await p.cmd('drop wrench'); // done its one-time job; SIZE 10
}

/** The Hades exorcism + the Land of the Dead visit it unlocks (the SKULL
 *  slot's real occupant). Extracted from the progression loop because the
 *  survey proved it MUST be retryable: on 5 of 57 candidate seeds one of
 *  the four required items (CANDLES or MATCH) was placed in the
 *  thief-guarded TREASURE-ROOM, where takeItem defers it until the thief
 *  is dead — the old inline version fired the ritual anyway (its guard
 *  tracked loop progress, not actual possession) and "light candles with
 *  match" failed "You can't see any candles here!". Returns false (rather
 *  than throwing) when the read-book confirmation is missing — the
 *  ceremony is retryable in the real engine (the red-hot bell cools back
 *  down via its own clock entry), so a pre-hunt failure is deferred to the
 *  post-hunt retry, which escalates to a hard throw as the last chance. */
async function doHadesRitual(p: Playthrough): Promise<boolean> {
  if (p.flags.has('LLD-FLAG')) return true;
  if (!HADES_ITEMS.every(id => p.takenItems.has(id))) return false;
  await p.goto('ENTRANCE-TO-HADES');
  await p.cmd('ring bell'); // XB=true; drops+extinguishes the (held) candles automatically (hades.ts)
  await p.cmd('light match');
  // "burn candles" alone is parser-ambiguous ("What do you want to burn
  // the pair of candles with?") — candlesFcn's own auto-detect-a-lit-
  // match fallback (light-sources.ts) never gets a chance to run
  // because the parser itself demands an indirect object first for a
  // bare V-BURN with no PRSI (confirmed live: seed 1 got exactly that
  // disambiguation prompt). Name the indirect object explicitly, exactly
  // like the vanilla walkthrough.
  await p.cmd('light candles with match');
  // hades.ts's M-END handler only arms XC (the 3-turn window to read
  // the book) when the candles are BOTH lit AND held (`candles.parent
  // === actor`) — lighting them where "ring bell" dropped them (on the
  // ground) is not enough by itself. Must explicitly pick them back up
  // — confirmed live: seed 1's "read book" printed the book's plain
  // flavor text ("Commandment #12592...") instead of the exorcism
  // success text, because XC was never set with the candles left lit
  // but unheld on the ground, and the later "south" into Land of the
  // Living Dead was still blocked ("Some invisible force prevents you
  // from passing through the gate.").
  await p.cmd('take candles');
  await p.cmd('look');
  const readOut = await p.cmd('read book');
  if (!/flee through the walls/i.test(readOut)) {
    return false; // retryable — see this function's own doc comment
  }
  p.flags.add('LLD-FLAG');
  await p.cmd('drop bell'); // done their one-time job; SIZE 5/10/10 —
  await p.cmd('drop book'); // dropped immediately rather than carried
  await p.cmd('drop candles'); // for the rest of the game (loadMax=100
  // is otherwise exceeded well before the coal machine/thief hunt —
  // confirmed live).
  await p.goto('LAND-OF-LIVING-DEAD');
  const skullItem = p.itemAt('SKULL');
  // Under full-item-shuffle, the SKULL slot can hold any placeable
  // item, including ordinary filler this generator never fetches at
  // all (see the file header's own filler list, e.g. TIMBERS) — NOUN
  // has no entry for those by design, and takeTreasure()/takeItem()
  // would throw "no noun mapped" trying to fetch something that
  // contributes nothing to score and gates nothing. Only bother when
  // it's actually a tracked treasure/progression item.
  if (skullItem !== undefined && NOUN[skullItem] !== undefined) {
    await p.takeTreasure(skullItem);
  }
  return true;
}

async function doThiefHunt(p: Playthrough, weaponNounIn: string): Promise<string> {
  let weaponNoun = weaponNounIn;
  await reclaimTorchIfDropped(p);
  await reclaimCoalIfDropped(p);
  await reclaimWeaponIfDropped(p);
  await reclaimScrewdriverIfDropped(p);
  await reclaimGarlicIfDropped(p);
  // Pick up any substitution reclaimWeaponIfDropped just made (a
  // shed-and-stuck weapon that turned out to be genuinely gone) — the fight
  // loop below must use whatever's ACTUALLY in hand, not the noun this
  // function was originally called with.
  weaponNoun = p.weaponNoun ?? weaponNoun;
  await p.goto('TREASURE-ROOM');
  // TORCH is now held (reclaimed above) and never runs out, so it already
  // lights Treasure Room / Cyclops Room for the whole fight regardless of
  // lamp state — but goto()'s own conservation logic only manages the lamp
  // when `!hasTorch`, so once torch is held nothing turns an already-on
  // lamp back OFF. Confirmed live: the lamp stayed lit and burning,
  // needlessly, through this entire up-to-150-turn diagnose/kill/retreat
  // loop (LAMP_TABLE's 385-turn budget, clock.ts) — on top of everything
  // else this generator's long playthrough spends fuel on — and it was
  // exactly that waste that ran the lamp dry one room short of Shaft Room
  // during the coal-machine's own return leg much later, well past the
  // point this fuel could have been saved for free.
  if (p.hasTorch && p.lampOn) await p.cmd('turn off lamp');
  let thiefDone = false;
  for (let i = 0; i < 40 && !thiefDone && !p.gameOver(); i++) {
    const out = await p.cmd('give egg to thief');
    if (/nothing here|can't see any thief|not here/i.test(out)) {
      // He's not here yet — 'wait' doesn't need light (this function's own
      // recurring point: only movement's darkness gate does), so there's no
      // reason to burn LAMP_TABLE fuel (clock.ts) sitting idle when torch
      // isn't covering it. Symmetric turn-on right below, once he's found.
      // darkOnPurpose (see its own doc comment) keeps cmd()'s robbery
      // auto-recovery from relighting mid-search the same way it does for
      // the retreat's cure-wait — a robbery can land on any turn here too.
      if (!p.hasTorch && p.lampOn) await p.cmd('turn off lamp');
      p.darkOnPurpose = true;
      await p.cmd('wait');
      continue;
    }
    p.darkOnPurpose = false;
    if (!p.hasTorch && !p.lampOn) await p.cmd('turn on lamp'); // found him — need light to actually interact
    break;
  }
  // diagnose before every attack — retreat to the (safe — his aggression is
  // Treasure-Room-specific) Cyclops Room and wait out the exact cure time
  // ("cured after N moves") whenever survivability is marginal, rather than
  // guessing a fixed recovery window.
  //
  // Budget raised from 150 to 400: the thief wanders independently of the
  // player (i-thief.ts), and this generator (unlike a short hand-played
  // walkthrough) can catch him away from Treasure Room for a long,
  // genuinely-unlucky stretch — confirmed live, seed 1 exhausted a
  // 150-attempt budget entirely on "can't see any thief" cycles with zero
  // combat ever happening. Safe to raise now that those wait cycles are
  // fuel-free (see the lamp on/off calls just below and at the "not here"
  // branch further down) — this was NOT safe before that fix, when every
  // one of those idle turns burned LAMP_TABLE fuel for nothing.
  for (let i = 0; i < 400 && !thiefDone && !p.gameOver(); i++) {
    const diag = await p.cmd('diagnose');
    // The thief acts every turn regardless of what the player typed —
    // 'diagnose' itself can carry a fatal wandering-attack in its OWN
    // output (confirmed live: seed 2's "diagnose" reported "You can be
    // killed by a serious wound." AND a fatal stiletto thrust in the same
    // turn's text — the death had already happened). Must check
    // immediately, before evaluating atRisk/retreating: the outer loop's
    // `!p.gameOver()` guard only re-checks at the TOP of the next
    // iteration, so without this the retreat branch below (goto/wait/kill)
    // ran a full sequence against an already-dead, respawned-in-a-random-
    // forest player, cascading into a second, unrelated death.
    if (p.gameOver()) break;
    // Retreat on ANY wound, not just the terminal "can be killed by a
    // serious wound" stage — confirmed live (seed 2): the thief's own
    // per-turn attack can escalate light-wound straight to fatal WITHIN
    // the same diagnose call that first reports the terminal stage, i.e.
    // waiting for that message is sometimes already one hit too late.
    // Retreating at the first sign of ANY wound trades a few extra
    // (fuel-conserved) recovery turns for a much larger safety margin.
    const atRisk = !/perfect health/i.test(diag);
    if (atRisk) {
      // Retreat to LIVING-ROOM, not CYCLOPS-ROOM — Cyclops Room is an
      // ORDINARY wander target (rooms.json: no Sacred flag, just Land), so
      // the thief can freely wander in while the player sits there waiting
      // out a cure, and i-thief.ts's branch 2 (playerInRoom && unlit && no
      // troll) fires exactly the same combat engagement it would in
      // Treasure Room. Confirmed live: seed 2 died mid-"wait" in
      // CYCLOPS-ROOM to "the thief bows formally... ends the battle and
      // your life" during what this retreat assumed was a safe recovery —
      // his aggression is NOT actually Treasure-Room-specific, just
      // co-location-specific, and Cyclops Room never blocked that.
      // LIVING-ROOM is flagged Sacred (rooms.json) — i-thief.ts's wander
      // block explicitly excludes Sacred rooms (`!ctx.isRoomSacred`), so
      // the thief can NEVER wander there: provably safe, not just
      // observed-safe-so-far. It's also flagged On (naturally lit), so the
      // fuel-conservation dance below is optional here rather than a
      // darkness-safety requirement — kept anyway since it's still free
      // fuel savings.
      await p.goto('LIVING-ROOM');
      await p.cmd('turn off lamp');
      // Mark this whole wait as deliberately dark so cmd()'s own
      // INVENTORY_ROBBED_RE auto-recovery doesn't undo this conservation
      // the instant a robbery lands mid-wait (see darkOnPurpose's own doc
      // comment — robbery can strike on any turn, "wait" included).
      p.darkOnPurpose = true;
      // Wait out the FULL reported cure time, uncapped, and re-diagnose
      // (looping additional waits if still not "perfect health") rather
      // than trusting a single parsed number capped at 20 moves — confirmed
      // live (seed 2): capping the wait at 20 when the real cure time was
      // 89 sent the player back into combat still wounded, and the very
      // next Treasure-Room encounter stacked a SECOND wound on top of the
      // still-active first one ("several wounds") before dying soon after.
      // Only returning at a confirmed "perfect health" reading closes that
      // gap entirely, however long the real cure genuinely takes.
      for (let guard = 0; guard < 20 && !p.gameOver(); guard++) {
        const redi = await p.cmd('diagnose');
        if (/perfect health/i.test(redi)) break;
        const cureMatch = /cured after (\d+) moves/i.exec(redi);
        const cureMoves = cureMatch !== null ? Number(cureMatch[1]) : 15;
        for (let j = 0; j < cureMoves + 1 && !p.gameOver(); j++) await p.cmd('wait');
      }
      p.darkOnPurpose = false;
      if (p.gameOver()) break;
      // Only relight the lamp if torch isn't already covering it (see this
      // function's own opening comment) — cmd()'s INVENTORY_ROBBED_RE
      // handler already re-lights the lamp on the fly if torch is ever
      // stolen mid-fight, so this is a rare-case fallback, not the normal
      // path.
      if (!p.hasTorch && !p.lampOn) await p.cmd('turn on lamp');
      await p.goto('TREASURE-ROOM');
      continue;
    }
    // Only light the lamp for the attack itself, not the diagnose above —
    // same fuel-conservation logic as the "give egg" probe loop and the
    // retreat branch's own cure-wait. Confirmed live: a wandering thief who
    // simply isn't in Treasure Room most of the time (bad luck, not a
    // script bug) can burn through a huge fraction of this loop's 150-turn
    // budget just on "can't see any thief" cycles — leaving the lamp lit
    // for every one of those, on top of everything else this long
    // playthrough spends fuel on, is exactly what ran it dry one room
    // short of Shaft Room during the coal-machine's own return leg later.
    if (!p.hasTorch && !p.lampOn) await p.cmd('turn on lamp');
    const out = await p.cmd(`kill thief with ${weaponNoun}`);
    // combat.ts's villain-death table (the FATAL row, combat.ts:350-352) has
    // THREE distinct kill-message variants, not two:
    //   "It's curtains for the <defender> as your <weapon> removes his head."
    //   "The fatal blow strikes the <defender> square in the heart: He dies."
    //   "The <defender> takes a fatal blow and slumps to the floor dead."
    // Missing the first ("curtains"/"removes his head") is exactly as bad as
    // missing either of the other two: confirmed live, seed 1's own
    // transcript contained "It's curtains for the thief as your nasty knife
    // removes his head." followed immediately by "Almost as soon as the
    // thief breathes his last breath..." and "As the thief dies, the power
    // of his magic decreases...", i.e. an ALREADY-CONFIRMED, textbook kill —
    // yet the hunt kept going for the rest of its attempt budget (now with
    // the corpse/THIEF object gone from the world entirely, "kill thief"
    // reporting "can't see any thief here" on literally every subsequent
    // attempt) and still reported no confirmed kill at the end. Not "last
    // blow"/"collapses" alone: confirmed live (earlier), "You are still
    // recovering from that LAST BLOW, so your attack is ineffective" (US
    // recovering from HIS hit, not his death) false-matched "last blow" and
    // ended the hunt after 3 attempts while he was very much alive.
    if (/removes his head|he dies\.|slumps to the floor dead|his treasures reappear/i.test(out)) { thiefDone = true; break; }
    if (p.gameOver()) break; // died — nothing more to do here, loudly caught below
    // Our OWN weapon can be stolen mid-fight exactly like TORCH — the
    // in-hand weapon is a treasure (SCEPTRE) on 2 of 3 golden seeds, and
    // thief.ts's rob(PLAYER,'THIEF') targets any TVALUE>0 item we're
    // holding, weapon included. Distinct from "can't see any thief" (he's
    // just not in the room) — this is "the weapon noun itself isn't in our
    // inventory," a hard block on every subsequent attempt (confirmed
    // live: seed 2 burned its entire budget on "can't see any sceptre
    // here!" — the combat table was never even reached).
    if (new RegExp(`can't see any ${weaponNoun} here`, 'i').test(out)) {
      const sub = await findSubstituteWeapon(p, p.weaponItemId ?? '');
      if (sub === undefined) {
        throw new Error(
          `thief hunt: weapon (${weaponNoun}) was stolen mid-fight and no substitute Weapon-flagged ` +
          'item is currently reachable — reportable upstream (a treasure-weapon can be stolen with no ' +
          'recovery path), not a script bug.',
        );
      }
      weaponNoun = sub.noun;
      p.weaponNoun = sub.noun;
      p.weaponItemId = sub.itemId;
      // findSubstituteWeapon's own takeItem() navigation can leave us
      // anywhere on the map (wherever that weapon's real placement is —
      // confirmed live, seed 2: a dark maze room) — explicitly return to
      // Treasure Room (where the thief actually is) before the next
      // diagnose/kill iteration, exactly like the retreat branch already
      // does after its own detour. Without this, the loop just kept
      // diagnosing/attacking from the wrong room forever ("It's too dark
      // to see!" / "can't see any thief" never resolving) instead of ever
      // getting back within reach of him.
      await p.goto('TREASURE-ROOM');
      continue;
    }
    if (/can't see any thief|no thief|nothing here/i.test(out)) {
      if (!p.hasTorch && p.lampOn) await p.cmd('turn off lamp'); // see this loop's own opening comment
      p.darkOnPurpose = true; // see darkOnPurpose's own doc comment
      await p.cmd('wait');
    } else {
      p.darkOnPurpose = false;
    }
  }
  p.darkOnPurpose = false; // loop exited (kill confirmed, death, or budget) — never leave this stuck true

  if (p.gameOver()) {
    throw new Error('player died fighting the thief — a death applies a -10 score penalty, making exact-350 unreachable');
  }
  if (!thiefDone) {
    throw new Error('thief hunt exhausted its attempt budget without a confirmed kill — see the "he dies." detector');
  }

  // Combat is over — the weapon (if it's also a treasure, e.g. SCEPTRE) is
  // now safe to deposit like any other treasure; see weaponItemId's doc
  // comment on the Playthrough class.
  p.weaponItemId = undefined;
  p.thiefDead = true; // unblocks takeItem()'s TREASURE-ROOM guard

  // TORCH (TVALUE>0) can be robbed straight out of the player's own
  // inventory at any point by thief.ts's rob(PLAYER,THIEF) — cmd()'s
  // INVENTORY_ROBBED_RE handler already catches this live (turns the lamp
  // back on) but has no way to re-fetch it. depositBooty (F_DEAD,
  // robber-fcn.ts) deposits every TVALUE>0 item the thief is holding at
  // ctx.hereId — always TREASURE-ROOM here, since the kill always lands
  // there — the instant he dies, i.e. exactly where we're already standing
  // right now. Confirmed live: without this, a stolen TORCH stayed
  // "taken" in `takenItems` (so the coal-machine section's own
  // takeItem('TORCH') silently no-op'd) while the real object sat
  // reachable right here, and the machine's "put torch in basket" failed
  // "can't see any torch here" — with no torch in the lowered basket to
  // light Lower Shaft/Machine Room via TRANSBIT, the empty-handed descent
  // there died to a grue in the dark soon after.
  if (!p.hasTorch) {
    const torchOut = await p.cmd('take torch');
    if (!/can't see any|don't see|nothing here/i.test(torchOut)) p.hasTorch = true;
  }
  // Turn the lamp off now if torch is what's actually providing light —
  // goto()'s own conservation logic never gets a chance to (its `!hasTorch`
  // gate skips the whole block once torch is held), so a lamp left on from
  // the fight itself (this function's own opening comment: up to 150 turns
  // of continuous ON time when torch wasn't available) stays on, burning
  // LAMP_TABLE's budget (clock.ts) for nothing, straight through the
  // retry-pass/safety-net sweep and right up to the coal-machine section.
  // Confirmed live: this exact stretch (~8-9 turns between here and the
  // machine's own basket-loading) was enough on its own to push "nearly
  // out" earlier than it needed to be, leaving the fixed-length return walk
  // one turn short of Shaft Room.
  if (p.hasTorch && p.lampOn) await p.cmd('turn off lamp');

  // Whatever's genuinely in the Treasure Room now (CHALICE, wherever it
  // really landed, plus anything the thief's death dropped here via
  // depositBooty) — grabbed generically, not by assumed slot identity.
  await p.grabAllAt('TREASURE-ROOM');
  // "in case it's NOT physically in this room at all" is a real, expected
  // outcome under full shuffle (CHALICE's actual placement can be anywhere,
  // not just its vanilla Treasure Room slot) — must be tolerant, not a hard
  // failure: confirmed live, seed 2, CHALICE's own real placement was
  // itself mid-theft (an ordinary room-treasure robbery unrelated to the
  // thief's own death right here) at this exact moment, and this call used
  // to throw straight through the safety-net retry pass a few lines below
  // (`for (const t of ALL_TREASURE_IDS) ... tryEarly(...)`) that already
  // exists precisely to give a temporarily-unreachable treasure exactly
  // this kind of second chance.
  try {
    await p.takeTreasure('CHALICE');
  } catch {
    // Left for the safety-net retry pass just below.
  }

  // Blanket sweep: try EVERY treasure noun here, bypassing takenItems
  // entirely (see forceTakeHere's own doc comment) — depositBooty just
  // dropped every TVALUE>0 item the thief ever stole right here, and
  // several of them (confirmed live, seed 1: PAINTING, BRACELET, TRIDENT,
  // BAG-OF-COINS, SCEPTRE) were already marked "taken" from an earlier,
  // since-robbed pickup, which silently defeats every OTHER recovery path
  // (grabAllAt/takeTreasure both key off the static fill placement, not
  // physical presence, so a treasure whose real slot isn't TREASURE-ROOM is
  // invisible to them even sitting right here). Harmless for the (typical)
  // majority not actually present — forceTakeHere just returns false.
  //
  // Deposits after EVERY successful pickup, not once at the end — the
  // thief can accumulate a LOT here (up to several stolen treasures across
  // a long game), and loadMax=100 is easily blown picking them all up in
  // one uninterrupted batch (confirmed live: "take egg"/"take painting"/
  // "take trident" all failed "Your load is too heavy" mid-sweep, only
  // hidden from surfacing because forceTakeHere by design treats that the
  // same as "not here" — a real loss disguised as an expected miss, until
  // it's each thief-recovered treasure specifically instead of every one).
  // EGG is excluded from THIS sweep's deposits (still needed in hand, not
  // yet opened, for the eggContents check right below).
  //
  // Fixed-point over full passes, not a single pass — forceTakeHere can't
  // distinguish "not here" from "here but still too heavy right now" (both
  // return false), so a treasure that fails purely on weight in pass 1
  // deserves a real retry once THAT pass's own successes have been
  // deposited and the load has room again, not a permanent skip. Confirmed
  // live: PAINTING/TRIDENT both failed "too heavy" on their first attempt
  // (heavier items — COFFIN, CHALICE — ahead of them in ALL_TREASURE_IDS
  // order had already piled up) and needed exactly this second pass.
  //
  // `resolved` (LOCAL to this sweep, distinct from p.takenItems) tracks
  // which ids this loop is done with — once forceTakeHere succeeds for an
  // id, retrying it can never do anything new (it's either freshly in hand
  // or was already in hand, e.g. EGG/TORCH/CHALICE from earlier in the
  // script). Without this, EGG (never dropped, always "already have that",
  // which forceTakeHere correctly counts as a success) would report
  // progress on EVERY pass forever — confirmed live, an actual infinite
  // loop, not just a slow one. Only a genuine `false` (not here / still too
  // heavy right now) leaves an id eligible for the next pass.
  // The sweep covers UNHELD PROGRESSION items alongside the treasures:
  // AMENDMENT 4's seeded-mode depositBooty returns EVERYTHING the thief
  // was holding on death — the TVALUE filter is off — so a progression
  // item he stole before this generator ever fetched it (stealJunk works
  // on a ROOM's children; confirmed by survey: BELL/BOOK/CANARY/
  // INFLATABLE-BOAT each vanished pre-fetch on different candidate seeds)
  // is sitting right here too, invisible to every static-placement lookup
  // (its recorded slot is elsewhere). Treasures keep their deposit-per-
  // pickup cadence; progression items just come into hand (they can't be
  // banked, and the fixed-point's own weight-retry gives them second
  // passes after each deposit frees load).
  const unheldProgression = graph.items
    .filter(i => i.class === 'progression' && i.pinned !== true)
    .map(i => i.id)
    .filter(id => !p.takenItems.has(id) && NOUN[id] !== undefined);
  const sweepIds = [...ALL_TREASURE_IDS, ...unheldProgression];
  const resolved = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const t of sweepIds) {
      if (resolved.has(t)) continue;
      const got = await p.forceTakeHere(t);
      if (got) {
        resolved.add(t);
        progressed = true;
        if (ALL_TREASURE_IDS.includes(t)) {
          await depositAll(p, { exclude: new Set(['EGG']) });
          await p.goto('TREASURE-ROOM'); // depositAll() navigates to Living Room — come back for the rest of the sweep
        }
      }
    }
  }

  // Whatever the thief's death opened the egg to reveal (see file header:
  // required for 2 of 3 golden seeds) — itemAt looks up the CANARY slot's
  // real occupant, which is what physically sits inside the (now-open) egg.
  const eggContents = p.itemAt('CANARY');
  if (eggContents !== undefined && NOUN[eggContents] !== undefined) {
    await p.cmd('open egg');
    await p.cmd(`take ${NOUN[eggContents]}`);
  }
  await p.cmd('take egg');
  await depositAll(p);
  return weaponNoun; // possibly substituted mid-fight — see findSubstituteWeapon's call site
}

interface PlaySeedResult {
  game: Game;
  /** The engine's own endgame-completion signal — see the return site below.
   *  Full completion is a bonus this generator still chases on every seed;
   *  the committed proof bar is the milestone computed by computeMilestone()
   *  below (AMENDMENT 11 point 2), not this flag. */
  won: boolean;
  /** Every death this run hit (AMENDMENT 10 tolerates them); empty on a
   *  clean run. Surfaced so the survey/pin process can tell a "won despite
   *  a death" seed apart from a "won cleanly" one. */
  deaths: string[];
  /** This seed's actual fill placements, handed back so the caller can
   *  compute the milestone (which location a banked treasure shuffled OUT
   *  of) without re-running fillWithRetry a second time. */
  placements: Record<string, string>;
}

/** AMENDMENT 11 point 2 — the committed e2e proof bar is a MILESTONE, not
 *  full completion: bank at least MILESTONE_TREASURE_COUNT shuffled
 *  treasures in the trophy case, at least one of them drawn from BEHIND a
 *  deep-mechanism seam. "Behind a deep-mechanism seam" is read off the
 *  treasure's SHUFFLED location's region (logic-graph.json), not its
 *  vanilla slot — region membership already encodes exactly this: river,
 *  dam, temple (the Hades/exorcism area), and the coal-mine complex
 *  (mine + mine-maze, both gated behind the mirror room and, for mine-maze,
 *  GARLIC+LAMP) sit behind a real puzzle chain from the surface; cyclops
 *  sits behind the thief-maze. Excludes DIAMOND/BAUBLE (event-created, never
 *  location-pool members — see Task 1 Step 5) and the six pinned vessels
 *  (COFFIN/EGG among the isTreasure set — Amendment 3 — never fill-placed,
 *  so they never appear as a value in `placements` either): none of those
 *  are "shuffled" in any meaningful sense, so a run that only ever banks
 *  them should not count toward the bar. */
const DEEP_MECHANISM_REGIONS: ReadonlySet<string> = new Set([
  'river', 'dam', 'temple', 'mine', 'mine-maze', 'cyclops',
]);
const MILESTONE_TREASURE_COUNT = 5;

interface MilestoneStatus {
  /** Shuffled-treasure ids currently sitting in TROPHY-CASE, sorted for
   *  stable cross-run comparison. */
  readonly bankedTreasureIds: readonly string[];
  /** The subset of DEEP_MECHANISM_REGIONS whose shuffled locations
   *  contributed a banked treasure — empty means the milestone's
   *  deep-seam clause isn't met yet, whatever bankedTreasureIds.length is. */
  readonly deepSeamRegions: readonly string[];
  readonly met: boolean;
}

function computeMilestone(game: Game, placements: Readonly<Record<string, string>>): MilestoneStatus {
  const locationIdByItemId = new Map(Object.entries(placements).map(([loc, item]) => [item, loc]));
  const caseObj = game.world.get('TROPHY-CASE');
  const bankedTreasureIds = (caseObj === undefined ? [] : Array.from(caseObj.children).map(o => o.id))
    .filter(id => ALL_TREASURE_IDS.includes(id) && locationIdByItemId.has(id))
    .sort();
  const deepSeamRegions = [...new Set(
    bankedTreasureIds
      .map(id => locByIdGlobal.get(locationIdByItemId.get(id)!)?.region)
      .filter((region): region is string => region !== undefined && DEEP_MECHANISM_REGIONS.has(region)),
  )].sort();
  return {
    bankedTreasureIds,
    deepSeamRegions,
    met: bankedTreasureIds.length >= MILESTONE_TREASURE_COUNT && deepSeamRegions.length > 0,
  };
}

async function playSeed(seed: number): Promise<PlaySeedResult> {
  resetModuleGlobals();
  const fillResult = fillWithRetry(graph, seed);
  const placementMap = toEnginePlacementMap(graph, fillResult.placements);
  const game = createGame({ seed: 42, placementMap });
  game.start();
  const p = new Playthrough(game, fillResult.placements);

  const surfaceOwned = computeSurfaceOwned(fillResult.placements);
  const weapon = findPreTrollWeapon(fillResult.placements, surfaceOwned);
  let weaponNoun = NOUN[weapon];
  p.weaponNoun = weaponNoun;
  p.weaponItemId = weapon;
  const weaponIsSurface = surfaceOwned.has(weapon);
  // Does the weapon's OWN current location need LAMP (e.g. seed 2's SCEPTRE,
  // shuffled onto ROPE's slot — ATTIC, dark, `needs: ["LAMP"]`)? "Surface"
  // only means "no OTHER item needed" (evalSurfaceOnly's fixpoint doesn't
  // model darkness at all — same unmodeled-physical-constraint class as the
  // troll's weapon requirement) — a dark surface room still needs a lit
  // lamp in hand before TAKE will work there.
  const weaponLocId = Object.entries(fillResult.placements).find(([, item]) => item === weapon)?.[0];
  const weaponNeedsLamp = weaponIsSurface && (locByIdGlobal.get(weaponLocId ?? '')?.access.needs?.includes('LAMP') ?? false);
  // LAMP is progression, but the graph's region rules don't model light
  // any more than they model the troll's weapon requirement (same class of
  // gap) — fill() can place LAMP itself behind a dark room. If so, a lit
  // MATCH (2-turn burn, src/actions/light-sources.ts) bootstraps the dash;
  // MATCH must itself be surface-reachable or this is a genuine reportable
  // upstream gap (confirmed present for all 3 pinned golden seeds' LAMP
  // placements while building this test — only seed 3 needs the dash).
  const lampNeedsMatchBootstrap = !surfaceOwned.has('LAMP');
  if (lampNeedsMatchBootstrap && weaponNeedsLamp) {
    throw new Error(
      'weapon needs LAMP lit to fetch, but LAMP itself needs the underground match-dash first (which ends up ' +
      'underground, unable to return to a surface-dark weapon room without the trap door re-open cycle) — ' +
      'unhandled combination on this generator, not encountered by any of the 3 pinned golden seeds; reportable if hit.',
    );
  }

  // ---- Setup: into the house; grab whichever of weapon/match/lamp is
  // surface-reachable now; open the trap door; then (with light available)
  // fetch anything that needed the underground "pre-combat pocket" —
  // Cellar/Troll Room/East of Chasm/Gallery/Studio, freely walkable without
  // ever facing the troll — before finally engaging him. ------------------
  await p.goto('EAST-OF-HOUSE');
  await p.cmd('open window');
  p.flags.add('KITCHEN-WINDOW');
  // Surface weapon that needs no light: grab it now, before ever touching
  // the trap door (safe regardless of what LAMP's own bootstrap needs).
  if (weaponIsSurface && !weaponNeedsLamp) await p.takeItem(weapon);
  if (lampNeedsMatchBootstrap) {
    if (!surfaceOwned.has('MATCH')) {
      throw new Error(
        'LAMP is placed behind a dark room and MATCH (the only pre-troll bootstrap light) is not ' +
        'surface-reachable either — reportable upstream logic-graph gap (light is unmodeled in region access), not a script bug.',
      );
    }
    await p.takeItem('MATCH');
    await p.goto('LIVING-ROOM');
    await p.cmd('move rug');
    await p.cmd('open trap door');
    p.flags.add('TRAP-DOOR');
    // The dash itself performs the first descent (goto's BFS routes through
    // the trap door since TRAP-DOOR is already flagged open above) — do NOT
    // also issue a bare "down" afterward, we're at the lamp's room, not Cellar.
    const lampLocId = p.locationIdByItemId.get('LAMP')!;
    const lampRoom = p.roomOfContainer(locByIdGlobal.get(lampLocId)!.containerId);
    await p.gotoWithMatch(lampRoom); // dash through the dark rooms, relighting each step
    await p.cmd(`take ${NOUN.LAMP}`);
    await p.cmd('turn on lamp');
    // weaponNeedsLamp is impossible here (checked above); if weapon is
    // surface it was already fetched pre-trapdoor. Only the pocket case
    // remains, handled generically below.
  } else {
    await p.takeItem('LAMP');
    await p.cmd('turn on lamp');
    // Surface-dark weapon (needs the now-lit lamp): safe now, still haven't
    // touched the trap door, so no risk of getting stuck underground.
    if (weaponIsSurface && weaponNeedsLamp) await p.takeItem(weapon);
    await p.goto('LIVING-ROOM');
    await p.cmd('move rug');
    await p.cmd('open trap door');
    p.flags.add('TRAP-DOOR');
    await p.cmd('down'); // first descent — trap door slams shut behind us (CELLAR-FCN M-ENTER); currentRoom synced by cmd()
  }

  // Weapon sat in the pre-combat pocket (e.g. seed 1's KNIFE, on the troll's
  // own table) — now that the lamp is lit and the trap door open, it's safe
  // to fetch (bfsPath's TRAP-DOOR flag is set, reaching Cellar/Troll Room/
  // etc freely; only Troll Room's OWN east/west exits are troll-gated).
  if (!weaponIsSurface) await p.takeItem(weapon);

  // Whatever else the shuffle placed at the AXE slot (location id "AXE",
  // containerId "TROLL") MUST be fetched before the troll fight, not after.
  // TROLL-FCN (troll-fcn.ts, a faithful port of 1actions.zil:640–764) only
  // ever rescues the literal AXE object on death (dropAxe()) — anything
  // ELSE parented there is a foreign bystander the engine doesn't know to
  // rescue, and combat.ts's troll-death sequence makes "the carcass"
  // disappear entirely, taking every other still-attached child with it —
  // permanently, with no further in-game command able to retrieve it
  // (confirmed live: seed 3's BOOK, placed at the AXE slot, vanished with
  // the troll's corpse and could never be fetched again). TROLL is flagged
  // Open, though, so its contents are freely visible/takeable BEFORE the
  // fight, exactly like AXE itself always is in vanilla — fetch it now,
  // while that's still true, rather than treating this as an upstream
  // unsolvable (a real command sequence — take it early — does exist).
  // EXCEPT a redundant weapon-class item (SWORD/KNIFE/RUSTY-KNIFE other
  // than the one actually chosen) — see REDUNDANT_WEAPON_CLASS's own doc
  // comment. Losing one of THOSE to the troll's corpse costs nothing (it
  // served no purpose we'd ever use anyway), so there's no need to rescue
  // it just because it happens to sit at the AXE slot — confirmed live,
  // seed 1: rescuing RUSTY-KNIFE (SIZE 20) here, then carrying it for the
  // entire rest of the game for zero benefit, was enough on its own (on
  // top of COAL/TORCH/GARLIC/MATCH/SCREWDRIVER already legitimately held)
  // to push the much-later COFFIN (SIZE 55) fetch over loadMax=100.
  const axeSlotItem = fillResult.placements['AXE'];
  if (
    axeSlotItem !== undefined && axeSlotItem !== weapon && NOUN[axeSlotItem] !== undefined &&
    !REDUNDANT_WEAPON_CLASS.has(axeSlotItem)
  ) {
    await p.goto('TROLL-ROOM');
    await p.takeItem(axeSlotItem);
  }

  // ---- Kill the troll: consecutive swings, NO diagnose/retreat
  // interleave. Two failed experiments inform this shape. (1) A
  // diagnose-gated retreat/heal loop (the thief hunt's proven pattern)
  // made things strictly WORSE here: every non-attack turn is a free
  // troll swing (I-FIGHT runs per turn regardless), so interleaving
  // 'diagnose' doubled the player's exposure — a survey re-run showed 18
  // candidate seeds newly dying mid-fight that had previously survived
  // back-to-back swinging — and the retreat's CELLAR cure-wait exposed
  // ~15 more to the wandering thief's own fatal encounters at near-zero
  // score. Back-to-back attacking is genuinely the least-exposure play at
  // this point in the game (nothing banked yet, MS floor-low, no safe
  // room reachable — the trap door is barred behind us). (2) The original
  // blind version recorded TROLL-FLAG unconditionally after exactly 10
  // swings; rooms.json gates TROLL-ROOM's east/west exits on that flag,
  // so an unlucky slow fight desynced every later route through this
  // chokepoint. Keep the swinging, CONFIRM the kill (combat.ts's FATAL
  // row variants + the troll-specific "sinister black fog" corpse
  // cleanup; "can't see any troll" = already dead, equally done), and
  // fail loudly on budget exhaustion or a genuine combat death — that
  // residual death risk (worst with SCEPTRE, the weakest weapon in
  // combat.ts's tables) is part of what the empirical golden-seed
  // selection (AMENDMENT 8) filters on.
  await p.goto('TROLL-ROOM');
  let trollDone = false;
  for (let i = 0; i < 15 && !trollDone && !p.gameOver(); i++) {
    const out = await p.cmd(`kill troll with ${weaponNoun}`);
    if (/removes his head|he dies\.|slumps to the floor dead|sinister black fog|can't see any troll/i.test(out)) {
      trollDone = true;
    }
  }
  if (p.gameOver()) {
    throw new Error('player died fighting the troll — a death applies a -10 score penalty, making exact-350 unreachable');
  }
  if (!trollDone) {
    throw new Error('troll fight exhausted its attempt budget without a confirmed kill');
  }
  p.flags.add('TROLL-FLAG');

  // ---- Cyclops interlude: opens BOTH the (thief-guarded) Treasure Room
  // (CYCLOPS-FLAG) and a permanent Living-Room shortcut via Strange Passage
  // (MAGIC-FLAG). Deliberately does NOT go up into the Treasure Room yet —
  // confirmed live: entering it while the thief is still alive triggers his
  // defense (TREASURE-ROOM's contents "vanish" — relocated elsewhere by his
  // own logic — plus a stiletto counter-attack), so any treasure genuinely
  // placed there isn't safely collectible until he's dealt with. The actual
  // Treasure Room visit (needed regardless for its +25 first-visit score)
  // happens in the thief-hunt phase near the end, after he's dead. --------
  await p.goto('CYCLOPS-ROOM');
  await p.cmd('odysseus');
  p.flags.add('CYCLOPS-FLAG');
  p.flags.add('MAGIC-FLAG');
  await p.goto('LIVING-ROOM');
  await depositAll(p);

  // Re-open the trap door from the Living-Room side: CELLAR-FCN's M-ENTER
  // slam only ever fires once (guarded by TRAP-DOOR's own Touched flag,
  // already set by the first descent above) — from here on it behaves like
  // a normal door in both directions, so Cellar <-> Living Room is free.
  await p.cmd('open trap door');
  await p.cmd('down'); // currentRoom synced by cmd()

  // Tolerant fetch wrapper — swallows any takeItem()/goto() failure so one
  // seed-specific unreachability doesn't block whatever else this generator
  // still has to attempt; anything skipped here is safely re-attempted
  // (idempotent via takenItems) by later passes (the score-boost pass
  // below, the main forward-order loop, its own river journey, and the
  // final safety-net sweep before the last deposit). Declared here (rather
  // than down at the score-boost pass, where it originally lived) because
  // the rainbow/pot-of-gold detour immediately below needs it first.
  const tryEarly = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch {
      // left for whichever later pass covers this case
    }
  };

  // ---- Rainbow/pot-of-gold detour — fetch SCEPTRE (wherever it really
  // landed) and wave it here, right after the troll and Cyclops are both
  // dealt with, REGARDLESS of whether it happens to be our weapon. An
  // earlier version of this generator only did this when `weapon ===
  // 'SCEPTRE'` (RBOAT-FUNCTION punctures the boat on BOARD if carrying ANY
  // of SCEPTRE/KNIFE/SWORD/RUSTY-KNIFE/AXE/STILETTO — src/actions/boat.ts's
  // SHARP_OBJECT_IDS check — so a sceptre-as-weapon would otherwise have to
  // be dropped for the river crossing before ever getting waved), leaving
  // every OTHER seed's SCEPTRE to sit wherever full-item-shuffle put it,
  // untouched, for the entire tryEarly score-boost pass AND most of the
  // forwardOrder loop — confirmed live, seed 1: SCEPTRE (TVALUE>0,
  // isTreasure) sat exposed for 100+ turns, long enough for thief.ts's
  // unconditional ROOM-treasure robbery (`ctx.rob(here,'THIEF',100)`,
  // fires whenever he visits ANY room with a treasure sitting in it) to
  // steal it and carry it home to Treasure Room — the forwardOrder loop's
  // later, plain `takeItem('SCEPTRE')` has no way to reach it there (the
  // thief hunt is deliberately deferred to the very end for survivability —
  // see doThiefHunt's own doc comment — so treating this as "recoverable
  // later" doesn't work for a PROGRESSION item needed now) and threw "You
  // can't see any sceptre here!". Fetching it now, before that long
  // exposure window even opens, closes the gap the same way the
  // weapon-is-sceptre case always did for its own (different) reason. Can't
  // be done any earlier than this: reaching the Canyon route needs Living
  // Room -> Kitchen -> outside, which isn't open again until the trap door
  // reopens just above.
  //
  // GARLIC is attempted around the SCEPTRE fetch (order: GARLIC, SCEPTRE,
  // GARLIC again), not hardcoded before or after it, because the two can
  // depend on EACH OTHER depending on where the shuffle put them: seed 3's
  // SCEPTRE sits in the bat-guarded Bat Room (`needs: ["GARLIC","LAMP"]`),
  // while seed 2's GARLIC sits in the river area, whose access rule accepts
  // SCEPTRE as one of its two alternative unlocks (`any:
  // [{needs:[INFLATABLE-BOAT,PUMP]},{needs:[SCEPTRE]}]`) — neither a fixed
  // "GARLIC-first" nor "SCEPTRE-first" order alone satisfies both. Three
  // tolerant, idempotent attempts (a minimal fixpoint, not the full
  // computeForwardOrder machinery) resolve every pinned golden seed's
  // actual dependency direction without hardcoding either one. Harmless
  // no-ops wherever neither depends on the other (e.g. seed 1).
  await tryEarly(() => p.takeItem('GARLIC'));
  await tryEarly(() => p.takeItem('SCEPTRE'));
  await tryEarly(() => p.takeItem('GARLIC'));
  // Only wave once SCEPTRE is actually confirmed in hand (it may
  // legitimately still be unreachable this early on some seed this
  // generator doesn't pin — left for doRiverJourney's own guarded wave, or
  // the forwardOrder loop's plain fetch, exactly as before this fix) — and
  // only once, ever (RAINBOW-FLAG guards every wave call site the same way).
  if (p.takenItems.has('SCEPTRE') && !p.flags.has('RAINBOW-FLAG')) {
    await ensureRainbow(p); // wave + verify (see its doc comment); leaves us at END-OF-RAINBOW
    await p.grabAllAt('END-OF-RAINBOW');
    // No retryVesselInteriors call here (unlike doRiverJourney's own wave,
    // below): this branch runs before ANY of the 3 vessels have had even
    // their first fetch attempt yet (the score-boost pass's own tryEarly
    // calls are still ahead), so a retry here isn't recovering a failed
    // attempt — it's an unconditional extra detour (goto + open + take,
    // for up to 3 vessels) this early in the game, for every seed, whether
    // or not anything's actually stuck. This generator's own established,
    // severe RNG-sensitivity (a single added command shifts thief-encounter
    // timing for every seed at once — confirmed live, this exact addition
    // measurably destabilized a previously-passing seed) means an
    // unconditional detour like that isn't free just because it's tolerant
    // of failure. None of the 3 pinned golden seeds need it here: a
    // vessel-trapped Invisible item revealed by THIS wave would need to be
    // reachable from a vessel whose interior slot resolves through the
    // Canyon route, and no pinned seed hits that combination — the one
    // case that does exist (seed 1) goes through doRiverJourney's wave
    // instead, which keeps the retry (below).
    await p.goto('CELLAR');
  }

  // ---- Score-boost pass, then the thief hunt EARLY after all — see
  // doThiefHunt's doc comment for the score/survivability formula
  // (verbDiagnose: MS = 2 + floor(score/70)). Fighting him with near-zero
  // score got the player killed outright even at "perfect health" (twice,
  // confirmed live) — MS never rises just by waiting. But deferring him to
  // the very end of the game (this test's ORIGINAL shape) exposed BELL/
  // BOOK/ROPE/the weapon itself to the wandering thief's stealJunk/
  // stealTreasure (confirmed live, several times, on different seeds) —
  // stealJunk operates on a ROOM's children, so it can steal an item before
  // we've even reached it, not just from our inventory. Neither extreme
  // works; the fix is a THIRD phase: collect the handful of treasures that
  // don't depend on ROPE/temple access at all (GARLIC/WRENCH lead to two of
  // them), bank ~160 points (comfortably MS=4, "survive several wounds" at
  // full health) via their VALUE + deposited TVALUE + the Kitchen/Cellar/
  // EW-Passage first-visit bonuses, THEN fight him — well before ROPE/BELL/
  // BOOK/CANDLES/MATCH/PUMP/INFLATABLE-BOAT (the theft-vulnerable items)
  // are ever fetched.
  // Not every one of these is guaranteed reachable THIS early on every
  // seed (e.g. WRENCH's real placement might itself need ROPE/temple, or a
  // treasure might have landed in the river area, needing the not-yet-
  // fetched boat/pump) — each attempt is independently swallowed so one
  // seed-specific unreachability doesn't block the rest of the score-boost
  // pass; anything skipped here is safely re-attempted (idempotent via
  // takenItems) by the main forward-order loop and its own river journey,
  // and by the final safety-net sweep before the last deposit.
  // TORCH is a PERMANENT, unextinguishable light source (objects.json:
  // Flag.OnFire baked in, torchObject's V-LAMP-OFF handler refuses to put
  // it out — "You nearly burn your hand...") — fetched as early as
  // possible (when it happens to be reachable this early, e.g. seed 1's
  // TORCH landing inside the pinned BOTTLE, fully surface-reachable) so
  // goto()'s lamp-conservation logic (see its own comment) can treat
  // "holding the torch" as a full substitute for the finite, burns-out
  // (385 turns total, LAMP_TABLE) lamp for the REST of the game. Confirmed
  // live: even with lamp-off-in-lit-rooms conservation, the sheer length
  // of a full 19-treasure collection run still burned through the entire
  // budget before EGG (fetched right before the deferred thief hunt),
  // permanently darkening a genuinely dark room ("It's too dark to see!").
  // Safe no-op via tryEarly if TORCH isn't reachable yet this early (the
  // coal-machine section's own `takeItem('TORCH')` picks it up later,
  // idempotently, exactly as before).
  await tryEarly(() => p.takeItem('TORCH'));
  if (p.hasTorch && p.lampOn) await p.cmd('turn off lamp'); // torch suffices now — see goto()
  // BOTTLE/SANDWICH-BAG/TUBE (3 of the 6 Amendment-3 pinned vessels) are
  // ordinary TVALUE==0 objects sitting in a room — exactly what
  // thief.ts's stealJunk (a faithful, unconditional vanilla mechanic —
  // "operates on a ROOM's children, so it can steal an item before we've
  // even reached it") can pick up and dropJunk relocate ANYWHERE else in
  // the map while the thief is alive (essentially the whole game, now
  // that his hunt is deferred to the very end). Amendment 3 pinned these
  // vessels assuming they "keep their vanilla positions," but that only
  // covers the RANDOMIZER'S placement seam — it says nothing about the
  // thief's own ordinary wandering, which can and does move them.
  // Confirmed live: seed 1's TUBE (holding POT-OF-GOLD this seed)
  // vanished from Maintenance Room and reappeared at Mine Entrance,
  // stranding the interior item with no static room this generator could
  // still find it in. There's no reliable command-sequence workaround
  // for a vessel already relocated by the time we get there — the only
  // real mitigation is minimizing the exposure window, fetching each
  // vessel's contents as early as possible, before the thief has had many
  // turns' opportunity to steal it.
  //
  // A SEPARATE, deterministic (not just theft-risk) gap sits right next to
  // this one, also confirmed live on seed 1: POT-OF-GOLD's own object data
  // (objects.json) bakes in Flag.Invisible — its vanilla "hidden until the
  // sceptre is waved" mechanic — and that flag travels with the object
  // wherever full-item-shuffle placed it, same as SCARAB's own baked-in
  // Invisible (handled by the dedicated dig ritual elsewhere). Whenever
  // POT-OF-GOLD lands inside one of these three vessels, THIS early attempt
  // is guaranteed to fail every time, seed-independent — the sceptre hasn't
  // been waved yet at this point in the script, so the item is genuinely
  // invisible no matter how quickly we get here. tryEarly's silent swallow
  // correctly defers it, but deferring all the way to the endgame
  // safety-net sweep reopens the very theft-exposure window this early pass
  // exists to close (confirmed live: TUBE was already stolen away by then).
  // fetchVesselInterior lives on Playthrough itself (see its own doc
  // comment) specifically so it can also be retried immediately after each
  // `wave sceptre` call site (doRiverJourney and the canyon detour below)
  // — the earliest point the reveal could possibly have fired — bounding
  // the exposure to "one reveal-to-vessel round trip" instead of the rest
  // of the game.
  await tryEarly(() => p.fetchVesselInterior('BOTTLE'));
  await tryEarly(() => p.fetchVesselInterior('SANDWICH-BAG'));
  await tryEarly(() => p.fetchVesselInterior('TUBE'));
  // GARLIC itself was already attempted (up to twice) by the rainbow
  // detour above, alongside SCEPTRE — this is a harmless idempotent retry
  // (takenItems no-ops it if already held) for the rare case neither
  // attempt there succeeded yet (e.g. it depends on something only
  // BOTTLE/SANDWICH-BAG/TUBE's interior, just fetched above, unlocks).
  await tryEarly(() => p.takeItem('GARLIC'));
  // COAL is ordinary TVALUE==0 filler, so it's just as exposed to
  // thief.ts's stealJunk (which operates on a ROOM's children, plucking an
  // item out before this generator ever gets there) as the pinned vessels
  // above — confirmed live (seed 1's COAL vanished from DAM-LOBBY before
  // the coal-machine section, at the very end of the script, ever reached
  // it). stealJunk only ever targets a ROOM's children, never the player's
  // own inventory (thief.ts's rob(), the only player-inventory theft path,
  // gates on TVALUE>0 — COAL/SCREWDRIVER never qualify) — so once genuinely
  // held, COAL is permanently safe from him regardless of how long it's
  // carried afterward. Fetch it now, while conveniently right next door
  // (DAM-LOBBY, one room from this detour's own MAINTENANCE-ROOM/DAM-ROOM
  // stops), rather than leaving it exposed in the open for the entire rest
  // of the game until the coal-machine section's own re-fetch.
  //
  // SCREWDRIVER is deliberately NOT pre-fetched here even though it's the
  // same TVALUE==0 class: on 2 of 3 golden seeds it lands in the
  // thief-guarded TREASURE-ROOM (confirmed live), whose takeItem() guard
  // silently defers any fetch attempt until the thief is dead — an earlier
  // draft that pre-fetched the whole coal-machine sequence (including
  // SCREWDRIVER) this early broke exactly those two seeds. COAL's own
  // current placement is never in TREASURE-ROOM on any of the 3 pinned
  // seeds, so pre-fetching just COAL carries no such risk.
  await tryEarly(() => p.takeItem('COAL'));
  await tryEarly(async () => {
    await p.takeItem('WRENCH');
    await p.goto('MAINTENANCE-ROOM');
    await p.cmd('push yellow button');
    await p.goto('DAM-ROOM');
    await p.cmd('turn bolt with wrench');
    for (let i = 0; i < 8; i++) await p.cmd('wait');
    p.flags.add('LOW-TIDE');
    await p.cmd('drop wrench'); // done its one-time job — SIZE 10
  });
  for (const t of ['PAINTING', 'BAR', 'BAG-OF-COINS', 'JADE', 'BRACELET', 'TRUNK', 'TRIDENT']) {
    await tryEarly(() => p.takeTreasure(t));
  }
  // JADE/BRACELET live in the mine region, on the far side of Gas Room from
  // everywhere else — reclaim TORCH here, right after this excursion,
  // rather than leaving it dropped for a long, later, lamp-only stretch
  // (see goto()'s own comment on why an immediate in-call reclaim isn't
  // always possible: the return trip through this specific chokepoint
  // re-crosses Gas Room too). The sooner after the mine visit this runs,
  // the shorter the lamp-reliant gap it closes.
  await reclaimTorchIfDropped(p);
  await reclaimCoalIfDropped(p);
  await reclaimWeaponIfDropped(p);
  weaponNoun = p.weaponNoun ?? weaponNoun; // pick up any substitution — see doThiefHunt's own resync comment
  // COFFIN is deliberately NOT fetched here (unlike the other tryEarly
  // treasures above) — its own interior (Amendment 3's pinned-vessel
  // check, e.g. this seed's EMERALD) must be extracted BEFORE the coffin
  // is ever taken and moved away from Egyptian Room, and this early pass
  // has no way to know yet whether that interior item is even reachable.
  // Handled together, correctly ordered, right before the coffin fetch
  // near the end of the safety-net sweep (see that comment for the
  // confirmed-live failure this ordering fixes).
  await depositAll(p);

  // EGG is deliberately NOT fetched here (despite being safe, no-combat) —
  // WEIGHT (gverbs.zil:1988) is recursive, and on 2 of 3 pinned golden
  // seeds a required treasure is trapped inside it (e.g. seed 3's TRIDENT,
  // SIZE 20). Carrying the closed, loaded egg through the ENTIRE rest of
  // the game (the whole forward-order loop + river journey below) risks
  // loadMax=100 overload purely from that hidden extra weight — confirmed
  // live twice: once when EGG was fetched here (as an earlier version of
  // this generator did) and carried all the way to the now-deferred thief
  // hunt ("take bell" failed "too heavy" merely from egg-plus-trident
  // already near the ceiling); the fetch is deferred to right before
  // doThiefHunt instead (see below), right where it can be opened again
  // (via the thief's death) almost immediately, keeping the heavy window
  // as short as the design doc originally intended.

  // ---- Progression items, in a true forward-realizable order, fetched by
  // their REAL current placement (see file header). Structured as a
  // REUSABLE pass rather than a one-shot loop: takeItem() silently defers
  // anything whose placement resolves to the thief-guarded TREASURE-ROOM
  // (see its own guard), so the pass runs once here and once again after
  // doThiefHunt (when those deferrals finally proceed). Every one-time
  // ritual (rope tie, dam drain, Hades exorcism) is gated on ACTUAL
  // possession — p.takenItems, which only records confirmed takes — not on
  // loop progress: an earlier version tracked "the loop got past item X"
  // in a local set and fired the Hades ritual with CANDLES still sitting,
  // deferred, in TREASURE-ROOM ("You can't see any candles here!" —
  // confirmed by survey on 5 candidate seeds).
  const forwardOrder = computeForwardOrder(fillResult.placements);
  // A progression item can be STOLEN off the ground before this generator
  // ever reaches it — thief.ts's stealJunk works on a ROOM's children, so
  // "You can't see any bell here!" at the item's recorded placement is an
  // expected (not exceptional) pre-hunt outcome (confirmed by survey:
  // BELL/BOOK/CANARY/INFLATABLE-BOAT each hit this on different candidate
  // seeds). AMENDMENT 4's seeded-mode depositBooty returns EVERYTHING the
  // thief holds when he dies, and doThiefHunt's post-kill sweep force-takes
  // unheld progression items right there — so a pre-hunt miss of exactly
  // this shape is DEFERRED, not fatal. Post-hunt (thiefDead), the same miss
  // is final and propagates as the real failure it then is.
  // Emergency thief hunt — the ONE theft the deliberately-late hunt
  // schedule cannot absorb is TORCH: it is this generator's permanent
  // light source, the lamp's fixed 385-turn budget cannot cover the
  // remaining midgame without it, and depositBooty only returns it when
  // the thief DIES. Survey evidence (logicVersion 10, seeds 4-60): with
  // the hunt held to its usual late slot, a mid-game torch robbery led to
  // lamp burnout -> match exhaustion -> grue death on a large majority of
  // candidate seeds — certain death, just slow. Hunting the thief EARLY
  // is known-risky (measured live, an earlier generator shape: at 64-94
  // banked points, MS = 2 + floor(score/70) left the fight outright
  // deadly on 2 of 3 seeds) — but a PROBABLE combat death beats a CERTAIN
  // fuel death, so the hunt is pulled forward exactly when the torch has
  // genuinely been robbed (fetched once, not in hand, and not merely
  // set down by our own gas-hazard/overload handling). EGG is fetched
  // first when possible (the thief must be holding it when he dies for
  // depositBooty's EGG-SOLVE opening — doThiefHunt's own probe loop hands
  // it over), and everything bankable is deposited to raise MS before
  // engaging.
  const torchRobbed = (): boolean =>
    p.takenItems.has('TORCH') && !p.hasTorch &&
    p.torchDroppedAt === undefined && !p.parkedAt.has('TORCH');
  const maybeEmergencyThiefHunt = async (): Promise<void> => {
    if (p.thiefDead || !torchRobbed()) return;
    await tryEarly(() => p.takeItem('EGG'));
    await depositAll(p, { exclude: new Set(['EGG']) });
    weaponNoun = await doThiefHunt(p, weaponNoun);
  };

  const takeProgressionDeferringTheft = async (item: string): Promise<void> => {
    try {
      await p.takeItem(item);
    } catch (err) {
      // A DEATH is never deferrable (the -10 penalty makes exact-350
      // permanently unreachable) and always propagates. Every other
      // pre-hunt failure shape defers: "can't see any X" (stolen — comes
      // back via depositBooty), "no route to <room>" (the destination sits
      // behind a ritual whose own item is thief-deferred, e.g. the SKULL
      // slot behind an exorcism missing its TREASURE-ROOM candle —
      // confirmed by survey), and "MATCH-COUNT exhausted" (light restored
      // once the thief returns TORCH). Post-hunt, the same failure is
      // final and propagates as the real error it then is.
      if (!(err instanceof Error) || /player died|died mid-path/i.test(err.message)) throw err;
      if (p.thiefDead) throw err;
      // left for doThiefHunt's post-kill sweep + the post-hunt progressionPass
    }
  };
  const progressionPass = async (): Promise<void> => {
    for (const item of forwardOrder) {
      if (item === 'LAMP') continue; // already have it
      // SWORD/KNIFE/RUSTY-KNIFE are progression ONLY because Amendment 5's
      // rule-cited invariant auto-promotes every Weapon-flagged item the
      // troll-passage `any` clause names — the graph's own fixpoint (which
      // computeForwardOrder replays from an empty inventory, independent of
      // what this generator already physically did) is satisfied by owning
      // ANY ONE of the three, and `weapon` (already fought the troll with,
      // held since before this loop started) already is one of them. The
      // OTHER two serve no further purpose once that gate is open: TVALUE 0
      // (never scored), no dependent location/rule cites them individually,
      // and this generator never uses more than one weapon at a time —
      // fetching a redundant second/third copy is pure, unrecoverable
      // weight for zero benefit. Confirmed live, seed 1: fetching SWORD
      // (SIZE 30) here, on top of everything else already legitimately
      // held, blew loadMax=100 with nothing worth shedding to fit it.
      if (REDUNDANT_WEAPON_CLASS.has(item) && item !== weapon) continue;
      if (!p.takenItems.has(item)) {
        const room = p.roomOfItem(item);
        if (room !== undefined && RIVER_AREA_ROOMS.has(room)) {
          if (p.takenItems.has('INFLATABLE-BOAT') && p.takenItems.has('PUMP')) {
            // The river proper (RIVER-1..5) is reached by a scripted boat
            // drift, not free BFS — do the whole journey now (it
            // opportunistically grabs `item` along with everything else
            // there).
            await doRiverJourney(p);
          } else {
            // Boat/pump not (yet) in hand — per the logic graph this can
            // only be a SHORE-side placement (SHORE/SANDY-BEACH/SANDY-CAVE/
            // ARAGAIN-FALLS), whose access rule's `any` alternative accepts
            // SCEPTRE: the rainbow crossing reaches it entirely on foot
            // (rooms.json's ON-RAINBOW exits, gated on RAINBOW-FLAG, are
            // ordinary BFS edges once the wave has happened). Mid-river
            // BUOY placements strictly need boat+pump in the graph, so
            // forward order always puts them after both — this branch never
            // sees one. Confirmed by survey: 6 candidate seeds had exactly
            // this shape (a shore item ordered before PUMP/BOAT ownership)
            // and the old unconditional boat attempt stranded them at
            // DAM-BASE with "You can't see any pump here!".
            await ensureRainbow(p);
            await takeProgressionDeferringTheft(item);
          }
        } else {
          await takeProgressionDeferringTheft(item);
        }
      }
      // One-time rituals — each is flag-guarded, possession-gated, and
      // callable again on the post-thief-hunt pass (see their own doc
      // comments). The Hades ritual is tolerant here (a pre-hunt failure —
      // e.g. an item stolen en route — is retried post-hunt, where it
      // escalates to a hard failure).
      await doRopeTie(p);
      await doDamDrain(p);
      await doHadesRitual(p);
      // Fuel triage checkpoint — see maybeEmergencyThiefHunt's own doc
      // comment. Checked per item so a mid-pass torch robbery is answered
      // within a handful of turns, before the remaining (mostly dark)
      // pass drains the lamp.
      await maybeEmergencyThiefHunt();
    }
  };
  await progressionPass();

  // ---- River journey done here (before the coal machine's EMPTY-HANDED
  // gate — see below) if the progression loop above didn't already need it.
  await doRiverJourney(p);
  await maybeEmergencyThiefHunt(); // fuel triage — see its doc comment

  // ---- Canary / bauble --------------------------------------------------
  // CANARY is an ordinary shuffle-eligible treasure — full-item-shuffle can
  // place it at a location gated behind a prerequisite this early section
  // hasn't necessarily cleared yet (e.g. the SKULL slot at LAND-OF-LIVING-
  // DEAD, gated on the Hades exorcism — confirmed by survey: 3 candidate
  // seeds threw "no route ... to LAND-OF-LIVING-DEAD" here, LLD-FLAG not
  // yet set). Every OTHER treasure fetch in this file already tolerates
  // exactly this shape (tryEarly-wrapped, retried by the safety-net sweep
  // below and the explicit post-thief-hunt LLD-FLAG hard-check) — this one
  // wasn't, and threw before ever reaching that machinery. Tolerate it the
  // same way; the sweep's `for (const t of ALL_TREASURE_IDS)` loop already
  // retries CANARY itself, so only the wind/bauble follow-up (not covered
  // by that generic retry) needs its own explicit second attempt, added
  // right after the post-thief-hunt LLD-FLAG hard-check below.
  const windCanary = async (): Promise<void> => {
    if (!p.takenItems.has('CANARY')) return; // nothing to wind yet — see the retry call site
    await p.goto('PATH');
    await p.cmd('wind canary'); // drops BAUBLE at PATH (isForestRoom) — above-ground.ts:918-935
    await p.cmd('take bauble');
  };
  await tryEarly(() => p.takeTreasure('CANARY'));
  await windCanary();

  // COFFIN alone is SIZE 55 (objects.json) — over half of loadMax=100 —
  // fetched and deposited in complete isolation, before anything else in
  // this sweep can pile up alongside it. Confirmed live: with COFFIN
  // fetched mid-sweep (after JADE/SCEPTRE/BAG-OF-COINS/TRIDENT had already
  // accumulated in hand), "take coffin" failed "Your load is too heavy" —
  // ordering it first sidesteps the whole class of "which other treasures
  // happened to come first in ALL_TREASURE_IDS" fragility rather than just
  // patching this one seed's specific order. Depositing FIRST too (not
  // just after) matters just as much — CANARY/BAUBLE are still in hand
  // from the step right above, and even that alone was enough to push
  // "take coffin" over loadMax (confirmed live).
  await depositAll(p);
  // Whatever the shuffle placed inside the coffin (location id "SCEPTRE",
  // containerId "COFFIN" — Amendment 3's pinned-vessel interior check) MUST
  // come out before the coffin itself is ever taken and deposited: the
  // interior's static access rule (and this generator's own
  // roomOfContainer/STATIC_ROOM_OF resolution) both assume the coffin is
  // still sitting at its vanilla room — true only until WE physically pick
  // it up and carry it away. Confirmed live: fetching COFFIN first left the
  // real EMERALD (this seed's coffin-interior item) with "You can't see any
  // emerald here!" — the coffin, and everything inside it, was already
  // gone from Egyptian Room by the time the generic take was attempted.
  const coffinContentsLoc = graph.locations.find(l => l.containerId === 'COFFIN');
  const coffinContentsItem = coffinContentsLoc !== undefined ? fillResult.placements[coffinContentsLoc.id] : undefined;
  // Tolerant, not hard-failing (and explicitly retried below, since COFFIN
  // is excluded from the generic ALL_TREASURE_IDS sweeps): EGYPT-ROOM's
  // ONLY entrance is DOME-ROOM's "down" exit, gated on DOME-FLAG (the rope
  // tied to the dome — rooms.json; SOUTH-TEMPLE's own "down" into the
  // temple cluster runs the other direction and has no return edge). If
  // ROPE's own placement hasn't been forward-reachable yet by this point in
  // the script (deferred by theft, per takeProgressionDeferringTheft's own
  // pattern), this whole isolated fetch throws "no route ... to EGYPT-ROOM"
  // — confirmed by survey, several candidate seeds. Deferred here rather
  // than treated as fatal; retried once more after the post-thief-hunt
  // progressionPass() re-run (below), by which point ROPE/DOME-FLAG should
  // be resolved.
  const fetchCoffin = async (): Promise<void> => {
    if (p.takenItems.has('COFFIN')) return;
    try {
      if (coffinContentsItem !== undefined && NOUN[coffinContentsItem] !== undefined) {
        await p.takeTreasure(coffinContentsItem);
        await depositAll(p);
      }
      await p.takeTreasure('COFFIN');
      await depositAll(p);
    } catch {
      // left for the retry call site below
    }
  };
  await fetchCoffin();
  // Reclaim SCREWDRIVER if COFFIN's own overload recovery had to shed it
  // (see takeItem()'s PINNED_TREASURE_VESSELS branch and
  // reclaimScrewdriverIfDropped's own doc comment) — COFFIN's own 55 SIZE
  // is gone now (just deposited), so there's real room again. Tolerant
  // here (like the COAL/weapon/TORCH reclaims right below it elsewhere) —
  // if light still isn't reliable yet, this defers to the next checkpoint
  // rather than gambling a multi-room trip on the match budget; it's still
  // needed for the coal machine later, but that's a genuine LATER hard
  // requirement, not this one.
  await reclaimScrewdriverIfDropped(p);
  await reclaimGarlicIfDropped(p);

  // EGG is fetched here — right after COFFIN, BEFORE the safety-net sweep
  // below — rather than immediately before the thief hunt as an earlier
  // version of this generator had it. WEIGHT (gverbs.zil:1988) is
  // recursive and 2 of 3 pinned golden seeds trap a required treasure
  // inside it (e.g. seed 3's TRIDENT, SIZE 20), which is exactly why it
  // was deferred this long in the first place — but deferring it THIS far
  // (past a 19-item sweep that can span a long, match-costly stretch once
  // TORCH is ever robbed and LAMP has already burned out) risks something
  // worse than overload: running out of MATCH-COUNT(6)'s tiny budget
  // before ever reaching EGG's own location at all, with no light left to
  // recover — confirmed live, seed 1 (a torch robbery landing during the
  // sweep's own repeated Living-Room round trips left only 2 matches for
  // EGG's 3+-room dark approach). Fetching it now, right after COFFIN
  // (itself already fetched in as much isolation as possible), keeps the
  // window between "TORCH has ever been at risk" and "EGG is safely in
  // hand" as short as this generator can make it. The takeItem()
  // overload-recovery (COAL/weapon/GARLIC/SCREWDRIVER shed, TORCH withheld
  // once LAMP is dead) applies here exactly as it does for COFFIN.
  //
  // Every depositAll() call between HERE and doThiefHunt must exclude EGG
  // (the loop right below does) — EGG must stay held, CLOSED, all the way
  // to the thief's death; depositing it into the case at this point would
  // permanently seal its trapped treasure away unopened (this generator's
  // own established EGG-SOLVE mechanic — see the file header and
  // doThiefHunt's own doc comment — requires either giving it to him or
  // having him steal it BEFORE he dies).
  await p.takeItem('EGG'); // safe: taking the closed egg itself, not opening it

  // Safety-net sweep: anything the early score-boost pass had to skip
  // (unreachable at the time — e.g. a treasure genuinely in the river area,
  // or WRENCH itself needing ROPE) is picked up now that the full
  // forward-order + river journey above has unlocked everything. Idempotent
  // (takenItems) for whatever the early pass already got. Deposits after
  // EVERY item, not once at the end — several of these (TRIDENT SIZE 20,
  // COFFIN-interior EMERALD, etc.) are heavy enough that accumulating even
  // a handful un-deposited risks exceeding loadMax=100 (confirmed live: a
  // batched end-of-loop deposit let "take trident" fail "Your load is too
  // heavy" after just 2-3 other treasures had piled up first).
  //
  // Wrapped in tryEarly (tolerant, not hard-failing) — the wandering thief
  // is still alive at this point (his hunt is deferred later still) and
  // his ROOM-treasure robbery (thief.ts's `ctx.rob(here, 'THIEF', 100)`,
  // unconditional whenever he visits a room) can take ANY treasure sitting
  // anywhere before this sweep ever reaches it — confirmed live (seed 2:
  // BAG-OF-COINS genuinely wasn't there, "You can't see any coins here!").
  // depositBooty only returns a stolen treasure once he's DEAD
  // ("his treasures reappear"), so a treasure caught mid-theft here is
  // correctly unreachable YET — not a script bug — and gets a real second
  // chance in the retry pass right after doThiefHunt below.
  for (const t of ALL_TREASURE_IDS) {
    if (t === 'EGG' || t === 'COFFIN') continue; // both deliberately handled separately
    // Once LAMP has burned out (even though TORCH is presumably still
    // held right now — this checks the FUSE, not the current light
    // source), a robbery can strand the player anywhere on the map with
    // no light left AND no guarantee MATCH-COUNT(6)'s tightly bounded
    // budget (only 5 successful lights, ever — matchFunction,
    // src/actions/light-sources.ts, decrements before checking
    // exhaustion) covers the trip back to Treasure Room, which alone
    // costs 2 (Living Room -> Strange Passage -> Cyclops Room ->
    // Treasure Room, gated on MAGIC-FLAG/CYCLOPS-FLAG, both already set
    // by this point) plus whatever Hades already spent. Bounding how far
    // this sweep is willing to wander from Living Room during that
    // window keeps the worst-case stranding distance survivable.
    // Confirmed live, seed 1: an unbounded fetch here (this exact
    // treasure, several rooms into the dam/reservoir region) left the
    // player 6 matches from Treasure Room after a robbery — mathematically
    // unreachable (Hades' 1 + this trip's 6 > 5 max successes) regardless
    // of routing. Deferred (not lost): the retry pass right after
    // doThiefHunt (light restored) picks up anything skipped here.
    if (p.lampBurnedOut) {
      const room = p.roomOfItem(t);
      if (room !== undefined) {
        let distance = 0;
        try {
          distance = p.bfsPath('LIVING-ROOM', room).length;
        } catch {
          distance = 0; // unresolvable via plain bfsPath (e.g. a synthetic route) — don't block on it
        }
        if (distance > 5) continue;
      }
    }
    await tryEarly(() => p.takeTreasure(t));
    // EGG (already held, closed) must NEVER be deposited here — see this
    // loop's own preceding comment.
    await depositAll(p, { exclude: new Set(['EGG']) });
  }
  await p.cmd('put bauble in case');
  // Reclaim TORCH here too if this sweep (rather than the earlier tryEarly
  // pass) is what actually crossed Gas Room — confirmed live (seed 2): the
  // early JADE/BRACELET attempt wasn't reachable yet at that point, so the
  // real crossing (and drop) happened here instead, and the earlier reclaim
  // call was a no-op for a drop that hadn't happened yet. See goto()'s own
  // comment for why this can't always be reclaimed immediately in-call.
  await reclaimTorchIfDropped(p);
  await reclaimCoalIfDropped(p);
  await reclaimWeaponIfDropped(p);
  weaponNoun = p.weaponNoun ?? weaponNoun; // pick up any substitution — see doThiefHunt's own resync comment

  // ---- Thief hunt, deferred to HERE rather than right after the Cyclops
  // interlude (an earlier shape of this generator) — measured live: fighting
  // him right after the score-boost pass's ~7-treasure attempt banked only
  // 64-94 points (MS=2-3, per verbDiagnose's MS = 2 + floor(score/70)),
  // nowhere near the "MS=4, survive several wounds" the original ordering
  // assumed, and got the player killed outright on 2 of 3 golden seeds even
  // with a maximally-cautious retreat-on-any-wound policy (some exchanges
  // are fatal within the SAME diagnose/kill call that first reveals the
  // wound — there's no way to react inside that single turn). Deferring
  // instead to right here — after essentially everything else in the game
  // is collected and deposited — maximizes the banked score (all 19
  // treasures except whatever's physically in the thief-guarded Treasure
  // Room itself, or trapped in the EGG, are already in the case). Deferring
  // this long does NOT lose anything PERMANENTLY to theft either: unlike
  // stealJunk (TVALUE==0 only), his ROOM-treasure robbery
  // (`ctx.rob(here, 'THIEF', 100)`) CAN take a TVALUE>0 treasure straight
  // out of a room before the sweep above ever reaches it (confirmed live —
  // the sweep's own comment) — but depositBooty returns every treasure
  // he's touched the moment he dies ("his treasures reappear"), so nothing
  // is lost for good, just temporarily unreachable until now. -------------
  //
  // ...UNLESS the emergency hunt (see maybeEmergencyThiefHunt) already ran:
  // a robbed TORCH is the one theft the late schedule cannot absorb (the
  // lamp's fixed budget dies long before this point without it), so the
  // hunt may already be behind us. Everything from here on is guarded on
  // thiefDead / idempotent accordingly.
  if (!p.thiefDead) {
    weaponNoun = await doThiefHunt(p, weaponNoun);
  }
  // Post-hunt progression recovery: the first progressionPass silently
  // deferred anything whose placement resolved to the thief-guarded
  // TREASURE-ROOM (takeItem's own guard — confirmed by survey: CANDLES,
  // MATCH, and PUMP all landed there on different candidate seeds), and
  // every ritual depending on such an item deferred with it. He's dead
  // now, so the same pass simply completes: idempotent for everything
  // already done (possession + flag guards throughout), and doRiverJourney
  // runs here for the boat-run case whose PUMP was only now collectible.
  await progressionPass();
  await doRiverJourney(p);
  // Hades is the one ritual with a hard downstream dependency (the SKULL
  // slot's occupant + LAND-OF-LIVING-DEAD's first-visit score) — if it
  // STILL hasn't confirmed after the recovery pass, that's final: surface
  // it as the precise failure rather than letting the score assertion at
  // the very end fail opaquely.
  if (!p.flags.has('LLD-FLAG')) {
    const ok = await doHadesRitual(p);
    if (!ok) {
      throw new Error('Hades exorcism still unconfirmed after the post-thief-hunt recovery pass — all four items should be obtainable by now');
    }
  }
  // CANARY retry (see the earlier call site's own doc comment): everything
  // that could have blocked it the first time around (LLD-FLAG unset, the
  // item itself mid-theft) is resolved by this point — the generic
  // ALL_TREASURE_IDS retry loop right below covers CANARY itself, but the
  // wind/bauble follow-up needs its own explicit call.
  await tryEarly(() => p.takeTreasure('CANARY'));
  await windCanary();
  // COFFIN retry (see the earlier call site's own doc comment) — ROPE/
  // DOME-FLAG should be resolved by now if it wasn't the first time.
  await fetchCoffin();
  // Retry pass: anything the sweep above hit mid-theft (temporarily
  // unreachable, not a script bug — see that loop's own comment) gets a
  // real second chance now that he's dead and depositBooty has returned
  // it, most likely right here in TREASURE-ROOM (doThiefHunt's own
  // grabAllAt already covers that specific case generically, but this
  // covers a robbed-and-since-redropped-elsewhere item too).
  for (const t of ALL_TREASURE_IDS) {
    if (t === 'EGG' || t === 'COFFIN') continue;
    await tryEarly(() => p.takeTreasure(t));
  }
  await depositAll(p);

  // Drop everything no longer needed and too heavy (SIZE > 4) for the coal
  // machine's EMPTY-HANDED gate (src/actions/coal-mine.ts's NO-OBJS). ROPE/
  // WRENCH/BELL/BOOK/CANDLES are already dropped right after their one-time
  // trigger fires, above — these repeats are a harmless safety net (a
  // no-op "you don't have that" if already gone). SHOVEL (never needed
  // again once SCARAB is reached) is the one still actually held here.
  // INFLATABLE-BOAT/PUMP are already gone by this point (inflating relocates
  // the boat to the room; doRiverJourney explicitly drops the pump).
  // LAMP/weapon are dropped explicitly at Ladder Bottom below; SCEPTRE
  // (SIZE 3), MATCH (SIZE 2), and GARLIC (SIZE 4) stay — all within the
  // SIZE<=4 threshold (and SCEPTRE is usually already deposited by now
  // regardless, being a treasure).
  for (const junk of ['ROPE', 'WRENCH', 'BELL', 'BOOK', 'CANDLES', 'SHOVEL']) {
    await p.cmd(`drop ${NOUN[junk]}`);
  }

  // Reclaim TORCH if goto()'s coal-gas guard had to drop it somewhere
  // earlier (see that comment) — BEFORE the coal-machine section below,
  // which assumes it's already in hand (its own `takeItem('TORCH')` is a
  // silent no-op once `takenItems` already has it, regardless of whether
  // it's still physically held).
  await reclaimTorchIfDropped(p);
  await reclaimCoalIfDropped(p);
  await reclaimWeaponIfDropped(p);
  weaponNoun = p.weaponNoun ?? weaponNoun; // pick up any substitution — see doThiefHunt's own resync comment
  // By now doThiefHunt has already run and — being dead — returned
  // whatever TVALUE>0 items (TORCH included) he was holding via
  // depositBooty, so light should be reliable again; this is the last
  // guaranteed opportunity before the coal machine genuinely needs
  // SCREWDRIVER in hand (`turn switch with screwdriver`, below) — hard
  // failure, not a tolerant retry, since takeItem('SCREWDRIVER') right
  // below is a silent no-op once takenItems already has it (see that
  // call's own comment) and would never re-surface a still-stranded one.
  await reclaimScrewdriverIfDropped(p);
  if (p.screwdriverDroppedAt !== undefined) {
    throw new Error('SCREWDRIVER is still stranded (screwdriverDroppedAt set) after the thief hunt — reportable, not expected on any pinned golden seed.');
  }
  // Same hard guarantee for GARLIC — goto('SHAFT-ROOM') just below crosses
  // Bat Room a second time (garlicDroppedAt's own doc comment), and
  // without it in hand the bat's random relocation desyncs every
  // subsequent goto() call from where the engine actually put the player.
  await reclaimGarlicIfDropped(p);
  if (p.garlicDroppedAt !== undefined) {
    throw new Error('GARLIC is still stranded (garlicDroppedAt set) after the thief hunt — reportable, not expected on any pinned golden seed.');
  }

  // ---- Coal machine (needs GARLIC+LAMP for COAL's location, and its own
  // TORCH/SCREWDRIVER/COAL — see tools/oracle/corpus/coal-machine.txt). Done
  // AFTER the thief hunt so a TORCH/SCREWDRIVER/COAL that happened to land
  // in the (thief-guarded) Treasure Room is already safely reachable. -----
  await p.takeItem('TORCH');
  await p.takeItem('SCREWDRIVER');
  await p.takeItem('COAL');
  await p.goto('SHAFT-ROOM');
  await p.cmd('put torch in basket');
  // TORCH physically leaves hand here (rides the basket down instead) —
  // these raw cmd() calls bypass takeItem()/depositAll(), the only two
  // places that otherwise keep hasTorch in sync, so it must be set
  // explicitly. Confirmed live: leaving it stale-true made goto()'s
  // gas-room detour/avoidance logic think a (nonexistent) held torch
  // needed protecting on the very next descent, AND — more seriously —
  // suppressed goto()'s own lamp-conservation block entirely (`!hasTorch`
  // gate), so that descent proceeded with neither torch nor a lit lamp:
  // pure luck (dark→dark is only an 80% grue chance per move) that it
  // wasn't a death right there instead of on the return leg below.
  p.hasTorch = false;
  await p.cmd('put screwdriver in basket');
  await p.cmd('put coal in basket');
  await p.cmd('lower basket');
  // Drop weapon+lamp at TIMBER-ROOM, not LADDER-BOTTOM — both are dark, but
  // WHERE the empty-handed gear-drop happens determines which move is the
  // risky dark→dark one (gverbs.zil:2095-2116's grue gate: PROB 80 whenever
  // BOTH the room left and the room entered are unlit). Dropping at
  // Ladder-Bottom makes the Ladder-Bottom→Timber-Room hop dark→dark (both
  // unlit, no light held) — an unforced ~80% death risk, confirmed live.
  // Dropping here instead means: Ladder-Bottom→Timber-Room is lit→dark
  // (lamp still held+lit the whole way — safe, only the "moved into a dark
  // place" notice); THEN Timber-Room→Lower-Shaft is dark→lit (Lower Shaft
  // already lit by the basket's own torch via TRANSBIT — safe). Neither leg
  // is ever dark→dark. This is the walkthrough-standard technique, not a
  // gamble — the oracle transcript's own "west, west" from Ladder-Bottom
  // just happened not to roll the 20% survival case for the wrong reason.
  await p.goto('TIMBER-ROOM');
  await p.cmd(`drop ${weaponNoun}`);
  // Deliberately dropped STILL LIT, not turned off first — an earlier
  // version of this fix turned it off to save fuel, but that leaves
  // TIMBER-ROOM genuinely dark once we walk away, which means the later
  // "take lamp" on the way back fails "It's too dark to see!" (confirmed
  // live — you cannot see a known object well enough to pick it up in an
  // unlit room, torch-in-basket or not, since it hasn't reached this room).
  // Leaving it lit means the lamp itself is what keeps TIMBER-ROOM lit
  // (`lit()` checks a room's own children for Flag.OnFire, not just held
  // ones) for the whole time it sits here — costing extra fuel (confirmed
  // live: this contributed to the lamp running out one room short of Shaft
  // Room on an earlier attempt), but that's compensated by the thief-hunt
  // fuel fix above (see doThiefHunt's own comment) rather than by risking
  // an unrecoverable pickup here.
  await p.cmd('drop lamp');
  p.flags.add('EMPTY-HANDED'); // NO-OBJS (coal-mine.ts): every carried item now has SIZE <= 4
  await p.cmd('west'); // Timber Room -> Lower Shaft; dark -> lit (basket torch), safe
  await p.cmd('take torch');
  p.hasTorch = true; // back in hand — see the put-in-basket comment above
  await p.cmd('take screwdriver');
  await p.cmd('take coal');
  await p.goto('MACHINE-ROOM');
  await p.cmd('open lid');
  await p.cmd('put coal in machine');
  await p.cmd('close lid');
  await p.cmd('turn switch with screwdriver');
  await p.cmd('open lid');
  await p.cmd('take diamond');
  // SCREWDRIVER is filler (not isTreasure) — its one job is done, so it's
  // dropped here rather than carried all the way back through the basket.
  // Every command shaved off this excursion matters: LAMP_TABLE's 385-turn
  // budget (clock.ts) is tight enough by this point in a long playthrough
  // that "nearly out" can fire mid-ritual (confirmed live), leaving barely
  // enough turns for the fixed-length return walk — two fewer commands here
  // ("put screwdriver in basket" + the later "take screwdriver") is exactly
  // that much more margin, at zero cost (nothing downstream needs it back).
  await p.cmd('drop screwdriver');
  await p.goto('LOWER-SHAFT');
  await p.cmd('put diamond in basket');
  await p.cmd('put torch in basket');
  p.hasTorch = false; // see the first put-in-basket comment above
  // Retake weapon+lamp at TIMBER-ROOM (where they were left, still lit —
  // see the outbound comment above), not LADDER-BOTTOM: Lower-Shaft→
  // Timber-Room is lit→dark (Lower Shaft still lit by the basket's torch
  // until it's actually raised, further below) — safe — and TIMBER-ROOM
  // itself is ALREADY lit by the lamp burning on the ground there, so
  // "take lamp" can actually see to succeed (dropping it OFF instead would
  // make this pickup impossible — confirmed live). Only issue "turn on
  // lamp" if it actually needs it (p.lampOn tracks this — see its own doc
  // comment) — every LAMP_TABLE tick (clock.ts, 385-turn total budget) is
  // real, whether or not the command itself changes anything, and this
  // whole excursion runs the fuel margin to the wire (confirmed live: a
  // single redundant "turn on lamp" issued here — a no-op response, but
  // still a burned turn — was the exact turn that pushed the walk back to
  // Shaft Room one command past burnout, a grue kill at Mine-1 short of
  // reaching daylight again).
  // The weapon itself is deliberately NOT reclaimed here — combat is over
  // (troll, thief, and cyclops are all already behind us) and it's dead
  // weight for the rest of this script. If it doubled as a treasure (e.g.
  // SCEPTRE), it was already banked by the depositAll() right before this
  // whole section (once p.weaponItemId was cleared at the end of
  // doThiefHunt, that deposit no longer excludes it) — so it's either
  // already safe in the case or genuine filler with no further use either
  // way. One more command saved off the fuel margin (see this section's
  // own comments) at zero cost.
  await p.goto('TIMBER-ROOM');
  await p.cmd('take lamp');
  if (!p.lampOn) await p.cmd('turn on lamp');
  p.flags.delete('EMPTY-HANDED'); // no longer true — don't let a later goto assume the gate's still open
  await p.goto('SHAFT-ROOM');
  await p.cmd('raise basket');
  await p.cmd('take diamond');
  await p.cmd('take torch');
  p.hasTorch = true; // back in hand for good now — no more basket cycles left
  // SCREWDRIVER deliberately left behind at Machine Room — see the drop
  // comment above.

  await depositAll(p, { keepTorch: false }); // done needing it as a light source — bank its TVALUE for real now

  // ---- Win: walk home and enter the barrow -------------------------------
  // "in" from West of House is an ordinary ONE-HOP MOVE to Stone Barrow
  // (rooms.json: WEST-OF-HOUSE's own "in"/"sw" exit) — it does NOT itself
  // trigger the ending. STONE-BARROW-FCN (above-ground.ts) fires the
  // victory text + finish() on M-BEG for "enter" / "walk west" / "walk in"
  // while STANDING IN Stone Barrow specifically — a second, distinct
  // command once actually there. Confirmed live: stopping after the first
  // "in" left the player sitting in Stone Barrow with the full 350 score,
  // gameOver still false, forever (nothing else in this script would ever
  // issue that second command).
  await p.goto('WEST-OF-HOUSE');
  await p.cmd('in');
  const enterOutput = await p.cmd('enter');

  // The engine's own endgame-completion signal (AMENDMENT 10): STONE_BARROW_
  // VICTORY's opening line (src/actions/above-ground.ts) is only ever
  // printed by stoneBarrowFcn on the winning path — the 3-strike-death
  // FINISH (death.ts jigsUp) prints a completely different banner and never
  // touches Stone Barrow. Checking this text directly (rather than just
  // `gameOver`, which both paths set) is what makes "deaths allowed" safe:
  // a run that hit 3 deaths and lost is gameOver too, and must not read as
  // a win.
  const won = /Inside the Barrow/.test(enterOutput);

  return { game, won, deaths: p.deaths, placements: fillResult.placements };
}

// Empirically selected per AMENDMENT 8/11 — see this file's header for the
// selection criterion and the survey table.
const PINNED_GOLDEN_SEEDS = [7, 87, 126];

describe('golden-seed end-to-end playthroughs', () => {
  it.each(PINNED_GOLDEN_SEEDS)(
    'seed %i: reaches the milestone bar via the real engine (AMENDMENT 11 point 2)',
    async (seed) => {
      // A thrown error from playSeed() itself (uncaught here) fails the seed
      // outright — that covers the bar's "no thrown errors from the
      // generator" clause; it is not re-asserted separately.
      const first = await playSeed(seed);
      const firstView = first.game.view();
      const firstMilestone = computeMilestone(first.game, first.placements);
      // The recalibrated bar (AMENDMENT 11 point 2): a MILESTONE, not full
      // completion. Deaths are tolerated (death.ts's -10 penalty and the
      // 3-strike FINISH are both ordinary vanilla-legal outcomes here) and
      // `won` (the engine's own endgame-completion signal) is recorded but
      // not required — the generator is still free to play on toward a full
      // win as a bonus (see this file's header), it just isn't asserted.
      expect(
        firstMilestone.met,
        `seed ${seed} run 1: banked=${JSON.stringify(firstMilestone.bankedTreasureIds)} ` +
        `deepSeams=${JSON.stringify(firstMilestone.deepSeamRegions)} won=${first.won} ` +
        `deaths=${JSON.stringify(first.deaths)} view=${JSON.stringify(firstView)}`,
      ).toBe(true);

      const second = await playSeed(seed);
      const secondMilestone = computeMilestone(second.game, second.placements);
      expect(
        secondMilestone.met,
        `seed ${seed} run 2: banked=${JSON.stringify(secondMilestone.bankedTreasureIds)} ` +
        `deepSeams=${JSON.stringify(secondMilestone.deepSeamRegions)} won=${second.won} ` +
        `deaths=${JSON.stringify(second.deaths)}`,
      ).toBe(true);
      expect(
        secondMilestone.bankedTreasureIds,
        'deterministic double-run: the banked-treasure milestone outcome must match between runs',
      ).toEqual(firstMilestone.bankedTreasureIds);
      expect(second.deaths.length, 'deterministic double-run: death count must match between runs').toBe(first.deaths.length);
    },
    120000,
  );
});
