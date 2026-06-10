import type { EventEmitter } from './events.js';

// ClockTickContext — passed into tick() so interrupt routines can push
// transcript text back into the current turn's output.
//
// Two channels, two concerns:
//   tell()  — transcript text (human-readable warning lines).
//   events  — state mutation (flags / HUD via EventEmitter).
// Event handlers must not re-render event.message to screen or warnings double.

export interface ClockTickContext {
  /** Push a non-empty string into the advance() return buffer. */
  tell(text: string): void;
}

// ClockEntry — a single registered interrupt.
//
// Mirrors the slot layout from gclock.zil:
//   C-ENABLED? (0) — whether this slot participates in CLOCKER
//   C-TICK     (1) — turns remaining until the callback fires
//   C-RTN      (2) — the routine to call
//
// tick(ctx) is invoked when turnsLeft reaches 0 (countdown) or on every
// advance() when turnsLeft < 0 (demon mode — the ZIL QUEUE I-* -1 convention).
// Return true to keep the entry scheduled; false to self-remove permanently.
//
// Demon convention (ZIL: QUEUE I-FIGHT -1):
//   turnsLeft < 0 → fires every advance(), turnsLeft is NEVER decremented.
//   A demon returning false self-removes permanently.
//   A demon that should merely pause must use disable() / return true and no-op.

export interface ClockEntry {
  id: string;
  turnsLeft: number;
  enabled: boolean;
  tick(ctx: ClockTickContext): boolean;
}

// Serialisable snapshot shape — matches the SaveState.clock field so Clock
// can round-trip through save/restore.
export interface ClockSnapshot {
  id: string;
  turnsLeft: number;
  enabled: boolean;
}

// Clock — the interrupt queue.
//
// advance() mirrors CLOCKER from gclock.zil: iterate over enabled entries,
// decrement each tick counter, and invoke the routine when the counter
// reaches 0.  Entries whose tick() returns false are removed afterward.
//
// ZIL detail: CLOCKER fires when tick was 1 (i.e. the condition
// `<NOT <G? .TICK 1>>` means "fire when tick <= 1 before decrement").
// Entries with an initial turnsLeft of 0 are never fired (they stay dormant).

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

  // Re-arm an existing entry: set turnsLeft=period and optionally enable it.
  // Used by I-CURE which re-queues itself every CURE_WAIT turns.
  queue(id: string, period: number, enabled: boolean): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.turnsLeft = period;
    e.enabled = enabled;
  }

  // Batch-disable — mirrors KILL-INTERRUPTS (1actions.zil:4125–4135).
  // Safe no-op for unregistered ids.
  killAll(ids: string[]): void {
    for (const id of ids) {
      this.disable(id);
    }
  }

  // Called once per player turn, after the command executes.
  //
  // Returns any transcript text pushed by interrupt tick() callbacks via
  // ctx.tell().  Callers that ignore the return value are unaffected.
  //
  // Three regimes keyed on the SIGN of turnsLeft (the ZIL tick==-1 convention):
  //   turnsLeft === 0  → DORMANT: skip entirely (ZIL parked slot).
  //   turnsLeft < 0    → DEMON: fire every advance(), never decrement.
  //                      tick() returning false self-removes permanently.
  //   turnsLeft > 0    → COUNTDOWN: decrement then fire at zero.
  advance(): string[] {
    const lines: string[] = [];
    const ctx: ClockTickContext = { tell: (t) => { if (t) lines.push(t); } };
    const toRemove: string[] = [];

    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if (entry.turnsLeft === 0) continue;  // dormant: parked slot (ZIL behaviour)

      if (entry.turnsLeft < 0) {
        // Demon: fire every turn, never decrement turnsLeft.
        const keep = entry.tick(ctx);
        if (!keep) toRemove.push(entry.id);
        continue;
      }

      entry.turnsLeft -= 1;

      if (entry.turnsLeft === 0) {
        const rescheduled = entry.tick(ctx);
        if (!rescheduled) {
          toRemove.push(entry.id);
        }
      }
    }

    for (const id of toRemove) {
      this.entries.delete(id);
    }

    return lines;
  }

  /** Snapshot for SaveState serialisation. */
  snapshot(): ClockSnapshot[] {
    return Array.from(this.entries.values()).map((e) => ({
      id: e.id,
      turnsLeft: e.turnsLeft,
      enabled: e.enabled,
    }));
  }

  // Restore from a snapshot.  Each entry must already be registered (so its
  // tick callback is attached); this only resets the mutable fields.
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

// FuelStage — one row in a LAMP_TABLE or CANDLE_TABLE.
// ticks: 0 is the burnout sentinel; it fires immediately in the same turn
// as the preceding "nearly out" stage (ZIL I-LANTERN / I-CANDLES behaviour).
type FuelStage = { ticks: number; message: string };

// FuelInterrupt — shared machinery for I-LANTERN and I-CANDLES from
// 1actions.zil.  Each fire walks a stage table, emits the appropriate fuel
// event (EVENT CHANNEL: state/HUD), and routes the warning message into the
// transcript (TRANSCRIPT CHANNEL: ctx.tell).  The final sentinel entry
// (ticks: 0) triggers a dark:true burnout in the same invocation.
//
// disable()/enable() freeze fuel drain without losing table position,
// supporting frotz/unlit invocations.

class FuelInterrupt {
  private tableIndex = 0;
  protected readonly entry: ClockEntry;

  constructor(
    private readonly clock: Clock,
    private readonly emitter: EventEmitter,
    private readonly table: ReadonlyArray<FuelStage>,
    private readonly eventType: 'lantern-fuel' | 'candle-fuel',
    private readonly id: string,
    initialTicks: number,
  ) {
    const self = this;
    this.entry = {
      id,
      turnsLeft: initialTicks,
      enabled: true,
      tick(ctx): boolean {
        return self.onFire(ctx);
      },
    };
    clock.schedule(this.entry);
  }

  disable(): void {
    this.clock.disable(this.id);
  }

  enable(): void {
    this.clock.enable(this.id);
  }

  private remainingTurns(): number {
    return this.table.slice(this.tableIndex).reduce((acc, s) => acc + s.ticks, 0);
  }

  private onFire(ctx: ClockTickContext): boolean {
    const stage = this.table[this.tableIndex]!;

    // The trailing zero-tick row is the burnout sentinel — the source is spent.
    if (stage.ticks === 0) {
      this.emitter.emit({ type: this.eventType, remaining: 0, dark: true });
      return false;
    }

    // EVENT CHANNEL: state mutation (flags / HUD). remaining = turns of light left.
    this.emitter.emit({
      type: this.eventType,
      remaining: this.remainingTurns(),
      message: stage.message || undefined,
      dark: false,
    });

    // TRANSCRIPT CHANNEL: push warning text into the turn output.
    if (stage.message) {
      ctx.tell(stage.message);
    }

    // Re-queue with THIS stage's own gap before the next warning — ZIL re-queues
    // <GET .TBL 0> (the current row), not the following one (1actions.zil:2323).
    this.entry.turnsLeft = stage.ticks;
    this.tableIndex++;
    return true;
  }
}

// LAMP-TABLE — mirrors the ZIL constant from 1actions.zil.
// Stage sequence (cumulative turns from lamp-on):
//   200 turns  — "The lamp appears a bit dimmer."   (re-queue 100)
//   300 turns  — "The lamp is definitely dimmer now." (re-queue 70)
//   370 turns  — "The lamp is nearly out."           (re-queue 15)
//   385 turns  — burnout (ticks: 0 fires immediately in same invocation)
const LAMP_TABLE: ReadonlyArray<FuelStage> = [
  { ticks: 100, message: 'The lamp appears a bit dimmer.' },
  { ticks:  70, message: 'The lamp is definitely dimmer now.' },
  { ticks:  15, message: 'The lamp is nearly out.' },
  { ticks:   0, message: '' },  // burnout sentinel
];

// Initial countdown before the first warning (from GO() in 1dungeon.zil).
const LAMP_INITIAL_TICKS = 200;

// LanternInterrupt — faithful TypeScript translation of I-LANTERN from
// 1actions.zil:4026.
export class LanternInterrupt extends FuelInterrupt {
  constructor(clock: Clock, emitter: EventEmitter, initialTicks = LAMP_INITIAL_TICKS) {
    super(clock, emitter, LAMP_TABLE, 'lantern-fuel', 'I-LANTERN', initialTicks);
  }
}

// CANDLE-TABLE — mirrors the ZIL constant from 1actions.zil.
// Stage sequence (turns of active burning):
//   40 turns  — "The candles grow shorter."                    (re-queue 20)
//   60 turns  — "The candles are becoming quite short."        (re-queue 10)
//   70 turns  — "The candles won't last long now."             (re-queue 5)
//   75 turns  — burnout (ticks: 0 fires immediately)
const CANDLE_TABLE: ReadonlyArray<FuelStage> = [
  { ticks: 20, message: 'The candles grow shorter.' },
  { ticks: 10, message: 'The candles are becoming quite short.' },
  { ticks:  5, message: "The candles won't last long now." },
  { ticks:  0, message: '' },  // burnout sentinel
];

const CANDLE_INITIAL_TICKS = 40;

// CandleInterrupt — faithful TypeScript translation of I-CANDLES from
// 1actions.zil.  Queued dormant at GO() (1dungeon.zil:2641 is <QUEUE> without
// <ENABLE>); CANDLES-FCN arms it on lighting and disables it on extinguish.
export class CandleInterrupt extends FuelInterrupt {
  constructor(clock: Clock, emitter: EventEmitter, initialTicks = CANDLE_INITIAL_TICKS) {
    super(clock, emitter, CANDLE_TABLE, 'candle-fuel', 'I-CANDLES', initialTicks);
  }
}
