import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));

// Last-updated = the git commit time of the data snapshot. A new location is a
// new commit to data/locations.csv, so this tracks data freshness exactly and
// needs no Notion round-trip. %cI is strict ISO 8601 with the committer's tz
// offset. Falls back to build time if git history isn't available (e.g. a
// non-git build context).
function dataUpdatedISO() {
  try {
    const iso = execSync('git log -1 --format=%cI -- data/locations.csv', {
      encoding: 'utf8',
    }).trim();
    if (iso) return iso;
  } catch {
    // fall through
  }
  return new Date().toISOString();
}

export default defineConfig({
  define: {
    __DATA_UPDATED__: JSON.stringify(dataUpdatedISO()),
  },
  build: {
    outDir: 'dist',
    // Keep a single JS chunk — deployment is a static site, no code-splitting needed.
    rollupOptions: {
      input: {
        main: resolve(ROOT_DIR, 'index.html'),
        changelog: resolve(ROOT_DIR, 'changelog.html'),
      },
      output: {
        manualChunks: undefined,
      },
    },
  },
});
