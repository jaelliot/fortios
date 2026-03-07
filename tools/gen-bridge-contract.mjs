#!/usr/bin/env node
//
// gen-bridge-contract.mjs
//
// Reads bridge-contract.json and generates:
//   1. src/bridge-contract.ts     — TypeScript string constants
//   2. xcodeproj/KeriWallet/KeriWallet/BridgeContract.swift — Swift constants
//   3. generated/BridgeContract.kt — Kotlin constants (for Fort-android)
//
// Run: node tools/gen-bridge-contract.mjs
// CI:  node tools/gen-bridge-contract.mjs --check  (exits 1 if generated files are stale)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const contractPath = resolve(ROOT, 'bridge-contract.json');
const tsOutPath = resolve(ROOT, 'src', 'bridge-contract.ts');
const swiftOutPath = resolve(ROOT, 'xcodeproj', 'KeriWallet', 'KeriWallet', 'BridgeContract.swift');
const kotlinOutPath = resolve(ROOT, 'generated', 'BridgeContract.kt');

const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));

// ── Helper: snake_case → camelCase ──────────────────────────────────────────
function toCamelCase(s) {
    return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ── Helper: snake_case → SCREAMING_SNAKE ────────────────────────────────────
function toScreamingSnake(s) {
    return s.toUpperCase();
}
// ── Helper: snake_case → PascalCase ─────────────────────────────────────────
function toPascalCase(s) {
    return s.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
// ── Generate TypeScript ─────────────────────────────────────────────────────
function generateTypeScript() {
    const lines = [
        '// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────',
        '// Source: bridge-contract.json',
        '// Regenerate: node tools/gen-bridge-contract.mjs',
        '',
        '// ── Contract version ────────────────────────────────────────────────────────',
        `export const BRIDGE_CONTRACT_VERSION = ${JSON.stringify(contract.version)} as const;`,
        '',
        '// ── Bridge handler ──────────────────────────────────────────────────────────',
        `export const BRIDGE_HANDLER_NAME = ${JSON.stringify(contract.bridge.handlerName)} as const;`,
        '',
    ];

    // Lifecycle states
    if (contract.lifecycleStates) {
        lines.push('// ── Lifecycle states ────────────────────────────────────────────────────────');
        for (const s of contract.lifecycleStates) {
            lines.push(`export const LIFECYCLE_${toScreamingSnake(s)} = ${JSON.stringify(s)} as const;`);
        }
        lines.push('', 'export const LIFECYCLE_STATES = [');
        for (const s of contract.lifecycleStates) {
            lines.push(`    LIFECYCLE_${toScreamingSnake(s)},`);
        }
        lines.push('] as const;', '');
    }

    lines.push('// ── Bridge message types (JS → Swift) ──────────────────────────────────────');

    for (const t of contract.bridgeMessageTypes) {
        lines.push(`export const BRIDGE_${toScreamingSnake(t)} = ${JSON.stringify(t)} as const;`);
    }

    lines.push('', 'export const BRIDGE_MESSAGE_TYPES = [');
    for (const t of contract.bridgeMessageTypes) {
        lines.push(`    BRIDGE_${toScreamingSnake(t)},`);
    }
    lines.push('] as const;', '');

    lines.push('// ── Worker command types (main → worker) ────────────────────────────────────');
    for (const t of contract.workerCommandTypes) {
        lines.push(`export const WORKER_CMD_${toScreamingSnake(t)} = ${JSON.stringify(t)} as const;`);
    }
    lines.push('', 'export const WORKER_COMMAND_TYPES = [');
    for (const t of contract.workerCommandTypes) {
        lines.push(`    WORKER_CMD_${toScreamingSnake(t)},`);
    }
    lines.push('] as const;', '');

    lines.push('// ── Worker result types (worker → main) ─────────────────────────────────────');
    for (const t of contract.workerResultTypes) {
        lines.push(`export const WORKER_RES_${toScreamingSnake(t)} = ${JSON.stringify(t)} as const;`);
    }
    lines.push('', 'export const WORKER_RESULT_TYPES = [');
    for (const t of contract.workerResultTypes) {
        lines.push(`    WORKER_RES_${toScreamingSnake(t)},`);
    }
    lines.push('] as const;', '');

    return lines.join('\n');
}

// ── Generate Swift ──────────────────────────────────────────────────────────
function generateSwift() {
    const lines = [
        '// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────',
        '// Source: bridge-contract.json',
        '// Regenerate: node tools/gen-bridge-contract.mjs',
        '//',
        '// This file provides the cross-language bridge constants. Values here must',
        '// match the TypeScript side (src/bridge-contract.ts) exactly.',
        '',
        'import Foundation',
        '',
        '/// Cross-language bridge constants generated from `bridge-contract.json`.',
        '/// Use these instead of hardcoded string literals when referring to bridge',
        '/// handler names or message type discriminants.',
        'enum BridgeContract {',
        '',
        '    // MARK: - Contract Version',
        '',
        `    static let version = ${JSON.stringify(contract.version)}`,
        '',
        '    // MARK: - Bridge Handler',
        '',
        `    /// WKScriptMessageHandler name — must match JS: \`webkit.messageHandlers.${contract.bridge.handlerName}\`.`,
        `    static let handlerName = ${JSON.stringify(contract.bridge.handlerName)}`,
        '',
    ];

    // Lifecycle states
    if (contract.lifecycleStates) {
        lines.push('    // MARK: - Lifecycle States', '');
        for (const s of contract.lifecycleStates) {
            lines.push(`    static let lifecycle${toPascalCase(s)} = ${JSON.stringify(s)}`);
        }
        lines.push('', '    static let allLifecycleStates: [String] = [');
        for (const s of contract.lifecycleStates) {
            lines.push(`        lifecycle${toPascalCase(s)},`);
        }
        lines.push('    ]', '');
    }

    lines.push('    // MARK: - Bridge Message Types (JS → Swift)', '');

    for (const t of contract.bridgeMessageTypes) {
        lines.push(`    static let bridge${toCamelCase(t).charAt(0).toUpperCase() + toCamelCase(t).slice(1)} = ${JSON.stringify(t)}`);
    }

    lines.push('', '    static let allBridgeMessageTypes: [String] = [');
    for (const t of contract.bridgeMessageTypes) {
        lines.push(`        bridge${toCamelCase(t).charAt(0).toUpperCase() + toCamelCase(t).slice(1)},`);
    }
    lines.push('    ]', '');

    lines.push('    // MARK: - Worker Command Types (main → worker)', '');
    for (const t of contract.workerCommandTypes) {
        lines.push(`    static let workerCmd${toCamelCase(t).charAt(0).toUpperCase() + toCamelCase(t).slice(1)} = ${JSON.stringify(t)}`);
    }

    lines.push('', '    static let allWorkerCommandTypes: [String] = [');
    for (const t of contract.workerCommandTypes) {
        lines.push(`        workerCmd${toCamelCase(t).charAt(0).toUpperCase() + toCamelCase(t).slice(1)},`);
    }
    lines.push('    ]', '');

    lines.push('    // MARK: - Worker Result Types (worker → main)', '');
    for (const t of contract.workerResultTypes) {
        lines.push(`    static let workerRes${toCamelCase(t).charAt(0).toUpperCase() + toCamelCase(t).slice(1)} = ${JSON.stringify(t)}`);
    }

    lines.push('', '    static let allWorkerResultTypes: [String] = [');
    for (const t of contract.workerResultTypes) {
        lines.push(`        workerRes${toCamelCase(t).charAt(0).toUpperCase() + toCamelCase(t).slice(1)},`);
    }
    lines.push('    ]', '}', '');

    return lines.join('\n');
}

// ── Generate Kotlin ─────────────────────────────────────────────────────────
function generateKotlin() {
    const lines = [
        '// ── AUTO-GENERATED — do not edit manually ──────────────────────────────────',
        '// Source: bridge-contract.json',
        '// Regenerate: node tools/gen-bridge-contract.mjs',
        '//',
        '// This file provides the cross-language bridge constants for Android.',
        '// Values here must match the TypeScript side (src/bridge-contract.ts) exactly.',
        '',
        'package org.kerifoundation.fort.bridge',
        '',
        '/**',
        ' * Cross-language bridge constants generated from `bridge-contract.json`.',
        ' * Use these instead of hardcoded string literals when referring to bridge',
        ' * handler names or message type discriminants.',
        ' */',
        'object BridgeContract {',
        '',
        '    // ── Contract Version ────────────────────────────────────────────────────',
        '',
        `    const val VERSION = ${JSON.stringify(contract.version)}`,
        '',
        '    // ── Bridge Handler ──────────────────────────────────────────────────────',
        '',
        `    /** addJavascriptInterface name — must match JS: \`window.AndroidBridge\`. */`,
        `    const val HANDLER_NAME = ${JSON.stringify(contract.bridge.handlerName)}`,
        '',
    ];

    // Lifecycle states
    if (contract.lifecycleStates) {
        lines.push('    // ── Lifecycle States ──────────────────────────────────────────────────', '');
        for (const s of contract.lifecycleStates) {
            lines.push(`    const val LIFECYCLE_${toScreamingSnake(s)} = ${JSON.stringify(s)}`);
        }
        lines.push('', '    val ALL_LIFECYCLE_STATES = listOf(');
        for (const s of contract.lifecycleStates) {
            lines.push(`        LIFECYCLE_${toScreamingSnake(s)},`);
        }
        lines.push('    )', '');
    }

    lines.push('    // ── Bridge Message Types (JS → Android) ─────────────────────────────────', '');

    for (const t of contract.bridgeMessageTypes) {
        lines.push(`    const val BRIDGE_${toScreamingSnake(t)} = ${JSON.stringify(t)}`);
    }

    lines.push('', '    val ALL_BRIDGE_MESSAGE_TYPES = listOf(');
    for (const t of contract.bridgeMessageTypes) {
        lines.push(`        BRIDGE_${toScreamingSnake(t)},`);
    }
    lines.push('    )', '');

    lines.push('    // ── Worker Command Types (main → worker) ─────────────────────────────', '');
    for (const t of contract.workerCommandTypes) {
        lines.push(`    const val WORKER_CMD_${toScreamingSnake(t)} = ${JSON.stringify(t)}`);
    }

    lines.push('', '    val ALL_WORKER_COMMAND_TYPES = listOf(');
    for (const t of contract.workerCommandTypes) {
        lines.push(`        WORKER_CMD_${toScreamingSnake(t)},`);
    }
    lines.push('    )', '');

    lines.push('    // ── Worker Result Types (worker → main) ──────────────────────────────', '');
    for (const t of contract.workerResultTypes) {
        lines.push(`    const val WORKER_RES_${toScreamingSnake(t)} = ${JSON.stringify(t)}`);
    }

    lines.push('', '    val ALL_WORKER_RESULT_TYPES = listOf(');
    for (const t of contract.workerResultTypes) {
        lines.push(`        WORKER_RES_${toScreamingSnake(t)},`);
    }
    lines.push('    )', '}', '');

    return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const tsContent = generateTypeScript();
const swiftContent = generateSwift();
const kotlinContent = generateKotlin();
const isCheck = process.argv.includes('--check');

if (isCheck) {
    let stale = false;

    if (!existsSync(tsOutPath) || readFileSync(tsOutPath, 'utf-8') !== tsContent) {
        console.error(`STALE: ${tsOutPath}`);
        stale = true;
    }
    if (!existsSync(swiftOutPath) || readFileSync(swiftOutPath, 'utf-8') !== swiftContent) {
        console.error(`STALE: ${swiftOutPath}`);
        stale = true;
    }
    if (!existsSync(kotlinOutPath) || readFileSync(kotlinOutPath, 'utf-8') !== kotlinContent) {
        console.error(`STALE: ${kotlinOutPath}`);
        stale = true;
    }

    if (stale) {
        console.error('Bridge contract files are out of date. Run: node tools/gen-bridge-contract.mjs');
        process.exit(1);
    }

    console.log('Bridge contract files are up to date.');
    process.exit(0);
}

writeFileSync(tsOutPath, tsContent, 'utf-8');
console.log(`wrote ${tsOutPath}`);

writeFileSync(swiftOutPath, swiftContent, 'utf-8');
console.log(`wrote ${swiftOutPath}`);

mkdirSync(dirname(kotlinOutPath), { recursive: true });
writeFileSync(kotlinOutPath, kotlinContent, 'utf-8');
console.log(`wrote ${kotlinOutPath}`);
