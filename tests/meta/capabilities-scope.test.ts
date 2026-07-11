// tests/meta/capabilities-scope.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPS_PATH = fileURLToPath(
  new URL('../../src-tauri/capabilities/default.json', import.meta.url),
);

function loadCaps(): { permissions: unknown[] } {
  return JSON.parse(readFileSync(CAPS_PATH, 'utf8'));
}

function findScope(permissions: unknown[], identifier: string): { allow?: unknown[] } | undefined {
  return permissions.find(
    (p): p is { identifier: string; allow?: unknown[] } =>
      typeof p === 'object' && p !== null && (p as { identifier?: string }).identifier === identifier,
  );
}

describe('src-tauri/capabilities/default.json — scoped tight', () => {
  it('scopes fs access to the app-data saves directory only', () => {
    const { permissions } = loadCaps();
    const scope = findScope(permissions, 'fs:scope');
    expect(scope).toBeDefined();
    // Both entries are load-bearing: the bare dir entry lets mkdir/readDir
    // target the saves directory itself (a /** glob matches contents only —
    // Tauri's own scope examples grant the dir and its contents separately),
    // and the glob covers the slot files inside.
    expect(scope!.allow).toEqual(['$APPDATA/saves', '$APPDATA/saves/**']);
  });

  it('scopes http fetch to api.github.com only', () => {
    const { permissions } = loadCaps();
    const scope = findScope(permissions, 'http:default');
    expect(scope).toBeDefined();
    expect(scope!.allow).toEqual([{ url: 'https://api.github.com/*' }]);
  });

  it('scopes opener to the project releases page only', () => {
    const { permissions } = loadCaps();
    const scope = findScope(permissions, 'opener:allow-open-url');
    expect(scope).toBeDefined();
    expect(scope!.allow).toEqual([{ url: 'https://github.com/lhocke/zplus/releases/*' }]);
  });

  it('grants the saves write permission alongside the scope, never an unscoped catch-all', () => {
    const { permissions } = loadCaps();
    const idents = permissions.map((p) =>
      typeof p === 'string' ? p : (p as { identifier?: string }).identifier,
    );
    expect(idents).toContain('fs:allow-write-text-file');
    expect(idents).toContain('fs:scope');
  });
});
