/**
 * Deploy preflight — run before `wrangler pages deploy dist`.
 *
 * Asserts that dist/ is build-output-only:
 *   - no source maps (.map files)
 *   - no TypeScript sources (.ts files)
 *   - no ops/docs artifacts (.md, .claude/, docs/, .remember/, hidden dirs)
 *   - __BUILD_ID__ baked into the built JS (not the literal placeholder)
 *
 * Exits 0 on pass, 1 on fail. Intended to catch "accidentally shipped source"
 * before the artifact leaves the machine.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIST = new URL('../dist', import.meta.url).pathname;

// ── Collect all files in dist/ recursively ────────────────────────────────

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

let files: string[];
try {
  files = walk(DIST);
} catch {
  console.error('FAIL dist/ not found — run `npx vite build` first.');
  process.exit(1);
}

const rel = (p: string) => p.slice(DIST.length + 1);

// ── Check rules ───────────────────────────────────────────────────────────

const failures: string[] = [];

// No source maps.
const maps = files.filter(f => extname(f) === '.map');
for (const f of maps) failures.push(`source map present: ${rel(f)}`);

// No TypeScript sources.
const sources = files.filter(f => extname(f) === '.ts' || extname(f) === '.tsx');
for (const f of sources) failures.push(`TypeScript source present: ${rel(f)}`);

// No Markdown.
const markdown = files.filter(f => extname(f) === '.md');
for (const f of markdown) failures.push(`Markdown present: ${rel(f)}`);

// No hidden/ops dirs (.claude, .remember, docs in root of dist).
const opsPaths = files.filter(f => {
  const relative = rel(f);
  return (
    relative.startsWith('.claude/') ||
    relative.startsWith('.remember/') ||
    relative.startsWith('docs/') ||
    // any hidden file at the top level
    basename(relative).startsWith('.')
  );
});
for (const f of opsPaths) failures.push(`ops/hidden artifact present: ${rel(f)}`);

// __BUILD_ID__ survived the build — check that the literal placeholder is
// gone and a real short-SHA (7+ hex chars) is present.
const jsFiles = files.filter(f => extname(f) === '.js');
let buildIdFound = false;
let literalPlaceholder = false;
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  if (src.includes('__BUILD_ID__')) {
    literalPlaceholder = true;
  }
  // A real build ID looks like a quoted 7-char hex string.
  if (/(?<![A-Z_])"[0-9a-f]{7,}"/.test(src)) {
    buildIdFound = true;
  }
}
if (literalPlaceholder) failures.push('__BUILD_ID__ placeholder not substituted — define block missing?');
if (!buildIdFound) failures.push('no build ID (short SHA) found in built JS');

// Also cross-check that the built ID matches HEAD (catch stale dist/).
if (!literalPlaceholder && buildIdFound) {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const allJs = jsFiles.map(f => readFileSync(f, 'utf8')).join('');
    if (!allJs.includes(`"${head}"`)) {
      failures.push(`build ID in dist/ does not match HEAD (${head}) — rebuild with \`npx vite build\``);
    }
  } catch {
    // git not available — skip HEAD check
  }
}

// ── Report ────────────────────────────────────────────────────────────────

if (failures.length === 0) {
  const fileCount = files.length;
  console.log(`preflight OK — ${fileCount} files in dist/, no forbidden artifacts, build ID present`);
  process.exit(0);
} else {
  console.error('preflight FAILED:');
  for (const msg of failures) console.error(`  ✗ ${msg}`);
  process.exit(1);
}
