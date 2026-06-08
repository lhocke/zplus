import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

// In CI, VITE_BUILD_ID is set to github.sha (full SHA). Locally, fall back
// to the short git HEAD so the preflight's short-SHA check still passes.
const buildId = (() => {
  if (process.env.VITE_BUILD_ID) return process.env.VITE_BUILD_ID.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  root: '.',
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Never ship .map files — we deploy only dist/ via wrangler and don't
    // want the original TS source leaking into the public artifact.
    sourcemap: false,
  },
  define: {
    // Injected at build time from the local git HEAD so logged buildId
    // always traces back to the exact deployed commit.
    __BUILD_ID__: JSON.stringify(buildId),
  },
});
