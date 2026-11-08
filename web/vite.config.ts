import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // The Firestore SDK (with persistent cache) is ~600 kB raw / ~185 kB gzip on its own,
    // isolated in a long-cached chunk. App chunks should stay far below this.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // Firebase is large and changes rarely: keep it in its own long-cached chunk.
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          if (/node_modules\/(react|react-dom|scheduler|react-router)/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
