import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      'src/support.test.ts',
      'src/fixtures.test.ts',
    ],
  },
});
