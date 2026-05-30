import type { Flag } from './flags.js';

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

export type HandlerResult = boolean;

export interface ActionContext {
  readonly self: GameObject;
  readonly actor: GameObject;
  verb: string;
  dobj?: GameObject;
  iobj?: GameObject;
  tell(text: string): void;
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
