/**
 * Dev REPL — play the current engine build in the terminal, with a logged
 * transcript for reviewing friction points.
 *
 *   npm run play
 *
 * Not part of the shipped app (the web shell arrives in Phase 4). This is a
 * thin readline loop over the same Game the UI will drive. Every input and the
 * game's response are appended to playtest-logs/session-<timestamp>.log so we
 * can go over what felt off afterward.
 */
import { createInterface } from 'node:readline';
import { mkdirSync, appendFileSync } from 'node:fs';
import { createGame } from '../src/engine/bootstrap.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('playtest-logs', { recursive: true });
const logPath = `playtest-logs/session-${stamp}.log`;
// Synchronous appends: a dev REPL is low-volume, and this guarantees every
// line is on disk even if the process exits abruptly (Ctrl-C / piped stdin).
const record = (s: string) => appendFileSync(logPath, s + '\n');

const game = createGame();
const intro = game.start();
process.stdout.write(intro + '\n\n');
record(`=== playtest ${stamp} ===`);
record(intro);
record('');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
process.stdout.write(`[logging this session to ${logPath} — type 'quit' to exit]\n`);
rl.prompt();

rl.on('line', (line) => {
  const input = line.trim();
  if (input === 'quit' || input === 'q') {
    rl.close();
    return;
  }
  if (input.length > 0) {
    record(`> ${input}`);
    const { output } = game.turn(input);
    if (output) {
      process.stdout.write(output + '\n');
      record(output);
    }
    record('');
  }
  process.stdout.write('\n');
  rl.prompt();
});

rl.on('close', () => {
  record('=== end ===');
  process.stdout.write(`\nThanks for playing. Transcript saved to ${logPath}\n`);
  process.exit(0);
});
