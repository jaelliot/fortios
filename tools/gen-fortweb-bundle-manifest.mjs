import { execFile as execFileCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

function parseArgs(argv) {
    const options = {
        payloadRoot: null,
        fortwebDir: null,
        buildCommand: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--payload-root') {
            options.payloadRoot = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--fortweb-dir') {
            options.fortwebDir = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--build-command') {
            options.buildCommand = argv[index + 1];
            index += 1;
            continue;
        }
        throw new Error(`unknown argument: ${arg}`);
    }

    if (!options.payloadRoot || !options.fortwebDir || !options.buildCommand) {
        throw new Error('--payload-root, --fortweb-dir, and --build-command are required');
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

async function hashPayloadTree(payloadRoot) {
    const files = await listFilesRec(payloadRoot);
    files.sort((left, right) => left.localeCompare(right));

    const hash = createHash('sha256');
    for (const absPath of files) {
        const relPath = path.relative(payloadRoot, absPath).replaceAll('\\', '/');
        if (relPath === 'build-manifest.json') {
            continue;
        }

        const fileStat = await stat(absPath);
        if (!fileStat.isFile()) {
            continue;
        }

        hash.update(relPath);
        hash.update('\n');
        hash.update(await readFile(absPath));
        hash.update('\n');
    }

    return hash.digest('hex');
}

async function gitOutput(repoDir, args) {
    try {
        const { stdout } = await execFile('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function readInterpreterPath(fortwebDir) {
    const pyscriptConfig = await readFile(path.join(fortwebDir, 'pyscript-ci.toml'), 'utf8');
    const match = pyscriptConfig.match(/^interpreter\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? '/fortweb/vendor/pyodide/0.29.3/pyodide.mjs';
}

async function main() {
    const { payloadRoot, fortwebDir, buildCommand } = parseArgs(process.argv.slice(2));
    const distTreeSha = await hashPayloadTree(payloadRoot);
    const interpreterPath = await readInterpreterPath(fortwebDir);

    const manifest = {
        schema: 2,
        created_at: new Date().toISOString(),
        package_name: 'fortweb-wallet',
        producer: 'fortweb-shared',
        payload_profile: 'product-shell',
        entry_document: 'fortweb/app/index.html',
        entry_script: 'fortweb/app/app/main.js',
        build_command: buildCommand,
        git_sha: await gitOutput(fortwebDir, ['rev-parse', 'HEAD']),
        source_git_branch: await gitOutput(fortwebDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
        source_git_status: (await gitOutput(fortwebDir, ['status', '--porcelain'])) ? 'dirty' : 'clean',
        node_version: null,
        npm_user_agent: null,
        package_lock_sha256: null,
        pyodide_worker_mode: 'pyscript-pyworker',
        pyodide_asset_path: interpreterPath,
        pyodide_asset_mode: 'esm',
        sync_targets: [
            {
                id: 'ios-webpayload',
                path: 'WebPayload',
                mutations: ['redirect_root_to_fortweb_app'],
            },
            {
                id: 'android-asset-payload',
                path: 'app/src/main/assets/payload',
                mutations: ['redirect_root_to_fortweb_app'],
            },
        ],
        dist_tree_sha256: distTreeSha,
    };

    const outPath = path.join(payloadRoot, 'build-manifest.json');
    await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    console.log(JSON.stringify({
        build_manifest: path.posix.join(path.basename(payloadRoot), 'build-manifest.json'),
        producer: manifest.producer,
        payload_profile: manifest.payload_profile,
        git_sha: manifest.git_sha,
        dist_tree_sha256: manifest.dist_tree_sha256,
    }));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});