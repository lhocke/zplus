import type { EventEmitter } from './events.js';

// ---------------------------------------------------------------------------
// ClockEntry — a single registered interrupt.
//
// Mirrors the slot layout from gclock.zil:
//   C-ENABLED? (0) — whether this slot participates in CLOCKER
//   C-TICK     (1) — turns remaining until the callback fires
//   C-RTN      (2) — the routine to call
//
// tick() is invoked when turnsLeft reaches 0.  Return true to re-schedule
// (the entry's turnsLeft must already be reset before returning); false if
// the entry should be removed from the active set after firing.
// ---------------------------------------------------------------------------

export interface ClockEntry {
  id: string;
  turnsLeft: number;
  enabled: boolean;
  tick(): boolean;
}

// Serialisable snapshot shape — matches the SaveState.clock field from the
// implementation plan so Clock can round-trip through save/restore.
export interface ClockSnapshot {
  id: string;
  turnsLeft: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Clock — the interrupt queue.
//
// advance() mirrors CLOCKER from gclock.zil: iterate over enabled entries,
// decrement each tick counter, and invoke the routine when the counter
// reaches 0.  Entries whose tick() returns false are removed afterward.
//
// ZIL detail: CLOCKER fires when tick was 1 (i.e. the condition
// `<NOT <G? .TICK 1>>` means "fire when tick <= 1 before decrement").
// Entries with an initial turnsLeft of 0 are never fired (they stay dormant).
// ---------------------------------------------------------------------------

export class Clock {
  private readonly entries = new Map<string, ClockEntry>();

  constructor() {}

  schedule(entry: ClockEntry): void {
    this.entries.set(entry.id, entry);
  }

  enable(id: string): void {
    const e = this.entries.get(id);
    if (e) e.enabled = true;
  }

  disable(id: string): void {
    const e = this.entries.get(id);
    if (e) e.enabled = false;
  }

  /** Called once per player turn, after the command executes. */
  advance(): void {
    const toRemove: string[] = [];

    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if (entry.turnsLeft <= 0) continue;  // tick=0 means dormant (ZIL behaviour)

      entry.turnsLeft -= 1;

      if (entry.turnsLeft === 0) {
        const rescheduled = entry.tick();
        if (!rescheduled) {
          toRemove.push(entry.id);
        }
      }
    }

    for (const id of toRemove) {
      this.entries.delete(id);
    }
  }

  /** Snapshot for SaveState serialisation. */
  snapshot(): ClockSnapshot[] {
    return Array.from(this.entries.values()).map((e) => ({
      id: e.id,
      turnsLeft: e.turnsLeft,
      enabled: e.enabled,
    }));
  }

  /**
   * Restore from a snapshot.  Each entry must already be registered (so its
   * tick callback is attached); this only resets the mutable fields.
   */
  restore(snaps: ClockSnapshot[]): void {
    for (const snap of snaps) {
      const entry = this.entries.get(snap.id);
      if (entry) {
        entry.turnsLeft = snap.turnsLeft;
        entry.enabled = snap.enabled;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// LAMP-TABLE — mirrors the ZIL constant from 1actions.zil.
//
// The GO() routine queues I-LANTERN with an initial 200-turn countdown (the
// "full brightness" period).  When that fires, I-LANTERN reads the first
// LAMP-TABLE entry to determine the *next* countdown and the warning message.
// Each subsequent fire advances to the next table entry.  The final entry
// (ticks: 0) is the burnout signal, fired in the same invocation as the
// "nearly out" re-queue.
//
// Stage sequence and cumulative turns elapsed from lamp-on:
//   200 turns  — first fire: "The lamp appears a bit dimmer."   (re-queue 100)
//   300 turns  — second fire: "The lamp is definitely dimmer now." (re-queue 70)
//   370 turns  — third fire: "The lamp is nearly out."           (re-queue 15)
//   385 turns  — burnout: lamp goes dark (ticks: 0 stage fires immediately)
// ---------------------------------------------------------------------------

const LAMP_TABLE: ReadonlyArray<{ ticks: number; message: string }> = [
  { ticks: 100, message: 'The lamp appears a bit dimmer.' },
  { ticks:  70, message: 'The lamp is definitely dimmer now.' },
  { ticks:  15, message: 'The lamp is nearly out.' },
  { ticks:   0, message: '' },  // burnout sentinel
];

// Initial countdown before the first warning (from GO() in 1dungeon.zil).
const LAMP_INITIAL_TICKS = 200;

// ---------------------------------------------------------------------------
// LanternInterrupt — faithful TypeScript translation of I-LANTERN from
// 1actions.zil.
//
// Each fire:
//   1. Reads the current LAMP_TABLE entry's tick count for the next interval.
//   2. Emits a lantern-fuel event with the warning message (or burnout).
//   3. When the next entry is the burnout sentinel (ticks: 0), the burnout
//      fires in the same turn — matching ZIL's LIGHT-INT call with tick=0.
//
// disable()/enable() let the frotz invocation freeze fuel drain without
// losing table position.
// ---------------------------------------------------------------------------

export class LanternInterrupt {
  private tableIndex = 0;
  private readonly entry: ClockEntry;

  constructor(
    private readonly clock: Clock,
    private readonly emitter: EventEmitter,
    initialTicks = LAMP_INITIAL_TICKS,
  ) {
    const self = this;
    this.entry = {
      id: 'I-LANTERN',
      turnsLeft: initialTicks,
      enabled: true,
      tick(): boolean {
        return self.onFire();
      },
    };
    clock.schedule(this.entry);
  }

  disable(): void {
    this.clock.disable('I-LANTERN');
  }

  enable(): void {
    this.clock.enable('I-LANTERN');
  }

  private remainingTurns(): number {
    return LAMP_TABLE.slice(this.tableIndex).reduce((acc, s) => acc + s.ticks, 0);
  }

  private onFire(): boolean {
    const stage = LAMP_TABLE[this.tableIndex]!;

    // Emit the warning for the stage that just triggered.
    const remaining = this.remainingTurns() - stage.ticks;
    this.emitter.emit({
      type: 'lantern-fuel',
      remaining,
      message: stage.message || undefined,
      dark: false,
    });

    // Advance to next stage.
    this.tableIndex++;
    const next = LAMP_TABLE[this.tableIndex];

    if (!next || next.ticks === 0) {
      // ZIL: I-LANTERN re-queues with 0, then calls LIGHT-INT with tick=0,
      // which fires the burnout message immediately in the same invocation.
      this.emitter.emit({ type: 'lantern-fuel', remaining: 0, dark: true });
      return false; // permanently done; remove from clock
    }

    this.entry.turnsLeft = next.ticks;
    return true;
  }
}
