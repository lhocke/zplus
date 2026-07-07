import { describe, it, expect } from 'vitest';
import { executeVerb } from '../../src/engine/verbs/index.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import { vVersion } from '../../src/engine/game-messages.js';

// ACTION_HANDLERS is module-private; dispatch through executeVerb with the
// action id, the same path game.turn takes. verbVersion reads nothing off
// the context, so a minimal stub suffices.
const ctx = { verb: 'version' } as unknown as VerbContext;

describe('V-VERSION — attribution line (Z+ native shell spec, component 7)', () => {
  it('the byte-exact ZIL banner is unchanged and comes first', async () => {
    const r = await executeVerb(ctx, 'V-VERSION');
    expect(r.output.startsWith(vVersion.banner)).toBe(true);
  });

  it('appends exactly one attribution line pointing at About & Credits', async () => {
    const r = await executeVerb(ctx, 'V-VERSION');
    const rest = r.output.slice(vVersion.banner.length);
    expect(rest).toBe('\nThird-party notices: see About & Credits.');
  });
});
