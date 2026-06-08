/**
 * R2 key generation for playtest event objects.
 *
 * Key layout: sessions/<sessionId>/<seq>.json
 * seq is zero-padded to 5 digits so lexicographic sort == emission order.
 *   00000 = SessionStart
 *   00001–09998 = turns (1-based)
 *   99999 = SessionEnd (reserved high key, sorts last)
 */

export function seqKey(seq: number): string {
  return String(seq).padStart(5, '0');
}

export function r2Key(sessionId: string, seq: number): string {
  return `sessions/${sessionId}/${seqKey(seq)}.json`;
}
