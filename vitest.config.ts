import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Node environment — shared payload unit tests and build-tool checks do
        // not require a browser. Playwright handles browser-level E2E separately.
        environment: 'node',
        // No implicit globals (describe/it/expect) — use explicit imports from vitest.
        globals: false,
        include: [
            'src/__tests__/**/*.test.ts',
            'tools/**/*.test.mjs',
        ],
        // Strict coverage thresholds are intentionally NOT set here — add them
        // once the test suite grows past the initial scaffold.
    },
});
