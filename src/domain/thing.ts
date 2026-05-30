import { GameObject, type GameObjectOptions, type ObjectId } from './game-object.js';

export class Thing extends GameObject {
  constructor(id: ObjectId, desc: string, opts: GameObjectOptions = {}) {
    super(id, desc, opts);
  }
}
