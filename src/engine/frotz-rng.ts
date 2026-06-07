// FrotzRng — replicates Frotz's seeded RNG (src/common/random.c) so seeded runs
// match `dfrotz -s <seed>`. The LCG state is a C `long`; 64-bit math via BigInt
// (a naive Number port silently diverges). Only bits 16-30 of the state are
// used, so signed/unsigned interpretation is irrelevant.
const MULT = 0x015a4e35n;
const MASK64 = (1n << 64n) - 1n;

export class FrotzRng {
  private A = 1n;

  constructor(seed: number) {
    this.A = BigInt(seed) & MASK64;
  }

  /** @random N -> integer in [1, N]. */
  random(range: number): number {
    this.A = (MULT * this.A + 1n) & MASK64;
    const result = Number((this.A >> 16n) & 0x7fffn);
    return (result % range) + 1;
  }
}
