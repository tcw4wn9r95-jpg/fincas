import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.ts so the PWA build plugins never load under
// test. The suite covers src/lib only: that is where the money is worked out.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
