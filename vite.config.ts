import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

const buildId = (() => {
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
