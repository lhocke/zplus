import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZIL_LICENSE = fileURLToPath(new URL('../../zil/LICENSE', import.meta.url));
const NOTICE = fileURLToPath(new URL('../../src-tauri/resources/THIRD-PARTY-NOTICES.txt', import.meta.url));

describe('src-tauri/resources/THIRD-PARTY-NOTICES.txt', () => {
  it('contains the exact zil/LICENSE text verbatim', () => {
    const licenseText = readFileSync(ZIL_LICENSE, 'utf8').trim();
    const noticeText = readFileSync(NOTICE, 'utf8');
    expect(noticeText).toContain(licenseText);
  });

  it('names the original ZIL source provenance (drift guard against a bare license dump)', () => {
    const noticeText = readFileSync(NOTICE, 'utf8');
    expect(noticeText).toMatch(/historicalsource\/zork1/);
  });
});
