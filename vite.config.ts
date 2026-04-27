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
    // Pyodide 0.29 ships as an ES module runtime. Keep the worker bundle in ES format
    // so the main thread can spawn it with `type: 'module'` and the worker can import
    // the bundled `dist/pyodide/pyodide.mjs` asset without a classic-worker shim.
    worker: {
        format: 'es',
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
