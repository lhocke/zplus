import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, isThemeName, type ThemeName } from '../../src/ui/themes.js';

describe('theme tokens', () => {
  const names: ThemeName[] = ['crt', 'literary', 'parchment'];

  it('exports all three themes', () => {
    for (const name of names) {
      expect(THEMES[name], `missing theme: ${name}`).toBeDefined();
    }
  });

  it('each theme defines the four required CSS custom property keys', () => {
    const required = ['fg', 'bg', 'accent', 'font'] as const;
    for (const name of names) {
      for (const key of required) {
        expect(
          THEMES[name][key],
          `${name}.${key} must be a non-empty string`,
        ).toBeTruthy();
      }
    }
  });

  it('crt is the default theme', () => {
    // The default is used when localStorage has nothing or an unknown value.
    expect(THEMES.crt).toBeDefined();
  });

  it('DEFAULT_THEME is crt', () => {
    expect(DEFAULT_THEME).toBe('crt');
  });

  it('all theme values are strings (no undefined slipping through)', () => {
    for (const name of names) {
      for (const [k, v] of Object.entries(THEMES[name])) {
        expect(typeof v, `${name}.${k} should be string`).toBe('string');
      }
    }
  });
});

describe('isThemeName — theme init fallback (§3)', () => {
  it('accepts valid theme names', () => {
    expect(isThemeName('crt')).toBe(true);
    expect(isThemeName('literary')).toBe(true);
    expect(isThemeName('parchment')).toBe(true);
  });

  it('rejects null (missing localStorage value)', () => {
    // localStorage.getItem returns null when the key is absent.
    expect(isThemeName(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isThemeName(undefined)).toBe(false);
  });

  it('rejects empty string (corrupt/cleared value)', () => {
    expect(isThemeName('')).toBe(false);
  });

  it('rejects an unknown string (corrupt value)', () => {
    expect(isThemeName('dark')).toBe(false);
    expect(isThemeName('INVALID')).toBe(false);
    expect(isThemeName('CRT')).toBe(false); // case-sensitive
  });

  it('rejects non-string types without crashing', () => {
    expect(isThemeName(42)).toBe(false);
    expect(isThemeName({})).toBe(false);
    expect(isThemeName([])).toBe(false);
  });

  it('DEFAULT_THEME passes isThemeName — so the fallback is itself valid', () => {
    expect(isThemeName(DEFAULT_THEME)).toBe(true);
  });
});
