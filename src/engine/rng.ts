// ---------------------------------------------------------------------------
// Rng — seedable, deterministic pseudo-random number generator.
//
// Uses a Mulberry32 algorithm: a fast 32-bit state PRNG that is small,
// passes standard randomness tests, and is fully reproducible given the same
// seed.  All randomness in the engine flows through this single source so that
// seeded replays (save/restore, randomizer mode) are exact.
// ---------------------------------------------------------------------------

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;  // coerce to uint32
  }

  /** Reset state to a new seed, replaying from that point. */
  seed(s: number): void {
    this.state = s >>> 0;
  }

  /** Returns a pseudo-random float in [0, 1). */
  next(): number {
    // Mulberry32
    let z = (this.state += 0x6d2b79f5) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 1 | z);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    z = (z ^ (z >>> 14)) >>> 0;
    this.state = z;
    return z / 0x100000000;
  }

  /** Returns a pseudo-random integer in [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }
}
