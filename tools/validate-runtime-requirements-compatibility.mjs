#!/usr/bin/env node

/**
 * Runtime requirements compatibility evaluator for Fort-ios.
 *
 * Discovers FortWeb's runtime-requirements artifact through the typed manifest
 * descriptor, validates exact byte integrity, and evaluates compatibility
 * against the mechanism-first iOS platform configuration.
 *
 * Read-only. Exit codes:
 *   0 — structurally and semantically compatible
 *   1 — incompatibility detected
 *   2 — tool error (missing files, unreadable, etc.)
 *
 * Usage:
 *   node tools/validate-runtime-requirements-compatibility.mjs
 *     [--payload <path>] [--config <path>]
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PAYLOAD = path.join(PROJECT_DIR, 'WebPayload');
const DEFAULT_CONFIG = path.join(PROJECT_DIR, 'runtime-platform-config.json');

// --- Producer authority ---

const REQUIRED_PRODUCER = 'fortweb';
const REQUIRED_PROFILE = 'offline-runtime';
const REQUIREMENTS_V1 = 'fort.runtime-requirements.v1';
const REQUIREMENTS_V2 = 'fort.runtime-requirements.v2';
const CONVENTIONAL_PATH = 'contracts/runtime-requirements.json';

const REQUIRED_CAPABILITIES = [
    'stable_origin_across_launches',
    'persistent_storage_partition',
    'secure_context',
    'remote_network_prohibition',
    'bundled_assets_only',
    'worker_availability',
    'main_frame_provenance',
    'origin_provenance',
    'deterministic_entrypoint',
    'no_fallback_shell_substitution',
];

const REQUIRED_FORBIDDEN_BEHAVIORS = [
    'network_fetch',
    'service_worker_registration',
    'general_purpose_browsing',
    'localhost_or_loopback_origin',
    'http_fallback',
];

const V2_CAPABILITIES = [
    ...REQUIRED_CAPABILITIES.filter((capability) => capability !== 'remote_network_prohibition'),
    'remote_runtime_acquisition_prohibition',
    'wallet_service_https',
];

const V2_FORBIDDEN_BEHAVIORS = [
    'remote_runtime_acquisition',
    'cleartext_wallet_service_traffic',
    'service_worker_registration',
    'general_purpose_browsing',
    'http_fallback',
];

const ALLOWED_SECURITY_MECHANISMS = ['custom-scheme-tls-like'];

// --- Compatibility predicates ---
// Each maps a producer requirement to a check over the platform config.
// Returns { compatible: true } or { compatible: false, reason: '...' }.

const CAPABILITY_PREDICATES = {
    stable_origin_across_launches(cfg) {
        if (cfg.origin?.stability !== 'fixed-across-launches') {
            return { compatible: false, reason: `origin stability must be 'fixed-across-launches', got '${cfg.origin?.stability}'` };
        }
        return { compatible: true };
    },
    persistent_storage_partition(cfg) {
        if (!cfg.storage?.mechanism) {
            return { compatible: false, reason: 'storage mechanism not declared' };
        }
        if (cfg.storage.partition !== 'fixed-namespace') {
            return { compatible: false, reason: `storage partition must be 'fixed-namespace', got '${cfg.storage.partition}'` };
        }
        return { compatible: true };
    },
    secure_context(cfg) {
        if (!cfg.security_context?.mechanism) {
            return { compatible: false, reason: 'security context mechanism not declared' };
        }
        if (!ALLOWED_SECURITY_MECHANISMS.includes(cfg.security_context.mechanism)) {
            return { compatible: false, reason: `security_context mechanism '${cfg.security_context.mechanism}' is not a recognized secure-context mechanism` };
        }
        return { compatible: true };
    },
    remote_network_prohibition(cfg) {
        if (cfg.network?.policy !== 'deny-all') {
            return { compatible: false, reason: `network policy must be 'deny-all', got '${cfg.network?.policy}'` };
        }
        return { compatible: true };
    },
    remote_runtime_acquisition_prohibition(cfg) {
        if (cfg.network?.policy !== 'deny-all') {
            return { compatible: false, reason: 'no verified policy separates bundled runtime code from service data' };
        }
        return { compatible: true };
    },
    wallet_service_https() {
        // The current host contract cannot attest HTTPS data access separately from runtime code.
        return { compatible: false, reason: 'HTTPS wallet-service access is not verified by this iOS configuration' };
    },
    bundled_assets_only(cfg) {
        if (cfg.assets?.source !== 'application-bundle') {
            return { compatible: false, reason: `asset source must be 'application-bundle', got '${cfg.assets?.source}'` };
        }
        return { compatible: true };
    },
    worker_availability(cfg) {
        if (cfg.workers?.available !== true) {
            return { compatible: false, reason: 'workers must be declared available' };
        }
        return { compatible: true };
    },
    main_frame_provenance(cfg) {
        if (cfg.bridge?.provenance !== 'main-frame-only') {
            return { compatible: false, reason: `bridge provenance must be 'main-frame-only', got '${cfg.bridge?.provenance}'` };
        }
        return { compatible: true };
    },
    origin_provenance(cfg) {
        if (cfg.bridge?.origin_validation !== 'exact-scheme-host-match') {
            return { compatible: false, reason: `bridge origin validation must be 'exact-scheme-host-match', got '${cfg.bridge?.origin_validation}'` };
        }
        return { compatible: true };
    },
    deterministic_entrypoint(cfg) {
        if (cfg.entrypoint?.source !== 'manifest-declared') {
            return { compatible: false, reason: `entrypoint source must be 'manifest-declared', got '${cfg.entrypoint?.source}'` };
        }
        return { compatible: true };
    },
    no_fallback_shell_substitution(cfg) {
        if (cfg.entrypoint?.fallback !== 'none') {
            return { compatible: false, reason: `entrypoint fallback must be 'none', got '${cfg.entrypoint?.fallback}'` };
        }
        return { compatible: true };
    },
};

const FORBIDDEN_PREDICATES = {
    network_fetch(cfg) {
        if (cfg.network?.policy !== 'deny-all') {
            return { compatible: false, reason: `network_fetch requires network policy 'deny-all', got '${cfg.network?.policy}'` };
        }
        return { compatible: true };
    },
    remote_runtime_acquisition(cfg) {
        return CAPABILITY_PREDICATES.remote_runtime_acquisition_prohibition(cfg);
    },
    cleartext_wallet_service_traffic(cfg) {
        if (cfg.network?.policy !== 'deny-all') {
            return { compatible: false, reason: 'no verified policy rejects cleartext wallet-service traffic' };
        }
        return { compatible: true };
    },
    service_worker_registration(cfg) {
        // WKWebView with custom scheme does not support service workers by default
        if (cfg.assets?.delivery === 'custom-scheme-handler') {
            return { compatible: true };
        }
        return { compatible: false, reason: 'service_worker_registration requires custom-scheme-handler asset delivery' };
    },
    general_purpose_browsing(cfg) {
        if (cfg.network?.allowed_schemes?.length === 1) {
            return { compatible: true };
        }
        return { compatible: false, reason: 'general_purpose_browsing requires single-scheme navigation' };
    },
    localhost_or_loopback_origin(cfg) {
        const host = cfg.origin?.host;
        if (host === 'localhost' || host === '127.0.0.1' || host?.startsWith('127.')) {
            return { compatible: false, reason: `origin host '${host}' is localhost or loopback` };
        }
        return { compatible: true };
    },
    http_fallback(cfg) {
        if (cfg.entrypoint?.fallback !== 'none') {
            return { compatible: false, reason: `http_fallback requires entrypoint fallback 'none', got '${cfg.entrypoint?.fallback}'` };
        }
        if (cfg.network?.allowed_schemes?.includes('http') || cfg.network?.allowed_schemes?.includes('https')) {
            return { compatible: false, reason: 'http_fallback requires no HTTP/HTTPS scheme in allowed list' };
        }
        return { compatible: true };
    },
};

// ---------------------------------------------------------------------------

function fail(message) {
    process.stderr.write(`[validate-runtime-requirements-compatibility] ${message}\n`);
    process.exit(1);
}

function toolError(message) {
    process.stderr.write(`[validate-runtime-requirements-compatibility] TOOL ERROR: ${message}\n`);
    process.exit(2);
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2);
    let payloadDir = DEFAULT_PAYLOAD;
    let configPath = DEFAULT_CONFIG;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--payload' && i + 1 < args.length) {
            payloadDir = path.resolve(args[++i]);
        } else if (args[i] === '--config' && i + 1 < args.length) {
            configPath = path.resolve(args[++i]);
        }
    }

    // --- Load platform config ---
    let platformConfig;
    try {
        platformConfig = JSON.parse(await readFile(configPath, 'utf8'));
    } catch (err) {
        toolError(`Cannot read platform config at ${configPath}: ${err.message}`);
    }

    // --- Load manifest ---
    const manifestPath = path.join(payloadDir, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (err) {
        fail(`Cannot read manifest at ${manifestPath}: ${err.message}`);
    }

    if (manifest.producer !== REQUIRED_PRODUCER) {
        fail(`Manifest producer must be '${REQUIRED_PRODUCER}', got '${manifest.producer}'.`);
    }

    // --- Discover requirements through typed descriptor ---
    const rr = manifest.contracts?.runtime_requirements;
    if (!rr || typeof rr.path !== 'string' || rr.path.trim().length === 0) {
        fail('Typed runtime-requirements descriptor is missing or has no path.');
    }

    if (rr.path !== CONVENTIONAL_PATH) {
        fail(`Descriptor path '${rr.path}' is not the conventional path '${CONVENTIONAL_PATH}'.`);
    }

    // --- Inventory match ---
    const inventoryMatches = (manifest.files || []).filter((f) => f.path === CONVENTIONAL_PATH);
    if (inventoryMatches.length === 0) {
        fail(`'${CONVENTIONAL_PATH}' not found in manifest file inventory.`);
    }
    if (inventoryMatches.length > 1) {
        fail(`'${CONVENTIONAL_PATH}' appears ${inventoryMatches.length} times in inventory; must be exactly 1.`);
    }

    const invEntry = inventoryMatches[0];
    const manifestBytes = invEntry.bytes;
    const manifestSha = invEntry.sha256;

    // --- Read actual artifact bytes ---
    const artifactPath = path.join(payloadDir, CONVENTIONAL_PATH);
    let actualBuffer;
    try {
        actualBuffer = await readFile(artifactPath);
    } catch (err) {
        fail(`Cannot read requirements artifact at ${artifactPath}: ${err.message}`);
    }

    // --- Byte-integrity ---
    if (actualBuffer.length !== manifestBytes) {
        fail(`Byte-count mismatch: actual=${actualBuffer.length} manifest=${manifestBytes}`);
    }

    const actualSha = sha256(actualBuffer);
    if (actualSha !== manifestSha) {
        fail(`SHA-256 mismatch: actual=${actualSha} manifest=${manifestSha}`);
    }

    // --- UTF-8 ---
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let rrText;
    try {
        rrText = decoder.decode(actualBuffer);
    } catch (err) {
        fail(`Requirements artifact is not valid UTF-8: ${err.message}`);
    }

    if (rrText.includes('\uFFFD')) {
        fail('Requirements artifact contains U+FFFD replacement characters.');
    }

    // --- JSON parse ---
    let rrData;
    try {
        rrData = JSON.parse(rrText);
    } catch (err) {
        fail(`Requirements artifact is not valid JSON: ${err.message}`);
    }

    // --- Schema and identity ---
    if (![REQUIREMENTS_V1, REQUIREMENTS_V2].includes(rrData.schema)) {
        fail(`Unsupported requirements schema '${rrData.schema}'.`);
    }
    const expectedVersion = rrData.schema === REQUIREMENTS_V1 ? 1 : 2;
    if (rrData.version !== expectedVersion) {
        fail(`Unsupported requirements version ${rrData.version}.`);
    }
    if (rrData.producer !== REQUIRED_PRODUCER) {
        fail(`Requirements producer '${rrData.producer}' does not match '${REQUIRED_PRODUCER}'.`);
    }
    if (rrData.payload_profile !== REQUIRED_PROFILE) {
        fail(`Requirements payload_profile '${rrData.payload_profile}' does not match '${REQUIRED_PROFILE}'.`);
    }

    // --- Capability evaluation ---
    if (!rrData.capabilities || typeof rrData.capabilities !== 'object' || Array.isArray(rrData.capabilities)) {
        fail('Requirements capabilities must be an object.');
    }
    if (!Array.isArray(rrData.forbidden_behaviors)) {
        fail('Requirements forbidden_behaviors must be an array.');
    }
    const producerCaps = rrData.capabilities;
    const failures = [];
    const requiredCapabilities = rrData.schema === REQUIREMENTS_V1 ? REQUIRED_CAPABILITIES : V2_CAPABILITIES;
    const requiredForbidden = rrData.schema === REQUIREMENTS_V1 ? REQUIRED_FORBIDDEN_BEHAVIORS : V2_FORBIDDEN_BEHAVIORS;
    if (!platformConfig.requirements_compatibility?.supported_schemas?.includes(rrData.schema)) {
        failures.push(`Platform configuration does not declare support for '${rrData.schema}'.`);
    }
    if (!platformConfig.requirements_compatibility?.supported_profiles?.includes(rrData.payload_profile)) {
        failures.push(`Platform configuration does not declare support for profile '${rrData.payload_profile}'.`);
    }

    for (const capId of requiredCapabilities) {
        const producerCap = producerCaps[capId];
        if (!producerCap) {
            failures.push(`Missing required capability: ${capId}`);
            continue;
        }
        if (producerCap.required !== true) {
            // All capabilities in the supported contracts are required.
            failures.push(`Capability '${capId}' is not marked required in producer.`);
            continue;
        }

        const predicate = CAPABILITY_PREDICATES[capId];
        if (!predicate) {
            failures.push(`Unknown required capability: ${capId}`);
            continue;
        }

        const result = predicate(platformConfig);
        if (!result.compatible) {
            failures.push(`Capability '${capId}': ${result.reason}`);
        }
    }

    // Detect unknown capabilities in producer
    for (const capId of Object.keys(producerCaps)) {
        if (!requiredCapabilities.includes(capId)) {
            failures.push(`Unknown required capability: ${capId}`);
        }
    }

    // --- Forbidden-behavior evaluation ---
    const producerFB = rrData.forbidden_behaviors;
    for (const fbId of requiredForbidden) {
        if (!producerFB.includes(fbId)) {
            failures.push(`Missing forbidden behavior in producer: ${fbId}`);
            continue;
        }

        const predicate = FORBIDDEN_PREDICATES[fbId];
        if (!predicate) {
            failures.push(`Unknown forbidden behavior: ${fbId}`);
            continue;
        }

        const result = predicate(platformConfig);
        if (!result.compatible) {
            failures.push(`Forbidden behavior '${fbId}': ${result.reason}`);
        }
    }

    for (const fbId of producerFB) {
        if (!requiredForbidden.includes(fbId)) {
            failures.push(`Unknown forbidden behavior: ${fbId}`);
        }
    }

    // --- Report ---
    if (failures.length > 0) {
        for (const f of failures) {
            process.stderr.write(`[validate-runtime-requirements-compatibility] ${f}\n`);
        }
        fail(`${failures.length} compatibility failure(s).`);
    }

    process.stdout.write(`[validate-runtime-requirements-compatibility] Compatible: ${requiredCapabilities.length} capabilities, ${requiredForbidden.length} forbidden behaviors verified.\n`);
}

await main();
