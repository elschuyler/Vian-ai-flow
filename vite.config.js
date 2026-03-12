import { defineConfig } from 'vite';

export default defineConfig({
  // BASE_URL is set to /vian-ai-flow/ in CI for GitHub Pages deployment.
  // Capacitor APK builds use '/' so the WebView resolves assets correctly.
  base: process.env.BASE_URL || '/',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsDir: 'assets',
  },
});
