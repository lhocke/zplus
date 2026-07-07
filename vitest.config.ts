import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Engine/domain tests are pure Node; UI tests opt into jsdom via
    // a `// @vitest-environment jsdom` pragma at the top of the file.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    // vm.SourceTextModule (used by the dev-serve parse guard) is behind a
    // Node flag; forks is vitest's default pool. Vitest 4 removed
    // `poolOptions` in favor of top-level pool options (pool rework), so
    // execArgv is set directly here rather than under poolOptions.forks.
    execArgv: ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning'],
  },
});
