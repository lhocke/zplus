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
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ObjectData, SyntaxEntry, VocabularyData } from './extract.js';

// Re-export for callers that want a single import point
export type { ObjectData, SyntaxEntry, VocabularyData };

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
 * @param syntax    All extracted SyntaxEntry records.
 * @param vocab     Aggregated VocabularyData.
 * @param dirs      Output directories.
 */
export function emitData(
  objects: ObjectData[],
  syntax: SyntaxEntry[],
  vocab: VocabularyData,
  dirs: EmitDirs,
): void {
  const { dataDir, domainDir } = dirs;

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(domainDir, { recursive: true });

  const rooms = objects.filter(o => o.kind === 'room');
  const nonRooms = objects.filter(o => o.kind !== 'room');

  writeFileSync(join(dataDir, 'rooms.json'), toJson(rooms));
  writeFileSync(join(dataDir, 'objects.json'), toJson(nonRooms));
  writeFileSync(join(dataDir, 'syntax.json'), toJson(syntax));
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
