import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Absolute base: SPA deep routes (/@user/...) need /assets/... not ./assets/...
  // (relative ./ breaks on deep URLs — the JS bundle 404s and the page is white)
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Hashed filenames = automatic cache busting: browsers fetch the new
        // bundle on every deploy instead of serving a stale cached copy.
        entryFileNames: 'assets/bundle-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'assets/bundle-[hash].css';
          }
          return 'assets/[name]-[hash].[ext]';
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api/lil': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
    },
    hmr: { port: 3011 },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  }
});
