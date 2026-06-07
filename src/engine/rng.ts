// Mulberry32 — fast 32-bit PRNG; seeded replays are exact.
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  seed(s: number): void {
    this.state = s >>> 0;
  }

  /** Returns a pseudo-random float in [0, 1). */
  next(): number {
    let z = (this.state += 0x6d2b79f5) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 1 | z);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    z = (z ^ (z >>> 14)) >>> 0;
    this.state = z;
    return z / 0x100000000;
  }

  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Matches the previous inline engine logic exactly (golden-preserving). */
  prob(base: number): boolean {
    return this.next() * 100 < base;
  }
}
