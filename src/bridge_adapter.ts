// ── Bridge adapter — platform-specific transport for JS → native messages ─────
//
// Detects the native bridge at runtime and returns the appropriate adapter.
//
// Platforms:
//   iOS (WKWebView)   — window.webkit.messageHandlers.<name>.postMessage()
//   Android (WebView)  — window.AndroidBridge.postMessage(JSON.stringify())
//   Fallback (browser) — silent no-op (messages dropped)
//
// This is the ONLY platform-detection code in the web payload. Everything
// else (worker management, crypto proof, DOM updates) is platform-agnostic.

import { BRIDGE_HANDLER_NAME } from './constants';
import type { BridgeAdapter, BridgeEnvelope } from './types';

// ── Adapter implementations ──────────────────────────────────────────────────

/** iOS: WKWebView `webkit.messageHandlers` API. */
function createWebKitAdapter(): BridgeAdapter {
    return {
        postMessage(payload: BridgeEnvelope): void {
            const bridge = (window as unknown as { webkit?: any })
                .webkit?.messageHandlers?.[BRIDGE_HANDLER_NAME];
            if (bridge && typeof bridge.postMessage === 'function') {
                bridge.postMessage(payload);
            }
        },
    };
}

/** Android: `addJavascriptInterface` exposes `window.AndroidBridge`. */
function createAndroidAdapter(): BridgeAdapter {
    return {
        postMessage(payload: BridgeEnvelope): void {
            const bridge = (window as unknown as { AndroidBridge?: { postMessage: (json: string) => void } })
                .AndroidBridge;
            if (bridge && typeof bridge.postMessage === 'function') {
                bridge.postMessage(JSON.stringify(payload));
            }
        },
    };
}

/** Fallback: no native host — messages are silently dropped. */
function createNoOpAdapter(): BridgeAdapter {
    return { postMessage(): void { /* no-op */ } };
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Detect native bridge and return the matching adapter. */
export function createBridgeAdapter(): BridgeAdapter {
    if (typeof window !== 'undefined') {
        // iOS detection: WKWebView injects `window.webkit`
        if ((window as unknown as { webkit?: unknown }).webkit) {
            return createWebKitAdapter();
        }
        // Android detection: addJavascriptInterface injects `window.AndroidBridge`
        if ((window as unknown as { AndroidBridge?: unknown }).AndroidBridge) {
            return createAndroidAdapter();
        }
    }
    return createNoOpAdapter();
}
