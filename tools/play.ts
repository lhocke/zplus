/**
 * Dev REPL — play the current engine build in the terminal, with a logged
 * transcript for reviewing friction points.
 *
 *   npm run play
 *
 * A thin readline loop over the GameSession facade. Every input and the
 * game's response are appended to playtest-logs/session-<timestamp>.log so we
 * can go over what felt off afterward.
 */
import { createInterface } from 'node:readline';
import { createSession } from '../src/shell/session.js';
import { FileSink } from '../src/shell/sink.js';

const sink = new FileSink();
const session = createSession({ sink });

// Status line: score/moves are otherwise invisible in a bare REPL, which
// makes treasure and scoring playtests impossible to follow.
const status = () => {
  const v = session.snapshot();
  return `        [ ${v.hereName} · score ${v.score}/${v.maxScore} · moves ${v.moves} ]`;
};

const intro = session.start();
process.stdout.write(intro + '\n');
process.stdout.write(status() + '\n\n');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
process.stdout.write(`[logging this session to playtest-logs/ — type 'quit' to exit]\n`);
rl.prompt();

rl.on('line', (line) => {
  const input = line.trim();
  if (input === 'quit' || input === 'q') {
    rl.close();
    return;
  }
  if (input.length > 0) {
    const output = session.submit(input);
    if (output) {
      process.stdout.write(output + '\n');
    }
    process.stdout.write(status() + '\n');
  }
  process.stdout.write('\n');
  rl.prompt();
});

rl.on('close', () => {
  session.close();
  process.stdout.write(`\nThanks for playing.\n`);
  process.exit(0);
});
