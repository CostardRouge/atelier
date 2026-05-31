import { defineConfig } from 'vitest/config';

// Tests cover the pure library only (parser + cue search), which runs in a
// plain node environment — no React plugin or jsdom needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
