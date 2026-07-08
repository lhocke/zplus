// tools/spoiler.ts
//
// Dev-facing spoiler CLI. NOT bundled into the app. Usage:
//   npx tsx tools/spoiler.ts ZR1.<payload>
//   npx tsx tools/spoiler.ts --seed 42          (encodes+prints the seed string too)

import graphData from '../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../src/logic/logic-graph-types.js';
import { fillWithRetry } from '../src/logic/fill.js';
import { encodeSeedString, decodeSeedString } from '../src/logic/seed-string.js';

const graph = graphData as LogicGraph;

export function runSpoiler(args: string[]): string {
  const lines: string[] = [];
  let seed: number;
  let seedString: string;

  if (args[0] === '--seed') {
    seed = Number(args[1]);
    if (!Number.isFinite(seed)) return 'usage: tools/spoiler.ts --seed <number> | tools/spoiler.ts <ZR1.seed-string>';
    seedString = encodeSeedString(seed, graph.logicVersion);
    lines.push(`Seed string: ${seedString}`);
  } else {
    seedString = args[0] ?? '';
    const decoded = decodeSeedString(seedString, graph.logicVersion);
    if (!decoded.ok) return `Failed to decode seed string: ${decoded.reason}`;
    seed = decoded.payload.seed;
  }

  const result = fillWithRetry(graph, seed);
  const itemById = new Map(graph.items.map(i => [i.id, i]));
  const locById = new Map(graph.locations.map(l => [l.id, l]));

  lines.push(`Seed: ${seed}  logicVersion: ${graph.logicVersion}`);
  lines.push('');
  lines.push('=== Placements (by location) ===');
  for (const loc of [...graph.locations].sort((a, b) => a.id.localeCompare(b.id))) {
    const itemId = result.placements[loc.id];
    const cls = itemById.get(itemId)?.class ?? '?';
    lines.push(`  ${loc.id.padEnd(24)} <- ${itemId.padEnd(20)} [${cls}]  (region: ${loc.region})`);
  }
  lines.push('');
  lines.push('=== Sphere-by-sphere progression order ===');
  result.spheres.forEach((itemId, i) => {
    const placedAt = Object.entries(result.placements).find(([, v]) => v === itemId)?.[0];
    lines.push(`  ${i + 1}. ${itemId} -> ${placedAt ?? '?'} (${locById.get(placedAt ?? '')?.region ?? '?'})`);
  });

  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(runSpoiler(process.argv.slice(2)));
}
