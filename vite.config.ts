import { defineConfig } from 'vite';

// Cross-origin isolation headers — required for SharedArrayBuffer / Pyodide threading.
// Applied to both dev server and preview server (used by Playwright E2E).
const crossOriginHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
};

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
    server: {
        headers: crossOriginHeaders,
    },
    preview: {
        // Playwright E2E uses `vite preview` — must have COOP/COEP headers
        // so that SharedArrayBuffer is available in the browser context.
        headers: crossOriginHeaders,
    },
});
