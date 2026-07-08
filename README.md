# Z+ — a faithful Zork I adaptation, extended

A TypeScript reimplementation of the original Zork I, driven by data extracted
from the published ZIL source. It aims to reproduce the original game's rooms,
objects, puzzles, and parser behavior rather than approximate them.

**Try the web demo:** https://zork-3w8.pages.dev
**Get the full desktop app:** see [Install](#install) below.

## Features

- The complete original game, from the White House through the endgame
- Live auto-mapping of all 110 rooms as you explore
- Save/restore with multiple slots — durable on-disk saves in the desktop app,
  plus export/import to files you choose
- A few CRT-style display themes
- A faithful parser built from the original grammar and vocabulary tables
- Desktop app checks for new releases and points you at the download page

## Install

Download the build for your OS from the
[releases page](https://github.com/lhocke/zork-workflow/releases) — `.dmg`
(macOS), `.msi` (Windows), `.AppImage` or `.deb` (Linux).

Z+ is unsigned, so your OS will warn on first launch — expected for an
independently-built app without a paid developer certificate:

- **macOS:** double-click once (Gatekeeper blocks it), then **System
  Settings → Privacy & Security → Open Anyway** and confirm. The old
  right-click-Open shortcut no longer offers the override on macOS 15+.
- **Windows:** SmartScreen says "Windows protected your PC" — click
  **More info**, then **Run anyway**.
- **Linux (AppImage):** `chmod +x Z+*.AppImage` and run it; no install step.
- **Linux (.deb):** `sudo apt install ./z-plus_*.deb`.

Saves live in your OS's app-data directory, with the same 3 manual slots +
1 death-autosave as the web demo, and can be exported to / imported from
ordinary files via the Saves panel.

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
