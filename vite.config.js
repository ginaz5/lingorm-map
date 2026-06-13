import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

// Hash ADMIN_PASSWORD at build time so the plaintext never reaches the bundle.
// The browser's verifyAdminPassword() uses SubtleCrypto SHA-256 on the typed
// password and compares it to this hash — same algorithm, same result.
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminHash = adminPassword
  ? createHash('sha256').update(adminPassword).digest('hex')
  : '';

export default defineConfig({
  // Replace the bare identifier __ADMIN_HASH__ in source with the quoted hash.
  // In dev (no ADMIN_PASSWORD), resolves to '' → admin login shows "not configured".
  define: {
    __ADMIN_HASH__: JSON.stringify(adminHash),
  },
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
