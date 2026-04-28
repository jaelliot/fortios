import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './playwright',
    // Single Chromium project — Pyodide/SharedArrayBuffer require a modern browser;
    // Safari/Firefox cross-origin isolation behaviour differs from the WKWebView target.
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    // Vite preview serves the production build with COOP/COEP headers (vite.config.ts).
    webServer: {
        command: 'vite preview --port 4173',
        port: 4173,
        reuseExistingServer: !process.env['CI'],
        // 60s boot allows enough time for `vite preview` to start.
        timeout: 60_000,
    },
    use: {
        baseURL: 'http://localhost:4173',
        // Chromium must be in a context with cross-origin isolation so that
        // SharedArrayBuffer is available (Pyodide threading requirement).
        contextOptions: {
            // bypassCSP is intentionally false — we want production CSP behaviour.
        },
    },
    // CI: single worker, one retry to separate transient browser boot flakes
    // from deterministic failures.
    fullyParallel: false,
    workers: 1,
    retries: process.env['CI'] ? 1 : 0,
    reporter: process.env['CI'] ? 'github' : 'list',
});
