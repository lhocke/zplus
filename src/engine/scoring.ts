import type { EventEmitter } from './events.js';
import type { GameObject } from '../domain/game-object.js';

// ---------------------------------------------------------------------------
// Rank thresholds — mirrors the 8-rank Zork I scoring table.
//
// ZIL source: 1actions.zil:4026–4044 (V-SCORE).
// The top rank is exact (SCORE == 350); all others are exclusive lower bounds
// (ZIL <G? ,SCORE N> = "SCORE > N").
//
// Port-native: ordered descending so the first matching entry wins.
// ---------------------------------------------------------------------------

interface RankEntry {
  /** Score must equal this exactly (top rank only) */
  readonly exact?: number;
  /** Score must be strictly greater than this (all other ranks) */
  readonly gt?: number;
  readonly title: string;
}

const RANKS: ReadonlyArray<RankEntry> = [
  { exact: 350,               title: 'Master Adventurer' },
  { gt:    330,               title: 'Wizard'            },
  { gt:    300,               title: 'Master'            },
  { gt:    200,               title: 'Adventurer'        },
  { gt:    100,               title: 'Junior Adventurer' },
  { gt:     50,               title: 'Novice Adventurer' },
  { gt:     25,               title: 'Amateur Adventurer'},
  // else:
  { title: 'Beginner'                                    },
];

// ---------------------------------------------------------------------------
// Scoring — the two-component Zork I score model.
//
// ZIL globals: BASE-SCORE (gverbs.zil:1847), SCORE (gverbs.zil:1845).
//
//   SCORE = BASE-SCORE + OTVAL-FROB(TROPHY-CASE)
//
// BASE-SCORE accumulates via SCORE-UPD (one-time pickup + room awards, events,
// death penalties).  The OTVAL-FROB component is recomputed live by the
// LIVING-ROOM M-END handler on every TAKE or PUT-to-trophy-case turn.
// ---------------------------------------------------------------------------

export class Scoring {
  /**
   * BASE-SCORE — accumulated non-trophy-case points (object pickups, room
   * first-visit awards, LIGHT-SHAFT, death penalties).  Never decremented
   * except by SCORE-UPD(-10) on death.
   *
   * ZIL: SETG BASE-SCORE (gverbs.zil:1847).
   */
  private _baseScore = 0;

  /**
   * Live total SCORE = BASE-SCORE + OTVAL-FROB(TROPHY-CASE).  The M-END
   * branch in LIVING-ROOM-FCN overwrites this directly via recomputeTrophy().
   *
   * ZIL: SETG SCORE (gverbs.zil:1845).
   */
  private _score = 0;

  /**
   * WON-FLAG — set exactly once when SCORE first reaches 350.
   *
   * ZIL: SETG WON-FLAG T inside SCORE-UPD (gverbs.zil:1854–1863).
   */
  private _wonFlag = false;

  private readonly emitter: EventEmitter;

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  // ---- Accessors -----------------------------------------------------------

  get score(): number {
    return this._score;
  }

  get baseScore(): number {
    return this._baseScore;
  }

  get wonFlag(): boolean {
    return this._wonFlag;
  }

  // ---- SCORE-UPD (gverbs.zil:1851–1865) -----------------------------------

  /**
   * Add `delta` to both BASE-SCORE and SCORE (the primitive that all point
   * awards route through).  Also checks the WON-FLAG 350-trigger.
   *
   * When called with delta=0 (the LIVING-ROOM M-END pattern) it is used
   * solely for the WON-FLAG side-effect check after a direct score overwrite.
   *
   * ZIL: SCORE-UPD adds NUM to BASE-SCORE and SCORE, then checks SCORE==350.
   */
  scoreUpd(delta: number): void {
    this._baseScore += delta;
    this._score += delta;
    this.checkWonFlag();
    if (delta !== 0) {
      this.emitter.emit({ type: 'score-changed', score: this._score, delta });
    }
  }

  /**
   * Legacy alias — kept so existing callers (`ctx.score(delta)`) continue
   * to work.  Routes through scoreUpd for the WON-FLAG check.
   */
  add(delta: number): void {
    if (delta === 0) return;
    this.scoreUpd(delta);
  }

  // ---- SCORE-OBJ (gverbs.zil:1867–1870) -----------------------------------

  /**
   * Award the one-time VALUE of `obj` to BASE-SCORE, then zero `obj`'s VALUE
   * so the award cannot be claimed again (idempotency guarantee).
   *
   * ZIL: SCORE-OBJ reads OBJ.VALUE; if > 0 calls SCORE-UPD and zeros VALUE.
   * The port mutates the live game-object's props map (not the static data
   * file) so re-taking does not re-award.
   *
   * Used for: ITAKE (every successful TAKE of a scored item), and first-visit
   * room awards (same mechanism applied to a room's VALUE property).
   */
  scoreObj(obj: GameObject): void {
    const val = obj.props.get('VALUE');
    if (typeof val === 'number' && val > 0) {
      this.scoreUpd(val);
      obj.props.set('VALUE', 0);
    }
  }

  // ---- OTVAL-FROB (1actions.zil:496–502) ----------------------------------

  /**
   * Recursive TVALUE sum over `container` and all descendants.
   *
   * ZIL OTVAL-FROB: iterates first-child…next-sibling; for each child adds
   * its TVALUE to a local score accumulator, then recurses if the child has
   * children (but does NOT add the recursive return value back — each frame
   * accumulates independently).  The net effect is a full depth-first sum of
   * every TVALUE in the container tree.
   *
   * Port-faithful: add child.TVALUE to `score`, then += otvalFrob(child) for
   * children, which gives the same sum because each recursive call starts its
   * own accumulator at 0.  (The ZIL behaviour is subtler: the outer frame
   * only adds each child's own TVALUE; grandchildren are handled by their
   * parent's recursive frame.  The TS form is equivalent.)
   *
   * See td3-scoring-death-SPEC.md §2 and §16.2 for the reconciliation note.
   */
  otvalFrob(container: GameObject): number {
    let score = 0;
    for (const child of container.children) {
      const tv = child.props.get('TVALUE');
      score += (typeof tv === 'number' ? tv : 0);
      if (child.children.size > 0) {
        score += this.otvalFrob(child);
      }
    }
    return score;
  }

  // ---- recomputeTrophy (1actions.zil:483–484) -----------------------------

  /**
   * Overwrite `_score` with `BASE-SCORE + OTVAL-FROB(TROPHY-CASE)`, then
   * call scoreUpd(0) for the WON-FLAG 350 side-effect check.
   *
   * CRITICAL: this is a direct assign, NOT scoreUpd(fullDelta).  Calling
   * scoreUpd with the trophy delta would double-increment BASE-SCORE.
   * (td3-scoring-death-SPEC.md §16.1.)
   *
   * ZIL: <SETG SCORE <+ ,BASE-SCORE <OTVAL-FROB>>> <SCORE-UPD 0>
   */
  recomputeTrophy(trophyCase: GameObject): void {
    const prev = this._score;
    this._score = this._baseScore + this.otvalFrob(trophyCase);
    const delta = this._score - prev;
    this.checkWonFlag();
    if (delta !== 0) {
      this.emitter.emit({ type: 'score-changed', score: this._score, delta });
    }
  }

  // ---- Rank (V-SCORE, 1actions.zil:4026–4044) -----------------------------

  /** Return the player's current rank title based on their score. */
  rank(): string {
    const s = this._score;
    for (const r of RANKS) {
      if (r.exact !== undefined) {
        if (s === r.exact) return r.title;
        continue;
      }
      if (r.gt !== undefined) {
        if (s > r.gt) return r.title;
        continue;
      }
      // Catch-all (Beginner)
      return r.title;
    }
    return 'Beginner';
  }

  // ---- Private helpers -----------------------------------------------------

  /**
   * WON-FLAG 350-trigger — fires exactly once (gverbs.zil:1854–1863).
   * Side effects (MAP.INVISIBLE clear, WEST-OF-HOUSE.TOUCHBIT clear, whisper)
   * are handled by the caller (game.ts / endgame layer, TD-3 Wave S3).
   */
  private checkWonFlag(): void {
    if (!this._wonFlag && this._score === 350) {
      this._wonFlag = true;
    }
  }
}
