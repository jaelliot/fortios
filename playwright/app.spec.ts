import { test, expect } from '@playwright/test';

// ── Structural smoke tests ───────────────────────────────────────────────────
//
// These tests verify that the built Vite payload:
//   1. Loads without critical errors
//   2. Has the expected DOM structure
//   3. Exposes the Swift ↔ JS bridge API surface correctly
//
// Pyodide WASM initialisation is intentionally NOT awaited here — it requires
// 20-40s to download and load the runtime, which is too slow for PR-blocking CI.
// The Pyodide roundtrip is covered by a separate @slow tagged test below.

test.describe('KERI Wallet app shell', () => {
    test('page title is KERI Wallet', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle('KERI Wallet');
    });

    test('#app element is present in DOM', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#app')).toBeAttached();
    });

    test('#loading element is present on initial load', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#loading')).toBeAttached();
    });

    test('no critical JavaScript errors during page init', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (err) => {
            // Silence expected "webkit is not defined" — not present in browser context.
            if (!err.message.includes('webkit')) {
                errors.push(err.message);
            }
        });
        await page.goto('/');
        // Brief pause for synchronous init to complete
        await page.waitForTimeout(200);
        expect(errors).toHaveLength(0);
    });

    test('handleNativeCommand is exposed on window', async ({ page }) => {
        await page.goto('/');
        const exposed = await page.evaluate(
            () => typeof (window as unknown as { handleNativeCommand?: unknown }).handleNativeCommand,
        );
        expect(exposed).toBe('function');
    });

    test('page serves correct MIME type for main script', async ({ page }) => {
        const responses: { url: string; contentType: string | null }[] = [];
        page.on('response', (resp) => {
            const ct = resp.headers()['content-type'] ?? null;
            if (resp.url().endsWith('.js') || resp.url().endsWith('.mjs')) {
                responses.push({ url: resp.url(), contentType: ct });
            }
        });
        await page.goto('/');
        // Main bundle should be served as text/javascript (not application/octet-stream)
        const jsResponses = responses.filter((r) => r.contentType?.includes('javascript'));
        expect(jsResponses.length).toBeGreaterThan(0);
    });
});

// ── Bridge contract consistency ───────────────────────────────────────────────

test.describe('Bridge contract', () => {
    test('bridge-contract.json values are accessible from the built bundle', async ({ page }) => {
        await page.goto('/');
        // The bundle should expose the BRIDGE_HANDLER_NAME constant indirectly
        // via the registered message handler name. We verify the page loads
        // without ReferenceErrors on bridge-contract imports.
        const loadErrors = await page.evaluate(() => {
            return (window as unknown as { __bridgeLoadError?: string }).__bridgeLoadError ?? null;
        });
        expect(loadErrors).toBeNull();
    });
});

// ── Slow: full Pyodide roundtrip ─────────────────────────────────────────────
//
// Tagged @slow — excluded from default `make test-e2e` run.
// Run explicitly with: npx playwright test --grep @slow
//
// These tests require the Pyodide WASM runtime to fully initialise (20-40s).
// They are intended for nightly CI or manual verification before releases.

test.describe('@slow Pyodide roundtrip', () => {
    test.setTimeout(120_000); // 2 minutes for WASM boot

    test('worker reaches ready state', async ({ page }) => {
        // Inject a spy on postMessage before page runs
        await page.addInitScript(() => {
            const messages: unknown[] = [];
            (window as unknown as { __workerMessages: unknown[] }).__workerMessages = messages;
            // Intercept bridge postMessage via webkit mock
            (window as unknown as { webkit: unknown }).webkit = {
                messageHandlers: {
                    bridge: {
                        postMessage: (msg: unknown) => {
                            messages.push(msg);
                        },
                    },
                },
            };
        });

        await page.goto('/');

        // Wait for lifecycle completion. The current app posts lifecycle:boot
        // and lifecycle:done, and also updates visible status text.
        await page.waitForFunction(
            () => {
                const msgs = (window as unknown as { __workerMessages?: Array<{ type: string; message?: string }> }).__workerMessages ?? [];
                const lifecycleDone = msgs.some((m) => m.type === 'lifecycle' && m.message === 'done');
                const statusText = (document.getElementById('status')?.textContent ?? '').toLowerCase();
                return lifecycleDone || statusText.includes('done');
            },
            { timeout: 90_000, polling: 1000 },
        );

        const messages = await page.evaluate(
            () => (window as unknown as { __workerMessages: unknown[] }).__workerMessages,
        );

        const workerLogText = await page.locator('#output').innerText();
        expect(workerLogText).not.toContain('Pyodide boot failed');
        expect(messages.some((m) => (m as { type: string }).type === 'lifecycle')).toBe(true);
    });
});
