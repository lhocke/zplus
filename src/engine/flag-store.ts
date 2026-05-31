/**
 * FlagStore — a Map-backed store for ZIL global boolean flags.
 *
 * ZIL globals like WON-FLAG, MAGIC-FLAG, TROLL-FLAG, etc. have no world object
 * counterpart.  This store provides a default-false Map keyed by flag name,
 * matching ZIL `<GLOBAL X <>>` (initial value = false).
 *
 * Backed by ifFlag exit resolution in verbs/index.ts: when ctx.world.get(name)
 * returns undefined (no world object), the resolver reads this store instead of
 * the object's Flag.Open bit.
 */
export class FlagStore {
  private flags = new Map<string, boolean>();

  /** Returns the stored value, or false if never set (ZIL default `<>`). */
  get(name: string): boolean {
    return this.flags.get(name) ?? false;
  }

  /** Set a global flag. Defaults to true (ZIL `<SETG FLAG T>`). */
  set(name: string, value = true): void {
    this.flags.set(name, value);
  }

  /** Clear all flags — used for test isolation and new-game reset. */
  reset(): void {
    this.flags.clear();
  }
}
