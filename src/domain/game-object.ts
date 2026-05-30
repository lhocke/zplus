import type { Flag } from './flags.js';
import type { World } from './world.js';
import type { Room } from './room.js';

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

/**
 * Everything a translated ZIL action routine needs at dispatch time.
 *
 * The shape mirrors the globals a ZIL routine reaches for: the object whose
 * routine is running (`self` / the ZIL `OBJECT`), the acting creature
 * (`actor` / `WINNER`), the parsed verb and objects (`PRSA`/`PRSO`/`PRSI`),
 * the current room (`HERE`), and the world for id lookups.
 *
 * Room handlers branch on `rarg` (M-BEG/M-ENTER/M-LOOK); object handlers get
 * `rarg === undefined` and branch on `verb`.  The helpers (`hasFlag`/`setFlag`/
 * `clearFlag`/`moveTo`/`score`) cover the four ZIL primitives — `FSET?`,
 * `FSET`, `FCLEAR`, `MOVE`, and `SCORE` — that handlers reach for constantly.
 */
export interface ActionContext {
  /** The object/room whose action routine is executing (ZIL implicit OBJECT). */
  readonly self: GameObject;
  /** The acting creature — normally the player (ZIL WINNER). */
  readonly actor: GameObject;
  /** Canonical parsed verb, e.g. 'take', 'read', 'walk' (ZIL PRSA). */
  readonly verb: string;
  /** Direct object, if any (ZIL PRSO). */
  readonly dobj?: GameObject;
  /** Indirect object, if any (ZIL PRSI). */
  readonly iobj?: GameObject;
  /** Preposition for this command, e.g. 'in', 'with' — or a direction for walk. */
  readonly prep?: string;
  /** The world, for resolving object ids. */
  readonly world: World;
  /** The current room (ZIL HERE / <LOC ,WINNER>). */
  readonly here: Room;
  /** Room-handler message: M-BEG/M-ENTER/M-LOOK.  undefined for object handlers. */
  readonly rarg?: number;
  /** Print text to the player (ZIL TELL).  Newlines are preserved verbatim. */
  tell(text: string): void;
  /** Read a flag on an object — ZIL `<FSET? obj flag>`. */
  hasFlag(obj: GameObject, flag: Flag): boolean;
  /** Set a flag on an object — ZIL `<FSET obj flag>`. */
  setFlag(obj: GameObject, flag: Flag): void;
  /** Clear a flag on an object — ZIL `<FCLEAR obj flag>`. */
  clearFlag(obj: GameObject, flag: Flag): void;
  /** Move an object into a destination — ZIL `<MOVE obj dest>`. */
  moveTo(obj: GameObject, dest: GameObject): void;
  /** Add to the score (may be negative) — ZIL `<SCORE n>` / `<SETG SCORE ...>`. */
  score(delta: number): void;
  /**
   * Enable a clock interrupt by id — ZIL `<ENABLE <INT …>>` or
   * `<ENABLE <QUEUE …>>`.  Used by action handlers to gate fuel drain.
   */
  enableClock(id: string): void;
  /**
   * Disable a clock interrupt by id — ZIL `<DISABLE <INT …>>`.
   * A disabled entry is frozen in place; its tick counter does not advance.
   */
  disableClock(id: string): void;
  /**
   * Signal a fatal outcome for the current turn — ZIL M-FATAL.  Handlers call
   * this when the player dies or the game ends; the PERFORM chain stops and
   * the continuation slot is cleared.  (TD-4 Wave B wires the full body; this
   * slot holds the position until then.)
   */
  fatal(): void;
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
  /** ZIL ACTION-routine name (from the data); resolved to `handler` at bootstrap. */
  actionRoutine?: string;
  /**
   * ZIL P?CONTFCN — routine name string (from extracted data), resolved to
   * `contFcn` (an ActionHandler) at bootstrap, mirroring actionRoutine→handler.
   * Data supplied by TD-7; step 5 occupies its ordered position now and becomes
   * live when extraction lands.  Intentionally inert until then.
   */
  contFcnRoutine?: string;
  /**
   * Resolved CONTFCN handler — called by PERFORM step 5 when dobj is inside a
   * container and verb !== 'walk'.  Truthy return short-circuits the chain.
   */
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
