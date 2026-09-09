import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer'),
      // Tests import framework source directly, the same way the renderer bundle
      // does, so a parity test can compare against the real CubismMotion.
      '@framework': resolve('vendor/cubism-web-framework/src')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // The Cubism Core is an Emscripten bundle that expects browser globals, and
    // the framework's renderer touches WebGL types at module scope.
    environment: 'jsdom',
    setupFiles: ['tests/setup/cubism.ts']
  }
});
