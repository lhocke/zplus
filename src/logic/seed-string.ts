// Bump when the wire payload shape changes (not the same as logicVersion,
// which tracks the WORLD MODEL's content — this tracks the ENCODING).
export const SEED_STRING_FORMAT_VERSION = 1;

export interface SeedPayload {
  formatVersion: number;
  logicVersion: number;
  seed: number;
}

export type DecodeResult =
  | { ok: true; payload: SeedPayload }
  | { ok: false; reason: 'malformed' | 'wrong-prefix' | 'format-version-mismatch' | 'logic-version-mismatch' };

const PREFIX = 'ZR1.';

function base64urlEncode(s: string): string {
  const b64 = Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function encodeSeedString(seed: number, logicVersion: number): string {
  const payload: SeedPayload = { formatVersion: SEED_STRING_FORMAT_VERSION, logicVersion, seed };
  return PREFIX + base64urlEncode(JSON.stringify(payload));
}

/**
 * Decode + validate a seed string against the CURRENTLY RUNNING logicVersion.
 * Never throws — every failure mode is a tagged reason so the caller can
 * emit the exact in-voice refusal text (Task 9 owns the wording).
 */
export function decodeSeedString(str: string, currentLogicVersion: number): DecodeResult {
  if (!str.startsWith(PREFIX)) return { ok: false, reason: 'wrong-prefix' };
  const b64 = str.slice(PREFIX.length);
  if (b64.length === 0) return { ok: false, reason: 'malformed' };

  let json: string;
  try {
    json = base64urlDecode(b64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof (parsed as Record<string, unknown>).formatVersion !== 'number' ||
    typeof (parsed as Record<string, unknown>).logicVersion !== 'number' ||
    typeof (parsed as Record<string, unknown>).seed !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const payload = parsed as SeedPayload;
  if (payload.formatVersion !== SEED_STRING_FORMAT_VERSION) return { ok: false, reason: 'format-version-mismatch' };
  if (payload.logicVersion !== currentLogicVersion) return { ok: false, reason: 'logic-version-mismatch' };

  return { ok: true, payload };
}
