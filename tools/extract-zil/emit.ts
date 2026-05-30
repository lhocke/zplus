/**
 * Emit layer for the ZIL extractor.
 *
 * Takes the in-memory extracted data and writes four JSON files into
 * src/data/ plus the generated src/domain/ids.ts string-literal union.
 *
 * The entry point for the real extraction run is a standalone script that
 * calls extractObjects/extractSyntax/extractVocabulary from extract.ts then
 * delegates to emitData here.
 *
 * emitData is kept separate so tests can drive it with tiny in-memory fixtures
 * without touching the real src/ tree.
 *
 * A1 schema change: emitData now accepts SyntaxEntryRaw[] (the extractor's
 * intermediate format) and normalizes each entry to SyntaxEntryOut (the
 * port-native schema) before writing to syntax.json. The normalization:
 *   - renames preposition→prep1, preposition2→prep2
 *   - flattens directObject/indirectObject to dobjFindBit/dobjLocBits/iobjFindBit/iobjLocBits
 *   - converts where string arrays to integer bitmasks
 *   - adds explicit numObjects: 0|1|2
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ObjectData, SyntaxEntryRaw, VocabularyData } from './extract.js';
import { normalizeSyntaxEntry } from './syntax-normalize.js';
import type { SyntaxEntryOut } from './syntax-normalize.js';

// Re-export for callers that want a single import point.
// SyntaxEntry is re-exported as the port-native output type (SyntaxEntryOut).
export type { ObjectData, VocabularyData };
export type { SyntaxEntryOut as SyntaxEntry };
export type { SyntaxEntryRaw };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EmitDirs {
  /** Target directory for rooms.json, objects.json, syntax.json, vocabulary.json. */
  readonly dataDir: string;
  /** Target directory for ids.ts. */
  readonly domainDir: string;
}

/**
 * Write the four data JSON files and src/domain/ids.ts into the given
 * directories (both are created if they do not exist).
 *
 * @param objects   All extracted ObjectData records (rooms + non-rooms combined).
 * @param syntax    All extracted SyntaxEntryRaw records (normalized to port-native schema before writing).
 * @param vocab     Aggregated VocabularyData.
 * @param dirs      Output directories.
 */
export function emitData(
  objects: ObjectData[],
  syntax: SyntaxEntryRaw[],
  vocab: VocabularyData,
  dirs: EmitDirs,
): void {
  const { dataDir, domainDir } = dirs;

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(domainDir, { recursive: true });

  const rooms = objects.filter(o => o.kind === 'room');
  const nonRooms = objects.filter(o => o.kind !== 'room');

  // Normalize syntax entries to port-native schema before writing.
  const normalizedSyntax: SyntaxEntryOut[] = syntax.map(normalizeSyntaxEntry);

  writeFileSync(join(dataDir, 'rooms.json'), toJson(rooms));
  writeFileSync(join(dataDir, 'objects.json'), toJson(nonRooms));
  writeFileSync(join(dataDir, 'syntax.json'), toJson(normalizedSyntax));
  writeFileSync(join(dataDir, 'vocabulary.json'), toJson(vocab));
  writeFileSync(join(domainDir, 'ids.ts'), buildIdsModule(objects));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable, readable JSON serialisation. */
function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Build the ids.ts source — a TypeScript file that exports one type alias:
 *
 *   export type ObjectId =
 *     | 'WEST-OF-HOUSE'
 *     | 'NORTH-OF-HOUSE'
 *     | 'MAILBOX';
 *
 * One id per line keeps diffs readable when the dataset changes.
 */
function buildIdsModule(objects: ObjectData[]): string {
  if (objects.length === 0) {
    return 'export type ObjectId = never;\n';
  }

  const lines = objects.map(o => `  | '${o.id}'`).join('\n');
  return `export type ObjectId =\n${lines};\n`;
}
