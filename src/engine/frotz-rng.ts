// FrotzRng — replicates Frotz's seeded RNG (src/common/random.c) so seeded runs
// match `dfrotz -s <seed>`. The LCG state is a C `long`; 64-bit math via BigInt
// (a naive Number port silently diverges). Only bits 16-30 of the state are
// used, so signed/unsigned interpretation is irrelevant.
const MULT = 0x015a4e35n;
const MASK64 = (1n << 64n) - 1n;

export class FrotzRng {
  private A = 1n;
  private interval = 0; // > 0 => special sequential mode
  private counter = 0;

  constructor(seed: number) {
    this.seedRandom(seed);
  }

  // Mirrors Frotz seed_random(): entropy / sequential / standard branches.
  seedRandom(value: number): void {
    if (value === 0) {            // entropy mode — unpredictable in Frotz; parity not needed
      this.A = 1n; this.interval = 0;
    } else if (value < 1000) {    // special sequential mode (rising test sequence)
      this.counter = 0; this.interval = value;
    } else {                       // standard seeded LCG
      this.A = BigInt(value) & MASK64; this.interval = 0;
    }
  }

  /** @random N -> integer in [1, N]. */
  random(range: number): number {
    let result: number;
    if (this.interval !== 0) {
      result = this.counter;
      this.counter += 1;
      if (this.counter === this.interval) this.counter = 0;
    } else {
      this.A = (MULT * this.A + 1n) & MASK64;
      result = Number((this.A >> 16n) & 0x7fffn);
    }
    return (result % range) + 1;
  }

  /** ZIL <PROB base> (no loser arg) = <G? base <RANDOM 100>>. */
  prob(base: number): boolean {
    return base > this.random(100);
  }

  /** Rng-interface compliance (not used on the grue path). */
  next(): number { return (this.random(32768) - 1) / 32768; }
  nextInt(n: number): number { return this.random(n) - 1; }
}
