import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCb);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const validateMobilePayloadScript = path.join(repoRoot, 'tools', 'validate-mobile-payload.mjs');
const validatePyodideRuntimeScript = path.join(repoRoot, 'tools', 'validate-pyodide-runtime.mjs');
const fortwebManifestScript = path.join(repoRoot, 'tools', 'gen-fortweb-bundle-manifest.mjs');
const tempDirs = [];

async function makeTempDir() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fort-ios-tooling-'));
    tempDirs.push(tempDir);
    return tempDir;
}

async function writeTextFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
}

async function writeJsonFile(filePath, data) {
    await writeTextFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

async function runNodeScript(scriptPath, args) {
    return execFile('node', [scriptPath, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
}

async function runNodeScriptExpectFailure(scriptPath, args) {
    try {
        await runNodeScript(scriptPath, args);
    } catch (error) {
        return error;
    }

    throw new Error(`Expected ${path.basename(scriptPath)} to fail`);
}

function makeSharedManifest(overrides = {}) {
    return {
        producer: 'fortweb-shared',
        payload_profile: 'product-shell',
        entry_document: 'fortweb/app/index.html',
        entry_script: 'fortweb/app/app/main.js',
        build_command: 'PAYLOAD_SOURCE=fortweb ./sync-payload.sh',
        pyodide_worker_mode: 'pyscript-pyworker',
        pyodide_asset_path: '/fortweb/vendor/pyodide/0.29.3/pyodide.mjs',
        pyodide_asset_mode: 'esm',
        sync_targets: [{ id: 'ios-webpayload' }],
        source_git_branch: 'feature/test',
        source_git_status: 'clean',
        ...overrides,
    };
}

afterEach(async () => {
    await Promise.all(
        tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
    );
});

describe('validate-mobile-payload.mjs', () => {
    it('passes for a FortWeb shared payload manifest without blocked markers', async () => {
        const payloadDir = await makeTempDir();
        await writeJsonFile(path.join(payloadDir, 'build-manifest.json'), makeSharedManifest());
        await writeTextFile(path.join(payloadDir, 'fortweb', 'app', 'index.html'), '<h1>KERI Wallet</h1>');

        const { stdout } = await runNodeScript(validateMobilePayloadScript, [
            '--payload-dir',
            payloadDir,
            '--target',
            'ios-webpayload',
        ]);

        expect(stdout).toContain('[payload-check] result: PASS');
    });

    it('fails when the manifest reports a blocked producer and payload profile', async () => {
        const payloadDir = await makeTempDir();
        await writeJsonFile(
            path.join(payloadDir, 'build-manifest.json'),
            makeSharedManifest({
                producer: 'fort-ios-local',
                payload_profile: 'proof-shell',
            })
        );

        const error = await runNodeScriptExpectFailure(validateMobilePayloadScript, [
            '--payload-dir',
            payloadDir,
            '--target',
            'ios-webpayload',
        ]);

        expect(error.stdout).toContain('blocked payload producer: fort-ios-local');
        expect(error.stdout).toContain('blocked payload profile: proof-shell');
    });

    it('fails when the requested sync target is missing from the manifest', async () => {
        const payloadDir = await makeTempDir();
        await writeJsonFile(
            path.join(payloadDir, 'build-manifest.json'),
            makeSharedManifest({
                sync_targets: [{ id: 'android-asset-payload' }],
            })
        );

        const error = await runNodeScriptExpectFailure(validateMobilePayloadScript, [
            '--payload-dir',
            payloadDir,
            '--target',
            'ios-webpayload',
        ]);

        expect(error.stdout).toContain('manifest does not declare sync target: ios-webpayload');
    });

    it('fails when proof-shell markers remain in text payload files', async () => {
        const payloadDir = await makeTempDir();
        await writeJsonFile(path.join(payloadDir, 'build-manifest.json'), makeSharedManifest());
        await writeTextFile(path.join(payloadDir, 'fortweb', 'app', 'index.html'), '<p>Profile ID</p>');

        const error = await runNodeScriptExpectFailure(validateMobilePayloadScript, [
            '--payload-dir',
            payloadDir,
            '--target',
            'ios-webpayload',
        ]);

        expect(error.stdout).toContain('blocked marker: "Profile ID"');
        expect(error.stdout).toContain('[payload-check] result: FAIL');
    });
});

describe('validate-pyodide-runtime.mjs', () => {
    it('passes for a module worker paired with an ESM pyodide asset', async () => {
        const payloadDir = await makeTempDir();
        const workerPath = path.join(payloadDir, 'pyodide_worker.ts');
        const assetPath = path.join(payloadDir, 'pyodide.mjs');

        await writeTextFile(
            workerPath,
            "const pyodideModule = await import('./pyodide.mjs');\nexport const load = pyodideModule.loadPyodide;\n"
        );
        await writeTextFile(assetPath, 'export function loadPyodide() { return true; }\n');

        const { stdout } = await runNodeScript(validatePyodideRuntimeScript, [
            '--worker',
            workerPath,
            '--asset',
            assetPath,
        ]);

        expect(stdout).toContain('[pyodide-check] detected worker mode: module');
        expect(stdout).toContain('[pyodide-check] detected pyodide asset mode: esm');
        expect(stdout).toContain('[pyodide-check] result: PASS');
    });

    it('fails for a classic worker paired with an ESM pyodide asset', async () => {
        const payloadDir = await makeTempDir();
        const workerPath = path.join(payloadDir, 'pyodide_worker.ts');
        const assetPath = path.join(payloadDir, 'pyodide.js');

        await writeTextFile(workerPath, "importScripts('./pyodide.js');\n");
        await writeTextFile(assetPath, 'export function loadPyodide() { return true; }\n');

        const error = await runNodeScriptExpectFailure(validatePyodideRuntimeScript, [
            '--worker',
            workerPath,
            '--asset',
            assetPath,
        ]);

        expect(error.stdout).toContain('[pyodide-check] detected worker mode: classic');
        expect(error.stdout).toContain('[pyodide-check] detected pyodide asset mode: esm');
        expect(error.stdout).toContain('[pyodide-check] result: FAIL');
    });
});

describe('gen-fortweb-bundle-manifest.mjs', () => {
    it('writes the expected wrapper manifest fields for the FortWeb payload', async () => {
        const payloadRoot = await makeTempDir();
        const fortwebDir = await makeTempDir();

        await writeTextFile(path.join(payloadRoot, 'index.html'), '<!doctype html>\n');
        await writeTextFile(path.join(payloadRoot, 'fortweb', 'app', 'index.html'), '<main>fortweb</main>\n');
        await writeTextFile(
            path.join(fortwebDir, 'pyscript-ci.toml'),
            'interpreter = "/fortweb/vendor/pyodide/custom.mjs"\n'
        );

        await runNodeScript(fortwebManifestScript, [
            '--payload-root',
            payloadRoot,
            '--fortweb-dir',
            fortwebDir,
            '--build-command',
            'PAYLOAD_SOURCE=fortweb ./sync-payload.sh',
        ]);

        const manifest = JSON.parse(
            await readFile(path.join(payloadRoot, 'build-manifest.json'), 'utf8')
        );

        expect(manifest.producer).toBe('fortweb-shared');
        expect(manifest.payload_profile).toBe('product-shell');
        expect(manifest.entry_document).toBe('fortweb/app/index.html');
        expect(manifest.pyodide_asset_path).toBe('/fortweb/vendor/pyodide/custom.mjs');
        expect(manifest.pyodide_worker_mode).toBe('pyscript-pyworker');
        expect(manifest.sync_targets.map((entry) => entry.id)).toEqual([
            'ios-webpayload',
            'android-asset-payload',
        ]);
    });
});