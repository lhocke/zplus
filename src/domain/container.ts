import { GameObject, type GameObjectOptions, type ObjectId } from './game-object.js';
import { Flag } from './flags.js';

export class Container extends GameObject {
  constructor(id: ObjectId, desc: string, opts: GameObjectOptions = {}) {
    super(id, desc, opts);
    this.set(Flag.Container);
  }
}
