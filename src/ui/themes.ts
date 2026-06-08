// Three playtest themes. Each maps to a set of CSS custom properties
// applied via [data-theme="<name>"] on <html>. The keys correspond to
// --zork-fg, --zork-bg, --zork-accent, --zork-font in the stylesheet.

export type ThemeName = 'crt' | 'literary' | 'parchment';

export interface ThemeTokens {
  fg: string;
  bg: string;
  accent: string;
  font: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  // Green phosphor terminal
  crt: {
    fg: '#33ff33',
    bg: '#0a0a0a',
    accent: '#66ff66',
    font: "'Courier New', Courier, monospace",
  },
  // Soft off-white page, serif body
  literary: {
    fg: '#1a1a2e',
    bg: '#f5f0e8',
    accent: '#2c4a7c',
    font: "'Georgia', 'Times New Roman', serif",
  },
  // Aged parchment, warmer palette
  parchment: {
    fg: '#3b2a1a',
    bg: '#e8dcc8',
    accent: '#7a4a1e',
    font: "'Palatino Linotype', Palatino, 'Book Antiqua', serif",
  },
};

export const DEFAULT_THEME: ThemeName = 'crt';

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'crt' || value === 'literary' || value === 'parchment';
}
