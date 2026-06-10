import { GameObject, type GameObjectOptions, type ObjectId } from './game-object.js';

export class Actor extends GameObject {
  /**
   * Mutable combat strength — ZIL P-STRENGTH analog.
   * 0 = healthy; negative = wounded (magnitude = KO depth); -10000 = dead sentinel.
   * Initialized to 0 for the player (no P-STRENGTH global, gglobals.zil:94).
   * Villain actors get their base STRENGTH prop loaded in at bootstrap.
   * 1actions.zil:3383 reads this as the initial `od` in VILLAIN-STRENGTH.
   */
  pStrength = 0;

  constructor(id: ObjectId, desc: string, opts: GameObjectOptions = {}) {
    super(id, desc, opts);
  }
}
