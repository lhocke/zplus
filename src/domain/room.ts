import { GameObject, type GameObjectOptions, type ObjectId, type Exit } from './game-object.js';

/** One entry in a room's PSEUDO table (gparser.zil:1178-1192). */
export interface PseudoEntry {
  /** The matched noun word (UPPERCASE). */
  word: string;
  /** The ZIL action routine name to invoke on match. */
  action: string;
}

export interface RoomOptions extends GameObjectOptions {
  exits?: Exit[];
  /** ZIL P?PSEUDO — list of {word, action} pairs for pseudo-objects in this room. */
  pseudo?: PseudoEntry[];
}

export class Room extends GameObject {
  readonly exits: Exit[];
  /** ZIL P?PSEUDO — pseudo-object table for this room. */
  readonly pseudo: PseudoEntry[];

  constructor(id: ObjectId, desc: string, opts: RoomOptions = {}) {
    super(id, desc, opts);
    this.exits = opts.exits ?? [];
    this.pseudo = opts.pseudo ?? [];
  }
}
