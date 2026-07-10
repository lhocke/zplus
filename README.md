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

## Randomizer (Z+ desktop only)

Z+'s desktop build includes a full item randomizer: every progression item,
treasure, and piece of filler is reshuffled onto a logic graph derived from
the original puzzle dependencies, then placed with an assumed-fill algorithm
that guarantees the run is completable — no seed can lock you out of the
trophy case. The goal stays vanilla: recover the complete treasure set,
deposit it, and win the endgame.

Start one from the "New randomized run" panel next to the save slots (Z+
only — the web demo stays vanilla). Leave the seed field blank and hit
**Roll** for a fresh run, or paste in a seed string someone sent you and hit
**Start** — same string, same machine-independent placements, so two players
can race the identical layout head-to-head. Seed strings look like
`ZR1.<a run of base64 characters>` and encode both the seed and the logic
version they were rolled against; a string from an incompatible version is
refused with a clear message instead of silently producing a different
layout. Your current seed string stays visible in the status bar for the
whole run so you can always copy it back out.

A few things are deliberately different from vanilla in randomizer mode,
documented here so they don't read as bugs: the brass lantern is now your
main light source in every run (the torch is placement-constrained to
somewhere reachable early, since it can otherwise hide behind the very gates
it's needed to open), and seeded runs double the lamp's fuel budget to give
blind exploration room to breathe — burning out is still a real way to lose,
so budget your turns. The thief remains fully faithful — he'll still steal
from you and hide in his hoard — with two narrow exceptions scoped to
seeded runs only: he can't touch your torch, and if you kill him he drops
everything he's ever taken, so nothing a shuffled run needs is ever
permanently lost to him.

The tracker panel (desktop, shown only during a randomized run) gives you a
spoiler-free per-region checked/remaining count, a strip of progression
items you're currently holding, and a live read of turns of lamp light
left — it never tells you where anything you haven't found yet actually is.
A run's timer starts on your first typed command (reading the opening text
is free), keeps ticking through save/restore, and announces your final time
on completion.

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
