// Map-backed store for ZIL global boolean flags (WON-FLAG, MAGIC-FLAG, etc.).
// Default-false, matching ZIL `<GLOBAL X <>>`.
export class FlagStore {
  private flags = new Map<string, boolean>();

  get(name: string): boolean {
    return this.flags.get(name) ?? false;
  }

  set(name: string, value = true): void {
    this.flags.set(name, value);
  }

  reset(): void {
    this.flags.clear();
  }

  // SS4 — serialization surface.
  snapshot(): [string, boolean][] {
    return Array.from(this.flags.entries());
  }

  // restore() REPLACES the map — a saved false must beat a ctor-set true.
  restore(entries: [string, boolean][]): void {
    this.flags.clear();
    for (const [k, v] of entries) this.flags.set(k, v);
  }
}
