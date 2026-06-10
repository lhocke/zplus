/**
 * ScriptedRng — forced-RNG test harness for combat unit tests (§12 F4, §11.5).
 *
 * next() pops from a fixed draw list and wraps on exhaustion, making every
 * combat blow deterministic under test. Satisfies the full widened Rng interface
 * (next / nextInt / prob / zprob — gmacros.zil:115–122) so it can be injected
 * into createGame({ rng }) or passed directly to any engine function.
 */
export class ScriptedRng {
  private readonly draws: readonly number[];
  private idx = 0;
  drawCount = 0;

  constructor(draws: readonly number[]) {
    if (draws.length === 0) throw new Error('ScriptedRng: draws list must not be empty');
    this.draws = draws;
  }

  next(): number {
    const v = this.draws[this.idx % this.draws.length]!;
    this.idx++;
    this.drawCount++;
    return v;
  }

  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  // ZIL <PROB base>: true with probability ~base/100.
  prob(base: number): boolean {
    return this.next() * 100 < base;
  }

  // ZIL ZPROB — gmacros.zil:115–122: continuous draw next()*denom < base.
  // denom=100 when LUCKY, denom=300 when not (~1/3 as likely).
  zprob(base: number, denom: number): boolean {
    return this.next() * denom < base;
  }
}
