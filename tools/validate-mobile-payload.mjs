import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const TEXT_FILE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.mjs', '.txt']);
const REQUIRED_MANIFEST_FIELDS = [
    'producer',
    'payload_profile',
    'entry_document',
    'entry_script',
    'build_command',
    'pyodide_worker_mode',
    'pyodide_asset_path',
    'pyodide_asset_mode',
    'sync_targets',
    'source_git_branch',
    'source_git_status',
];
const BLOCKED_PRODUCERS = new Set(['fort-ios-local']);
const BLOCKED_PAYLOAD_PROFILES = new Set(['proof-shell']);
const BANNED_MARKERS = [
    'Profile ID',
    'Seed Test Data',
    'List Identifiers',
    'fortweb proof vector v1',
];

function parseArgs(argv) {
    const options = {
        payloadDir: null,
        target: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--payload-dir') {
            options.payloadDir = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--target') {
            options.target = argv[index + 1];
            index += 1;
            continue;
        }
        throw new Error(`unknown argument: ${arg}`);
    }

    if (!options.payloadDir) {
        throw new Error('--payload-dir is required');
    }

    return options;
}

async function listFilesRec(absDir) {
    const entries = await readdir(absDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absPath = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFilesRec(absPath)));
            continue;
        }
        if (entry.isFile()) {
            files.push(absPath);
        }
    }

    return files;
}

function validateManifest(manifest, target) {
    const errors = [];

    for (const field of REQUIRED_MANIFEST_FIELDS) {
        if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
            errors.push(`missing manifest field: ${field}`);
        }
    }

    if (!Array.isArray(manifest.sync_targets)) {
        errors.push('manifest field sync_targets must be an array');
        return errors;
    }

    if (BLOCKED_PRODUCERS.has(manifest.producer)) {
        errors.push(`blocked payload producer: ${manifest.producer}`);
    }

    if (BLOCKED_PAYLOAD_PROFILES.has(manifest.payload_profile)) {
        errors.push(`blocked payload profile: ${manifest.payload_profile}`);
    }

    if (target && !manifest.sync_targets.some((entry) => entry?.id === target)) {
        errors.push(`manifest does not declare sync target: ${target}`);
    }

    return errors;
}

async function scanForBannedMarkers(payloadDir) {
    const matches = [];
    const files = await listFilesRec(payloadDir);

    for (const absPath of files) {
        if (!TEXT_FILE_EXTENSIONS.has(path.extname(absPath))) {
            continue;
        }

        const relPath = path.relative(payloadDir, absPath).replaceAll('\\', '/');
        const content = await readFile(absPath, 'utf8');

        for (const marker of BANNED_MARKERS) {
            if (content.includes(marker)) {
                matches.push({ marker, relPath });
            }
        }
    }

    return matches;
}

async function main() {
    const { payloadDir, target } = parseArgs(process.argv.slice(2));
    const manifestPath = path.join(payloadDir, 'build-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    const manifestErrors = validateManifest(manifest, target);
    const markerMatches = await scanForBannedMarkers(payloadDir);

    console.log(`[payload-check] payload directory: ${payloadDir}`);
    console.log(`[payload-check] target: ${target ?? 'unspecified'}`);
    console.log(`[payload-check] producer: ${manifest.producer ?? 'missing'}`);
    console.log(`[payload-check] payload profile: ${manifest.payload_profile ?? 'missing'}`);
    console.log(`[payload-check] entry document: ${manifest.entry_document ?? 'missing'}`);
    console.log(`[payload-check] entry script: ${manifest.entry_script ?? 'missing'}`);
    console.log(`[payload-check] worker mode: ${manifest.pyodide_worker_mode ?? 'missing'}`);
    console.log(`[payload-check] pyodide asset: ${manifest.pyodide_asset_path ?? 'missing'} (${manifest.pyodide_asset_mode ?? 'missing'})`);

    if (manifestErrors.length === 0 && markerMatches.length === 0) {
        console.log('[payload-check] result: PASS');
        return;
    }

    for (const error of manifestErrors) {
        console.log(`[payload-check] violation: ${error}`);
    }

    for (const match of markerMatches) {
        console.log(`[payload-check] blocked marker: ${JSON.stringify(match.marker)} in ${match.relPath}`);
    }

    console.log('[payload-check] result: FAIL');
    process.exitCode = 1;
}

main().catch((error) => {
    console.error('[payload-check] result: FAIL');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});