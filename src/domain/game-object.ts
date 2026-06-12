import type { Flag } from './flags.js';
import type { World } from './world.js';
import type { Room } from './room.js';
import type { PickRng } from '../engine/game-messages.js';

export type ObjectId = string;

export type Dir =
  | 'north' | 'south' | 'east' | 'west'
  | 'ne' | 'nw' | 'se' | 'sw'
  | 'up' | 'down' | 'in' | 'out';

export interface Exit {
  readonly dir: Dir;
  readonly to?: ObjectId;
  readonly per?: string;
  readonly ifFlag?: ObjectId;
  readonly elseMessage?: string;
}

/** true = ZIL RTRUE (handled, suppress the rest); false = fall through. */
export type HandlerResult = boolean;

/** Everything a translated ZIL action routine needs at dispatch time. */
export interface ActionContext {
  /** Object/room whose action routine is executing (ZIL OBJECT). */
  readonly self: GameObject;
  /** Acting creature — normally the player (ZIL WINNER). */
  readonly actor: GameObject;
  /** Canonical parsed verb word, e.g. 'take', 'kill', 'look' (surface form). */
  readonly verb: string;
  /**
   * ZIL PRSA — the parsed action, e.g. 'V-ATTACK', 'V-EXAMINE'.
   * Multiple verb words can map to the same action (kill/stab/strike → V-ATTACK).
   * Handlers that need ZIL VERB? semantics must compare this, not `verb`.
   * Optional for backwards compat; absent → treat as unknown action.
   */
  readonly action?: string;
  /** Direct object, if any (ZIL PRSO). */
  readonly dobj?: GameObject;
  /**
   * True when ZIL PRSO == ROOMS (bare climb/climb-down with no noun).
   * Distinct from dobj=undefined (V-CLIMB-UP direct): in ZIL, V-CLIMB-DOWN
   * passes PRSO=ROOMS as the OBJ arg so branch 1 fires; V-CLIMB-UP direct
   * passes OBJ=<> so branch 1 is skipped.  gverbs.zil:300–302.
   */
  readonly dobjIsRooms?: boolean;
  /** Indirect object, if any (ZIL PRSI). */
  readonly iobj?: GameObject;
  /** Preposition for this command, e.g. 'in', 'with' — or a direction for walk. */
  readonly prep?: string;
  /** The world, for resolving object ids. */
  readonly world: World;
  /** Current room (ZIL HERE). */
  readonly here: Room;
  /** Room-handler message: M-BEG/M-ENTER/M-LOOK.  undefined for object handlers. */
  readonly rarg?: number;
  /** Seeded RNG for PICK-ONE operations (YUKS/DUMMY/HO-HUM tables). */
  readonly rng?: PickRng;
  tell(text: string): void;
  hasFlag(obj: GameObject, flag: Flag): boolean;
  setFlag(obj: GameObject, flag: Flag): void;
  clearFlag(obj: GameObject, flag: Flag): void;
  moveTo(obj: GameObject, dest: GameObject): void;
  score(delta: number): void;
  /** Award one-time VALUE to BASE-SCORE then zero it — ZIL SCORE-OBJ (gverbs.zil:1867–1870). */
  scoreObj(obj: GameObject): void;
  /** Recompute trophy-case TVALUE and update total score — called by LIVING-ROOM-FCN M-END. */
  recomputeTrophy(trophyCase: GameObject): void;
  enableClock(id: string): void;
  disableClock(id: string): void;
  /** Query whether a clock entry is currently enabled.  Optional; absent → false. */
  isClockEnabled?(id: string): boolean;
  /** Whether the player is currently dead (ghost mode).  Optional; absent → false. */
  isDead?(): boolean;
  /**
   * Re-arm a clock entry: set its turnsLeft and enable/disable it.
   * Mirrors the ZIL <ENABLE <QUEUE id period>> + <QUEUE id 0> park idiom.
   * Optional so existing test stubs that don't wire the clock still type-check.
   */
  queueClock?(id: string, period: number, enabled: boolean): void;
  /** Signal fatal outcome — ZIL M-FATAL; stops the PERFORM chain. */
  fatal(): void;
  /**
   * Full JIGS-UP death machinery — 1actions.zil:4046–4099.
   * Emits the death/resurrection sequence and signals fatal abort.
   * Optional so unit-test stubs that don't wire the death machinery can omit it.
   */
  jigsUp?(deathMessage: string): void;
  /**
   * FINISH — gverbs.zil:33–53.  Web-shell form: render V-SCORE, set gameOver.
   * Optional so action contexts that don't need it can omit it.
   */
  finish?(): void;

  // ZIL global flag store

  /** Read a ZIL global boolean (e.g. 'WON-FLAG').  Optional; absent → false. */
  getGlobal?(name: string): boolean;
  /** Write a ZIL global boolean.  Optional; test contexts may omit. */
  setGlobal?(name: string, value?: boolean): void;
  /**
   * Read a ZIL integer global by name.
   * Supports 'WATER-LEVEL' and 'BEACH-DIG' (Phase-3 dam/river integer globals).
   * Optional; absent → 0.
   */
  getIntGlobal?(name: string): number;
  /** Write a ZIL integer global by name.  Optional; test contexts may omit. */
  setIntGlobal?(name: string, value: number): void;
  /**
   * MUNG-ROOM: replace a room's ldesc with a flooded/destroyed description
   * and move it out of the live description path.  Used by I-MAINT-ROOM when
   * the maintenance room fills with water.  Optional; no-op when absent.
   * 1actions.zil:1349 / gverbs.zil:2183–2189.
   */
  mungRoom?(roomId: string, desc: string): void;
  /**
   * ZIL THIS-IS-IT: re-point the pronoun referent ("it") to the given object.
   * Used by routines that swap objects (IBOAT-FUNCTION, RBOAT-FUNCTION DEFLATE,
   * etc.) so the next command's "it" tracks the newly-placed object.
   * Optional so unit-test stubs that don't need pronoun tracking can omit it.
   * 1actions.zil:2834 (inflate), :2815 (deflate).
   */
  thisIsIt?(obj: GameObject): void;
}

export type ActionHandler = (ctx: ActionContext) => HandlerResult;

export interface GameObjectOptions {
  synonyms?: string[];
  adjectives?: string[];
  ldesc?: string;
  fdesc?: string;
}

export class GameObject {
  readonly id: ObjectId;
  desc: string;
  ldesc?: string;
  fdesc?: string;
  readonly props: Map<string, number | string>;
  readonly flags: Set<Flag>;
  parent: GameObject | null;
  readonly children: Set<GameObject>;
  handler?: ActionHandler;
  /** ZIL ACTION-routine name; resolved to `handler` at bootstrap. */
  actionRoutine?: string;
  /** ZIL P?CONTFCN routine name; resolved to `contFcn` at bootstrap. */
  contFcnRoutine?: string;
  /** CONTFCN handler — called by PERFORM step 5 when dobj is inside a container. */
  contFcn?: ActionHandler;
  readonly synonyms: string[];
  readonly adjectives: string[];

  constructor(id: ObjectId, desc: string, opts: GameObjectOptions = {}) {
    this.id = id;
    this.desc = desc;
    this.ldesc = opts.ldesc;
    this.fdesc = opts.fdesc;
    this.props = new Map();
    this.flags = new Set();
    this.parent = null;
    this.children = new Set();
    this.synonyms = opts.synonyms ?? [];
    this.adjectives = opts.adjectives ?? [];
  }

  has(f: Flag): boolean {
    return this.flags.has(f);
  }

  set(f: Flag): void {
    this.flags.add(f);
  }

  clear(f: Flag): void {
    this.flags.delete(f);
  }

  moveTo(dest: GameObject | null): void {
    if (this.parent !== null) {
      this.parent.children.delete(this);
    }
    this.parent = dest;
    if (dest !== null) {
      dest.children.add(this);
    }
  }
}
