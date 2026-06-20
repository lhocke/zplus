import type { EventEmitter } from './events.js';
import type { GameObject } from '../domain/game-object.js';
import type { FlagStore } from './flag-store.js';

// Rank thresholds — 1actions.zil:4026–4044 (V-SCORE).
// Top rank is exact (SCORE == 350); others are exclusive lower bounds (ZIL <G? ,SCORE N>).
const RANKS: ReadonlyArray<{ exact?: number; gt?: number; title: string }> = [
  { exact: 350, title: 'Master Adventurer' },
  { gt: 330,    title: 'Wizard' },
  { gt: 300,    title: 'Master' },
  { gt: 200,    title: 'Adventurer' },
  { gt: 100,    title: 'Junior Adventurer' },
  { gt: 50,     title: 'Novice Adventurer' },
  { gt: 25,     title: 'Amateur Adventurer' },
  {             title: 'Beginner' },
];

// Two-component Zork I score model.
// ZIL globals: BASE-SCORE (gverbs.zil:1847), SCORE (gverbs.zil:1845).
// SCORE = BASE-SCORE + OTVAL-FROB(TROPHY-CASE)
export class Scoring {
  // BASE-SCORE — accumulated non-trophy-case points. ZIL: SETG BASE-SCORE.
  private _baseScore = 0;
  // Live total SCORE = BASE-SCORE + OTVAL-FROB(TROPHY-CASE). ZIL: SETG SCORE.
  private _score = 0;
  // WON-FLAG — set once when SCORE first reaches 350. ZIL: gverbs.zil:1854–1863.
  private _wonFlag = false;

  private readonly emitter: EventEmitter;
  private readonly flagStore?: FlagStore;
  // Side effects fired once when WON-FLAG is first set (gverbs.zil:1858–1862):
  // FCLEAR MAP INVISIBLE, FCLEAR WEST-OF-HOUSE TOUCHBIT, TELL whisper.
  private readonly wonFlagHook?: (tell: (s: string) => void) => void;

  constructor(
    emitter: EventEmitter,
    flagStore?: FlagStore,
    wonFlagHook?: (tell: (s: string) => void) => void,
  ) {
    this.emitter = emitter;
    this.flagStore = flagStore;
    this.wonFlagHook = wonFlagHook;
  }

  get score(): number { return this._score; }
  get baseScore(): number { return this._baseScore; }
  get wonFlag(): boolean { return this._wonFlag; }

  // SCORE-UPD — gverbs.zil:1851–1865
  scoreUpd(delta: number, tell?: (s: string) => void): void {
    this._baseScore += delta;
    this._score += delta;
    this.checkWonFlag(tell);
    if (delta !== 0) {
      this.emitter.emit({ type: 'score-changed', score: this._score, delta });
    }
  }

  // Legacy alias kept so existing ctx.score(delta) callers continue to work.
  add(delta: number): void {
    if (delta === 0) return;
    this.scoreUpd(delta);
  }

  // SCORE-OBJ — gverbs.zil:1867–1870
  // Award the one-time VALUE of obj, then zero it so the award cannot repeat.
  scoreObj(obj: GameObject, tell?: (s: string) => void): void {
    const val = obj.props.get('VALUE');
    if (typeof val === 'number' && val > 0) {
      this.scoreUpd(val, tell);
      obj.props.set('VALUE', 0);
    }
  }

  // OTVAL-FROB — 1actions.zil:496–502
  // Sums TVALUE of direct children only. The ZIL routine does call itself
  // recursively on line 501 (<COND (<FIRST? .F> <OTVAL-FROB .F>)>) but
  // discards the return value — the SCORE accumulator is never updated by
  // the inner call. So nested container TVALUEs do NOT contribute.
  // dfrotz ground truth: depositing intact EGG (containing CANARY, TVALUE=4)
  // scores +5, not +9 (dfrotz R119 delta 15→20, n/n/climb/take egg/d/s/s/e/
  // open window/enter/w/open trophy case/put egg in trophy case).
  otvalFrob(container: GameObject): number {
    let score = 0;
    for (const child of container.children) {
      const tv = child.props.get('TVALUE');
      score += (typeof tv === 'number' ? tv : 0);
      // ZIL recurses here but discards the result — we skip the call entirely.
    }
    return score;
  }

  // recomputeTrophy — 1actions.zil:483–484
  // Direct assign (not scoreUpd) to avoid double-incrementing BASE-SCORE.
  recomputeTrophy(trophyCase: GameObject, tell?: (s: string) => void): void {
    const prev = this._score;
    this._score = this._baseScore + this.otvalFrob(trophyCase);
    const delta = this._score - prev;
    this.checkWonFlag(tell);
    if (delta !== 0) {
      this.emitter.emit({ type: 'score-changed', score: this._score, delta });
    }
  }

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
      return r.title;
    }
    return 'Beginner';
  }

  // SS3 — save/restore surface (spec §3.5).
  // snapshotState/restoreState are the only path to read or write the three
  // private accumulators from outside this class; no public setters exist.
  snapshotState(): { baseScore: number; score: number; wonFlag: boolean } {
    return { baseScore: this._baseScore, score: this._score, wonFlag: this._wonFlag };
  }

  // Reinstate accumulators directly, bypassing checkWonFlag entirely.
  // The world effects (whisper, FCLEAR) already happened in the saved game and
  // are captured in the object/flag deltas — re-firing would double-emit them.
  restoreState(s: { baseScore: number; score: number; wonFlag: boolean }): void {
    this._baseScore = s.baseScore;
    this._score     = s.score;
    this._wonFlag   = s.wonFlag;
  }

  private checkWonFlag(tell?: (s: string) => void): void {
    if (!this._wonFlag && this._score === 350) {
      this._wonFlag = true;
      this.flagStore?.set('WON-FLAG', true);
      // gverbs.zil:1858–1862: FCLEAR MAP INVISIBLE, FCLEAR WEST-OF-HOUSE TOUCHBIT, TELL whisper.
      this.wonFlagHook?.(tell ?? (() => { /* no output channel */ }));
    }
  }
}
