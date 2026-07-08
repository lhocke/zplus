import { describe, it, expect } from 'vitest';
import { encodeSeedString, decodeSeedString, SEED_STRING_FORMAT_VERSION } from '../../src/logic/seed-string.js';

describe('seed-string codec', () => {
  it('round-trips: encode then decode recovers the exact seed and logicVersion', () => {
    const str = encodeSeedString(123456, 7);
    expect(str.startsWith('ZR1.')).toBe(true);
    const decoded = decodeSeedString(str, 7);
    expect(decoded).toEqual({ ok: true, payload: { formatVersion: SEED_STRING_FORMAT_VERSION, logicVersion: 7, seed: 123456 } });
  });

  it('refuses a logicVersion mismatch cleanly (never silently applies a stale graph)', () => {
    const str = encodeSeedString(1, 7);
    const decoded = decodeSeedString(str, 8);
    expect(decoded).toEqual({ ok: false, reason: 'logic-version-mismatch' });
  });

  it.each([
    ['empty string', ''],
    ['missing prefix', 'not-a-seed-string'],
    ['prefix with empty payload', 'ZR1.'],
    ['prefix with garbage base64', 'ZR1.!!!not-base64!!!'],
    ['valid base64 but not JSON', 'ZR1.' + Buffer.from('not json').toString('base64url')],
    ['valid JSON but wrong shape', 'ZR1.' + Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url')],
    ['truncated payload', encodeSeedStringForTest().slice(0, 8)],
  ])('adversarial decode: %s refuses cleanly, never throws', (_label, input) => {
    expect(() => decodeSeedString(input, 1)).not.toThrow();
    const result = decodeSeedString(input, 1);
    expect(result.ok).toBe(false);
  });

  it('a stray formatVersion bump in the payload refuses distinctly from a logicVersion mismatch', () => {
    const b64 = Buffer.from(JSON.stringify({ formatVersion: 99, logicVersion: 1, seed: 1 })).toString('base64url');
    expect(decodeSeedString('ZR1.' + b64, 1)).toEqual({ ok: false, reason: 'format-version-mismatch' });
  });
});

function encodeSeedStringForTest(): string {
  return encodeSeedString(42, 1);
}
