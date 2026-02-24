import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same `dist/` works when served from a custom scheme
  // via WKURLSchemeHandler (e.g., keriwasm://localhost/).
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // WKWebView (iOS ≤ 17) does not support ES module workers.
  // IIFE format compiles to a classic worker that can be spawned with `new Worker(url)`.
  worker: {
    format: 'iife',
  },
});
