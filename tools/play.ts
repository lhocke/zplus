/**
 * Dev REPL — play the current engine build in the terminal.
 *
 *   npm run play
 *
 * Not part of the shipped app (the web shell arrives in Phase 4). This is a
 * thin readline loop over the same Game the UI will drive, useful for
 * spot-checking faithfulness by hand.
 */
import { createInterface } from 'node:readline';
import { createGame } from '../src/engine/bootstrap.js';

const game = createGame();
process.stdout.write(game.start() + '\n\n');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();

rl.on('line', (line) => {
  const input = line.trim();
  if (input === 'quit' || input === 'q') {
    rl.close();
    return;
  }
  if (input.length > 0) {
    const { output } = game.turn(input);
    if (output) process.stdout.write(output + '\n');
  }
  process.stdout.write('\n');
  rl.prompt();
});

rl.on('close', () => {
  process.stdout.write('\nThanks for playing.\n');
  process.exit(0);
});
