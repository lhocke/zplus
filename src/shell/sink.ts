/**
 * PlaytestSink — the telemetry transport seam (§4).
 *
 * The session facade emits structured events; the sink decides where they go.
 * Gathered: tester input + game state only. No userAgent/IP/geo/cookies.
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface SessionStart {
  type: 'start';
  sessionId: string;
  buildId: string;
  ts: string;
}

export interface TurnEvent {
  type: 'turn';
  sessionId: string;
  buildId: string;
  turn: number;        // 1-based
  command: string;     // raw input
  output: string;      // engine output, verbatim
  score: number;
  moves: number;
  room: string;        // view().here (ObjectId)
  ts: string;          // ISO 8601
}

export interface SessionEnd {
  type: 'end';
  sessionId: string;
  ts: string;
  lastTurn: number;
}

export type PlaytestEvent = SessionStart | TurnEvent | SessionEnd;

// ---------------------------------------------------------------------------
// Sink interface
// ---------------------------------------------------------------------------

export interface PlaytestSink {
  emit(e: PlaytestEvent): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// nullSink — no-op; used in tests and headless runs
// ---------------------------------------------------------------------------

export const nullSink: PlaytestSink = {
  emit(_e) {},
  close() {},
};

// ---------------------------------------------------------------------------
// FileSink — human-readable flat-text format, appendFileSync per event
// ---------------------------------------------------------------------------

const DEFAULT_LOGS_DIR = 'playtest-logs';

// Status line format matches tools/play.ts: "[ room · score/max · moves ]"
function statusLine(room: string, score: number, maxScore: number, moves: number): string {
  return `        [ ${room} · score ${score}/${maxScore} · moves ${moves} ]`;
}

export class FileSink implements PlaytestSink {
  private readonly logPath: string;
  private closed = false;

  constructor(logsDir: string = DEFAULT_LOGS_DIR) {
    mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = join(logsDir, `session-${stamp}.log`);
  }

  emit(e: PlaytestEvent): void {
    if (this.closed) return;
    let text: string;

    if (e.type === 'start') {
      // Header written immediately so partial sessions have a timestamp.
      text = `=== playtest ${e.ts} ===\n`;
    } else if (e.type === 'turn') {
      // "> command\n<output>\n<status>\n\n"
      const status = statusLine(e.room, e.score, 350, e.moves);
      text = `> ${e.command}\n${e.output}\n${status}\n\n`;
    } else {
      // SessionEnd: write terminator and mark closed.
      appendFileSync(this.logPath, '=== end ===\n');
      this.closed = true;
      return;
    }

    appendFileSync(this.logPath, text);
  }

  close(): void {
    // With appendFileSync-per-event there's nothing to flush.
    // Mark closed so subsequent emits are silently dropped.
    this.closed = true;
  }
}
