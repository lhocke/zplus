import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const CONF_PATH = fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url));

describe('src-tauri/tauri.conf.json — Z+ identity', () => {
  it('sets productName to Z+', () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
    expect(conf.productName).toBe('Z+');
  });

  it('sets the reverse-DNS identifier', () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
    expect(conf.identifier).toBe('io.github.lhocke.zplus');
  });

  it('points frontendDist at the existing Vite build output', () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
    expect(conf.build.frontendDist).toBe('../dist');
  });

  it('wires build commands to the existing npm scripts', () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
    expect(conf.build.beforeDevCommand).toBe('npm run dev');
    expect(conf.build.beforeBuildCommand).toBe('npm run build');
  });

  it('requests ad-hoc codesigning on macOS (no ADP cert)', () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
    expect(conf.bundle.macOS.signingIdentity).toBe('-');
  });
});

describe('src-tauri/icons — generated icon set', () => {
  it('has every icon file the bundle.icon array references', () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
    for (const rel of conf.bundle.icon as string[]) {
      const p = join(dirname(CONF_PATH), rel);
      expect(existsSync(p), `missing icon file: ${rel}`).toBe(true);
    }
  });
});
