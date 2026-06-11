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
  /** Signal fatal outcome — ZIL M-FATAL; stops the PERFORM chain. */
  fatal(): void;
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
