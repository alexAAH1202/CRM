import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Rules tests share one emulator; run files sequentially to avoid clearFirestore races.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
