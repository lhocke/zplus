import type { EventEmitter } from './events.js';

// ---------------------------------------------------------------------------
// ClockTickContext — passed into tick() on every fire so interrupt routines
// can push transcript text back into the current turn's output.
//
// Two channels, two concerns:
//   tell()  — transcript text (human-readable warning lines).
//   events  — state mutation (flags / HUD via EventEmitter).
// The two must NOT be conflated: event handlers must not re-render
// event.message to screen or warnings will double.
// ---------------------------------------------------------------------------

export interface ClockTickContext {
  /** Push a non-empty string into the advance() return buffer. */
  tell(text: string): void;
}

// ---------------------------------------------------------------------------
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
// ---------------------------------------------------------------------------

export interface ClockEntry {
  id: string;
  turnsLeft: number;
  enabled: boolean;
  tick(ctx: ClockTickContext): boolean;
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

  /**
   * Called once per player turn, after the command executes.
   *
   * Returns any transcript text pushed by interrupt tick() callbacks via
   * ctx.tell().  Callers that ignore the return value are unaffected.
   *
   * Three regimes keyed on the SIGN of turnsLeft (the ZIL tick==-1 convention):
   *   turnsLeft === 0  → DORMANT: skip entirely (ZIL parked slot).
   *   turnsLeft < 0    → DEMON: fire every advance(), never decrement.
   *                      tick() returning false self-removes permanently.
   *   turnsLeft > 0    → COUNTDOWN: decrement then fire at zero (unchanged).
   */
  advance(): string[] {
    const lines: string[] = [];
    const ctx: ClockTickContext = { tell: (t) => { if (t) lines.push(t); } };
    const toRemove: string[] = [];

    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if (entry.turnsLeft === 0) continue;  // dormant: parked slot (ZIL behaviour)

      if (entry.turnsLeft < 0) {
        // DEMON: fire every turn, never decrement turnsLeft (stays pinned).
        // tick() returning false self-removes permanently.
        const keep = entry.tick(ctx);
        if (!keep) toRemove.push(entry.id);
        continue;  // never decrement a demon
      }

      // COUNTDOWN: decrement then fire when turnsLeft reaches zero.
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
      tick(ctx): boolean {
        return self.onFire(ctx);
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

  private onFire(ctx: ClockTickContext): boolean {
    const stage = LAMP_TABLE[this.tableIndex]!;

    // Emit the warning for the stage that just triggered.
    // EVENT CHANNEL: state mutation (flags / HUD) — preserve this as-is.
    const remaining = this.remainingTurns() - stage.ticks;
    this.emitter.emit({
      type: 'lantern-fuel',
      remaining,
      message: stage.message || undefined,
      dark: false,
    });

    // TRANSCRIPT CHANNEL: push warning text into the turn output.
    // Two channels, two concerns — events handle state; ctx.tell handles text.
    if (stage.message) {
      ctx.tell(stage.message);
    }

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

// ---------------------------------------------------------------------------
// CANDLE-TABLE — mirrors the ZIL constant from 1actions.zil.
//
// GO() queues I-CANDLES with an initial 40-turn countdown (the "full burn"
// period before warnings begin).  Each subsequent fire advances through the
// table entries until burnout.
//
// Stage sequence (turns of active burning):
//   40 turns  — "The candles grow shorter."                    (re-queue 20)
//   60 turns  — "The candles are becoming quite short."        (re-queue 10)
//   70 turns  — "The candles won't last long now."             (re-queue 5)
//   75 turns  — burnout (ticks: 0 sentinel fires immediately)
// ---------------------------------------------------------------------------

const CANDLE_TABLE: ReadonlyArray<{ ticks: number; message: string }> = [
  { ticks: 20, message: 'The candles grow shorter.' },
  { ticks: 10, message: 'The candles are becoming quite short.' },
  { ticks:  5, message: "The candles won't last long now." },
  { ticks:  0, message: '' },  // burnout sentinel
];

const CANDLE_INITIAL_TICKS = 40;

// ---------------------------------------------------------------------------
// CandleInterrupt — faithful TypeScript translation of I-CANDLES from
// 1actions.zil.
//
// Mirrors LanternInterrupt: each fire emits a candle-fuel event and advances
// the CANDLE_TABLE index.  The burnout sentinel (ticks: 0) triggers a final
// candle-fuel event with dark:true in the same invocation.
//
// Starts disabled; the CANDLES-FCN handler enables it when candles are lit
// and disables it when extinguished or blown out.
// ---------------------------------------------------------------------------

export class CandleInterrupt {
  private tableIndex = 0;
  private readonly entry: ClockEntry;

  constructor(
    private readonly clock: Clock,
    private readonly emitter: EventEmitter,
    initialTicks = CANDLE_INITIAL_TICKS,
  ) {
    const self = this;
    this.entry = {
      id: 'I-CANDLES',
      turnsLeft: initialTicks,
      enabled: true,
      tick(ctx): boolean {
        return self.onFire(ctx);
      },
    };
    clock.schedule(this.entry);
  }

  disable(): void {
    this.clock.disable('I-CANDLES');
  }

  enable(): void {
    this.clock.enable('I-CANDLES');
  }

  private remainingTurns(): number {
    return CANDLE_TABLE.slice(this.tableIndex).reduce((acc, s) => acc + s.ticks, 0);
  }

  private onFire(ctx: ClockTickContext): boolean {
    const stage = CANDLE_TABLE[this.tableIndex]!;

    // Emit the warning for this stage.
    // EVENT CHANNEL: state mutation (flags / HUD) — preserve this as-is.
    const remaining = this.remainingTurns() - stage.ticks;
    this.emitter.emit({
      type: 'candle-fuel',
      remaining,
      message: stage.message || undefined,
      dark: false,
    });

    // TRANSCRIPT CHANNEL: push warning text into the turn output.
    if (stage.message) {
      ctx.tell(stage.message);
    }

    // Advance to the next stage.
    this.tableIndex++;
    const next = CANDLE_TABLE[this.tableIndex];

    if (!next || next.ticks === 0) {
      // Burnout: mirrors ZIL LIGHT-INT with tick=0, firing in the same turn.
      this.emitter.emit({ type: 'candle-fuel', remaining: 0, dark: true });
      return false; // remove from clock
    }

    this.entry.turnsLeft = next.ticks;
    return true;
  }
}
