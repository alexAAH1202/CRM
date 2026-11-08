import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  // A production build without the Firebase web config would ship an app that can't connect.
  if (command === 'build' && mode !== 'test') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
    const missing = required.filter((k) => !env[k]);
    if (env.VITE_USE_EMULATORS !== 'true' && missing.length > 0) {
      throw new Error(
        `Missing ${missing.join(', ')} in web/.env.local — see docs/SETUP.md step B3b. ` +
          'For a local emulator-only build set VITE_USE_EMULATORS=true.',
      );
    }
  }
  return {
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
  };
});
