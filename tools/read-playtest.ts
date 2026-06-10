/**
 * read-playtest.ts — read-only playtest log reader for the zork-playtest R2 bucket.
 *
 *   npm run playtest:read                  — list recent sessions
 *   npm run playtest:read <sessionId>      — full transcript
 *
 * Credentials from .dev.vars (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
 * or process.env. Never prints credential values.
 */

import { readFileSync, existsSync } from 'node:fs';
import { AwsClient } from 'aws4fetch';
import type { SessionStart, TurnEvent, SessionEnd } from '../src/shell/sink.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://8fab48de99b71e7802848d612c575809.r2.cloudflarestorage.com';
const BUCKET = 'zork-playtest';
const REGION = 'auto';

// ---------------------------------------------------------------------------
// Credential loading — .dev.vars first, then process.env
// ---------------------------------------------------------------------------

function loadDevVars(path = '.dev.vars'): Record<string, string> {
  if (!existsSync(path)) return {};
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .reduce<Record<string, string>>((acc, line) => {
      const idx = line.indexOf('=');
      acc[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      return acc;
    }, {});
}

function loadCreds(): { accessKeyId: string; secretAccessKey: string } | null {
  const vars = loadDevVars();
  const id = vars['R2_ACCESS_KEY_ID'] ?? process.env['R2_ACCESS_KEY_ID'];
  const secret = vars['R2_SECRET_ACCESS_KEY'] ?? process.env['R2_SECRET_ACCESS_KEY'];
  if (!id || !secret) return null;
  return { accessKeyId: id, secretAccessKey: secret };
}

// ---------------------------------------------------------------------------
// S3 XML extraction — no dep; response shape is fixed ListBucketResult
// ---------------------------------------------------------------------------

function extractTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

interface R2Object {
  key: string;
  lastModified: string;
}

function parseList(xml: string): { objects: R2Object[]; truncated: boolean; nextToken: string | null } {
  // One <Contents> block per object, each carrying <Key> + <LastModified>.
  const objects = extractTags(xml, 'Contents').map((block) => ({
    key: extractTags(block, 'Key')[0] ?? '',
    lastModified: extractTags(block, 'LastModified')[0] ?? '',
  }));
  const truncated = extractTags(xml, 'IsTruncated')[0]?.toLowerCase() === 'true';
  const nextToken = extractTags(xml, 'NextContinuationToken')[0] ?? null;
  return { objects, truncated, nextToken };
}

// ---------------------------------------------------------------------------
// R2 helpers
// ---------------------------------------------------------------------------

function makeClient(creds: { accessKeyId: string; secretAccessKey: string }): AwsClient {
  return new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    region: REGION,
    service: 's3',
  });
}

async function listObjects(aws: AwsClient, prefix: string): Promise<R2Object[]> {
  const all: R2Object[] = [];
  let token: string | null = null;

  do {
    const url = new URL(`/${BUCKET}`, ENDPOINT);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);

    const res = await aws.fetch(url.toString());
    if (!res.ok) throw new Error(`ListObjects ${res.status}: ${await res.text()}`);
    const { objects, truncated, nextToken } = parseList(await res.text());
    all.push(...objects);
    token = truncated ? nextToken : null;
  } while (token);

  return all;
}

async function listKeys(aws: AwsClient, prefix: string): Promise<string[]> {
  return (await listObjects(aws, prefix)).map((o) => o.key);
}

async function getObject<T>(aws: AwsClient, key: string): Promise<T> {
  const url = `${ENDPOINT}/${BUCKET}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
  const res = await aws.fetch(url);
  if (!res.ok) throw new Error(`GetObject ${key}: ${res.status}`);
  return JSON.parse(await res.text()) as T;
}

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

interface SessionSummary {
  sessionId: string;
  buildId: string;
  startTs: string;
  turnCount: number;
  score: number;
  maxScore: number;
  room: string;
}

async function listSessions(aws: AwsClient): Promise<void> {
  const objects = await listObjects(aws, 'sessions/');
  if (objects.length === 0) {
    console.log('No sessions found in bucket.');
    return;
  }

  // Group by sessionId, tracking each session's most-recent object timestamp.
  // sessionId is a random UUID (session.ts), so key order isn't recency —
  // LastModified from the list response is.
  const bySession: Record<string, { keys: string[]; latest: string }> = {};
  for (const { key, lastModified } of objects) {
    const parts = key.split('/'); // sessions/<id>/<seq>.json
    if (parts.length !== 3) continue;
    const id = parts[1];
    const s = (bySession[id] ??= { keys: [], latest: '' });
    s.keys.push(key);
    if (lastModified > s.latest) s.latest = lastModified;
  }

  const total = Object.keys(bySession).length;
  const cap = 25;
  const toLoad = Object.entries(bySession)
    .sort(([, a], [, b]) => b.latest.localeCompare(a.latest))
    .slice(0, cap)
    .map(([id]) => id);

  const summaries: SessionSummary[] = [];

  await Promise.all(
    toLoad.map(async (id) => {
      const sessionKeys = bySession[id].keys.sort();
      const startKey = sessionKeys.find((k) => k.endsWith('/00000.json'));
      if (!startKey) return;

      const start = await getObject<SessionStart>(aws, startKey);

      // Find latest turn key (not 00000 or 99999)
      const turnKeys = sessionKeys.filter((k) => {
        const seq = k.split('/')[2]?.replace('.json', '');
        return seq && seq !== '00000' && seq !== '99999';
      });
      const latestTurnKey = turnKeys.sort().at(-1);

      let score = start.score;
      let maxScore = start.maxScore;
      let room = start.hereName;

      if (latestTurnKey) {
        const turn = await getObject<TurnEvent>(aws, latestTurnKey);
        score = turn.score;
        maxScore = turn.maxScore;
        room = turn.hereName;
      }

      // Count turns (exclude 00000 start and 99999 end)
      const turnCount = turnKeys.length;

      summaries.push({
        sessionId: id,
        buildId: start.buildId,
        startTs: start.ts,
        turnCount,
        score,
        maxScore,
        room,
      });
    }),
  );

  summaries.sort((a, b) => b.startTs.localeCompare(a.startTs));

  if (total > cap) console.log(`Showing latest ${cap} of ${total} sessions.\n`);

  // Header
  const idWidth = Math.max(9, Math.max(...summaries.map((s) => s.sessionId.length)));
  console.log(
    `${'SESSION ID'.padEnd(idWidth)}  STARTED              BUILD         TURNS  SCORE  ROOM`,
  );
  console.log('─'.repeat(idWidth + 55));

  for (const s of summaries) {
    const ts = new Date(s.startTs).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const score = `${s.score}/${s.maxScore}`;
    console.log(
      `${s.sessionId.padEnd(idWidth)}  ${ts.padEnd(20)} ${s.buildId.slice(0, 12).padEnd(14)}${String(s.turnCount).padStart(4)}   ${score.padEnd(7)}${s.room}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Full transcript
// ---------------------------------------------------------------------------

function trimTrailingBlanks(s: string): string {
  return s.replace(/\n+$/, '');
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

async function showTranscript(aws: AwsClient, sessionId: string): Promise<void> {
  const keys = (await listKeys(aws, `sessions/${sessionId}/`)).sort();
  if (keys.length === 0) {
    console.log(`No data found for session "${sessionId}".`);
    return;
  }

  const events = await Promise.all(
    keys.map((k) => getObject<SessionStart | TurnEvent | SessionEnd>(aws, k)),
  );

  const start = events.find((e): e is SessionStart => e.type === 'start');
  if (!start) {
    console.log('SessionStart object (00000.json) missing — partial data only.');
    return;
  }

  const startDate = new Date(start.ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  console.log(`\n=== session ${start.sessionId}  build ${start.buildId}  started ${startDate} ===\n`);
  console.log(trimTrailingBlanks(start.output));
  console.log(`${DIM}        [ ${start.hereName} · score ${start.score}/${start.maxScore} · moves ${start.moves} ]${RESET}\n`);

  const turns = events
    .filter((e): e is TurnEvent => e.type === 'turn')
    .sort((a, b) => a.turn - b.turn);

  for (const t of turns) {
    console.log(`> ${t.command}`);
    console.log(trimTrailingBlanks(t.output));
    console.log(`${DIM}        [turn ${t.turn} · score ${t.score}/${t.maxScore} · moves ${t.moves} · ${t.hereName}]${RESET}\n`);
  }

  const end = events.find((e): e is SessionEnd => e.type === 'end');
  if (end) console.log(`${DIM}— session ended, last turn ${end.lastTurn} —${RESET}\n`);
}

// ---------------------------------------------------------------------------
// Missing-creds check (testable without live R2)
// ---------------------------------------------------------------------------

function credError(): void {
  console.error(
    'Missing R2 credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .dev.vars:\n\n' +
    '  R2_ACCESS_KEY_ID=<your-access-key-id>\n' +
    '  R2_SECRET_ACCESS_KEY=<your-secret-access-key>\n\n' +
    '.dev.vars lives at the repo root and is gitignored.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// XML extractor smoke-test (runs inline, exits cleanly if ok)
// ---------------------------------------------------------------------------

function selfTestXml(): void {
  const sample = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>sessions/abc/00000.json</Key><LastModified>2026-06-08T01:00:00.000Z</LastModified></Contents>
  <Contents><Key>sessions/abc/00001.json</Key><LastModified>2026-06-08T01:00:05.000Z</LastModified></Contents>
</ListBucketResult>`;
  const { objects, truncated } = parseList(sample);
  if (objects.length !== 2 || truncated || objects[1].lastModified !== '2026-06-08T01:00:05.000Z')
    throw new Error(`XML extractor self-test failed: objects=${objects.length} truncated=${truncated}`);
}

selfTestXml(); // runs every invocation; cheap, no I/O

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const creds = loadCreds();
  if (!creds) { credError(); return; }

  const aws = makeClient(creds);
  const arg = process.argv[2];

  if (arg) {
    await showTranscript(aws, arg);
  } else {
    await listSessions(aws);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
