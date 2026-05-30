import { GameObject, type GameObjectOptions, type ObjectId, type Exit } from './game-object.js';

export interface RoomOptions extends GameObjectOptions {
  exits?: Exit[];
}

export class Room extends GameObject {
  readonly exits: Exit[];

  constructor(id: ObjectId, desc: string, opts: RoomOptions = {}) {
    super(id, desc, opts);
    this.exits = opts.exits ?? [];
  }
}
