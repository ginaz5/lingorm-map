import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Keep a single JS chunk — deployment is a static site, no code-splitting needed.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
