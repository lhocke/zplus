import type { EventEmitter } from './events.js';

// ---------------------------------------------------------------------------
// Rank thresholds — mirrors the Zork I scoring ranks.
//
// Each entry is the minimum score needed to hold that rank.  The list is
// ordered ascending; the last entry whose threshold is met wins.
// ---------------------------------------------------------------------------

const RANKS: ReadonlyArray<{ min: number; title: string }> = [
  { min:   0, title: 'Beginner'           },
  { min:  50, title: 'Amateur Adventurer' },
  { min: 100, title: 'Junior Adventurer'  },
  { min: 200, title: 'Adventurer'         },
  { min: 300, title: 'Master Adventurer'  },
];

// ---------------------------------------------------------------------------
// Scoring — tracks the 350-point score, emits score-changed events.
// ---------------------------------------------------------------------------

export class Scoring {
  private _score = 0;
  private readonly emitter: EventEmitter;

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  get score(): number {
    return this._score;
  }

  /**
   * Add `delta` points (may be negative for penalties).  Emits `score-changed`
   * unless delta is zero.
   */
  add(delta: number): void {
    if (delta === 0) return;
    this._score += delta;
    this.emitter.emit({ type: 'score-changed', score: this._score, delta });
  }

  /** Return the player's current rank title based on their score. */
  rank(): string {
    let title = RANKS[0]!.title;
    for (const r of RANKS) {
      if (this._score >= r.min) title = r.title;
    }
    return title;
  }
}
