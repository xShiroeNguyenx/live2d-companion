import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    // Serves src/renderer/public/live2dcubismcore.js at /live2dcubismcore.js so
    // index.html can load the Core as a classic script before the bundle. The
    // file is copied from vendor/ by `npm run sync:core`.
    publicDir: resolve('src/renderer/public'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
        // The Cubism framework is vendored as TypeScript source so we can patch it
        // (see vendor/patches) and control the per-frame pipeline from the editor.
        '@framework': resolve('vendor/cubism-web-framework/src')
      }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
});
