import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
    const options = {
        workerPath: path.join(repoRoot, 'src', 'pyodide_worker.ts'),
        assetPath: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--worker') {
            options.workerPath = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--asset') {
            options.assetPath = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        throw new Error(`unknown argument: ${arg}`);
    }

    return options;
}

function detectPyodideAssetName(workerSource) {
    const match = workerSource.match(/pyodide\.(mjs|js)/);
    return match ? `pyodide.${match[1]}` : 'pyodide.js';
}

function detectWorkerMode(workerSource) {
    if (/importScripts\s*\(/.test(workerSource)) {
        return {
            mode: 'classic',
            evidence: 'worker uses importScripts(...) to load Pyodide at runtime',
        };
    }

    if (
        /from\s+['"][^'"]*pyodide\.mjs['"]/.test(workerSource)
        || /import\([\s\S]*pyodide\.mjs[\s\S]*\)/.test(workerSource)
    ) {
        return {
            mode: 'module',
            evidence: 'worker imports pyodide.mjs through ES module loading',
        };
    }

    return {
        mode: 'unknown',
        evidence: 'worker boot path does not match the known classic or module patterns',
    };
}

function detectPyodideAssetMode(assetSource) {
    if (/^\s*export\b/m.test(assetSource) || /\bexport\s*\{/.test(assetSource)) {
        return {
            mode: 'esm',
            evidence: 'asset contains top-level export syntax',
        };
    }

    return {
        mode: 'classic',
        evidence: 'asset does not contain top-level export syntax',
    };
}

function recommendRemediation(workerMode, assetMode) {
    if (workerMode === 'classic' && assetMode === 'esm') {
        return 'Pyodide 0.29 expects module loading. Replace the classic importScripts boot path with a module worker that loads pyodide.mjs, or provide a verified classic-script-compatible Pyodide asset.';
    }

    if (workerMode === 'unknown' || assetMode === 'unknown') {
        return 'Make the worker boot path and Pyodide asset type explicit before building the mobile payload.';
    }

    return 'Worker boot mode and Pyodide asset mode are aligned.';
}

function printResult({ workerPath, assetPath, workerResult, assetResult, passed }) {
    const lines = [
        '[pyodide-check] worker file inspected: ' + workerPath,
        '[pyodide-check] pyodide asset inspected: ' + assetPath,
        '[pyodide-check] detected worker mode: ' + workerResult.mode,
        '[pyodide-check] worker evidence: ' + workerResult.evidence,
        '[pyodide-check] detected pyodide asset mode: ' + assetResult.mode,
        '[pyodide-check] asset evidence: ' + assetResult.evidence,
        '[pyodide-check] result: ' + (passed ? 'PASS' : 'FAIL'),
        '[pyodide-check] recommended remediation: ' + recommendRemediation(workerResult.mode, assetResult.mode),
    ];

    for (const line of lines) {
        console.log(line);
    }
}

async function main() {
    const { workerPath, assetPath } = parseArgs(process.argv.slice(2));
    const workerSource = await readFile(workerPath, 'utf8');
    const resolvedAssetPath = assetPath ?? path.join(repoRoot, 'public', 'pyodide', detectPyodideAssetName(workerSource));
    const assetSource = await readFile(resolvedAssetPath, 'utf8');

    const workerResult = detectWorkerMode(workerSource);
    const assetResult = detectPyodideAssetMode(assetSource);
    const passed = !(workerResult.mode === 'classic' && assetResult.mode === 'esm');

    printResult({ workerPath, assetPath: resolvedAssetPath, workerResult, assetResult, passed });

    if (!passed) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('[pyodide-check] result: FAIL');
    console.error('[pyodide-check] recommended remediation: fix the validation inputs or the worker/asset contract before building.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});