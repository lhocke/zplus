import { describe, it, expect } from 'vitest';
import { THEMES, type ThemeName } from '../../src/ui/themes.js';

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

  it('all theme values are strings (no undefined slipping through)', () => {
    for (const name of names) {
      for (const [k, v] of Object.entries(THEMES[name])) {
        expect(typeof v, `${name}.${k} should be string`).toBe('string');
      }
    }
  });
});
