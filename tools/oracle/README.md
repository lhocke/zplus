# Oracle Harness — Zork I Faithfulness Comparator

Compares our TypeScript engine's output against the **original Zork I R119 binary** running under `dfrotz`, turn-by-turn.

## Prerequisites

- **dfrotz** (FROTZ V2.55) must be on `PATH`.
- The Zork I story file (`.z3` binary) ships in-repo at `tools/oracle/zork1.z3` — the MIT-licensed Microsoft 2025 release of the original ZIL source (see [CREDITS.md](../../CREDITS.md)). No setup required.

## Story file location

The harness resolves the story file from:

1. **`ZORK_STORY` environment variable** (highest priority — set it to use a copy kept elsewhere)
2. Default: the bundled `tools/oracle/zork1.z3` (resolved relative to the repo, never an absolute path)

```sh
# Override the path:
ZORK_STORY=/path/to/zork1.z3 npm run oracle
```

## Running the harness

```sh
# Run the default corpus (opening walkthrough):
npm run oracle

# Run a specific corpus file:
npm run oracle -- tools/oracle/corpus/my-sequence.txt
```

## Corpus file format

One command per line.  Blank lines and `#` comments are ignored.

```
# This is a comment
open mailbox
read leaflet
north
```

Corpus files live in `tools/oracle/corpus/`.  Add new `.txt` files there to test additional sequences.

## RNG caveat

**Deterministic content** (room descriptions, object interactions, fixed game-text) compares exactly and is valid for the harness.

**RNG-driven content** — combat outcomes, thief movements, random flavor messages — will **NOT** match turn-for-turn between dfrotz and our engine (different RNG implementations).  Do **not** add such sequences to corpus files intended for exact diffing.

## Normalizer details

Before comparison, both transcripts are normalized identically:

- dfrotz status-bar lines (room name + `Score: N  Moves: N`) are stripped
- Loading noise (`Using normal formatting.`, `Loading ...`) is stripped
- The intro/copyright banner is stripped from both sides
- Leading `> ` prompt echoes are removed
- Trailing whitespace is trimmed from each line
- Hard-wrapped lines (dfrotz uses 80-col wrapping; our engine does not) are rejoined into paragraphs before comparison

## File structure

```
tools/oracle/
  dfrotz-runner.ts     — runs dfrotz via spawnSync, captures raw transcript
  engine-runner.ts     — runs our createGame() engine, captures transcript
  normalizer.ts        — strips noise and normalizes both transcripts
  comparator.ts        — turn-by-turn diff + report formatting
  run-corpus.ts        — CLI entry point (npm run oracle)
  corpus/
    opening-walkthrough.txt   — seed corpus: first ~14 commands
  README.md            — this file

tests/oracle/
  harness.test.ts      — unit tests for the normalizer and comparator
```
