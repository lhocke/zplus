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
}
