# Zork I — a faithful web adaptation

A TypeScript reimplementation of the original Zork I, driven by data extracted
from the published ZIL source. It aims to reproduce the original game's rooms,
objects, puzzles, and parser behavior rather than approximate them.

**Play:** https://zork-3w8.pages.dev

## Features

- The complete original game, from the White House through the endgame
- Live auto-mapping of all 110 rooms as you explore
- Save/restore with multiple slots
- A few CRT-style display themes
- A faithful parser built from the original grammar and vocabulary tables

## Development

```sh
npm ci
npm run dev      # local dev server
npm test         # run the test suite
npm run build    # type-check and build for production
```

The test suite runs roughly 3,900 tests anchored against the original game's
behavior, including walkthroughs and puzzle-by-puzzle checks.

## License

This codebase is MIT licensed — see [LICENSE](LICENSE).

The game's text, vocabulary, and world data are extracted from the Zork I
source released under the MIT License by Microsoft — see
[zil/LICENSE](zil/LICENSE).
