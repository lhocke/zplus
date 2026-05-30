import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Engine/domain tests are pure Node; UI tests opt into jsdom via
    // a `// @vitest-environment jsdom` pragma at the top of the file.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
