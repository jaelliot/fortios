import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function hashFile(absPath) {
  const buf = await readFile(absPath);
  return sha256Hex(buf);
}

async function listFilesRec(absDir) {
  const entries = await readdir(absDir, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listFilesRec(abs)));
      continue;
    }
    if (ent.isFile()) out.push(abs);
  }
  return out;
}

async function hashDistTree(absDistDir) {
  // Deterministic: hash based on relative path + file bytes.
  const files = await listFilesRec(absDistDir);
  files.sort((a, b) => a.localeCompare(b));

  const h = createHash('sha256');
  for (const abs of files) {
    const rel = path.relative(absDistDir, abs).replaceAll('\\', '/');
    const st = await stat(abs);
    if (!st.isFile()) continue;
    const buf = await readFile(abs);
    h.update(rel);
    h.update('\n');
    h.update(buf);
    h.update('\n');
  }
  return h.digest('hex');
}

async function gitOutput(args) {
  try {
    const { stdout } = await execFile('git', ['-C', process.cwd(), ...args], { encoding: 'utf8' });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const distDir = path.resolve(process.cwd(), 'dist');
  const lockfile = path.resolve(process.cwd(), 'package-lock.json');
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const gitSha = (process.env.GITHUB_SHA || process.env.GIT_SHA || '').trim() || await gitOutput(['rev-parse', 'HEAD']) || null;
  const gitBranch = await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']);
  const gitStatus = (await gitOutput(['status', '--porcelain'])) ? 'dirty' : 'clean';
  const nodeVersion = process.version;
  const npmVersion = process.env.npm_config_user_agent || null;

  let lockfileSha256 = null;
  try {
    lockfileSha256 = await hashFile(lockfile);
  } catch {
    // lockfile might not exist locally yet; CI must enforce it.
  }

  const distSha256 = await hashDistTree(distDir);

  const manifest = {
    schema: 2,
    created_at: new Date().toISOString(),
    package_name: packageJson.name ?? null,
    producer: 'fort-ios-local',
    payload_profile: 'proof-shell',
    entry_document: 'index.html',
    entry_script: 'src/main.ts',
    build_command: 'npm run build:ci',
    git_sha: gitSha,
    source_git_branch: gitBranch,
    source_git_status: gitStatus,
    node_version: nodeVersion,
    npm_user_agent: npmVersion,
    pyodide_worker_mode: 'module',
    pyodide_asset_path: 'pyodide/pyodide.mjs',
    pyodide_asset_mode: 'esm',
    sync_targets: [
      {
        id: 'ios-webpayload',
        path: 'WebPayload',
        mutations: ['sanitize_itms_services_python_stdlib'],
      },
      {
        id: 'android-asset-payload',
        path: '../fortoid-scaffold/app/src/main/assets/payload',
        mutations: [],
      },
    ],
    package_lock_sha256: lockfileSha256,
    dist_tree_sha256: distSha256,
  };

  const outPath = path.join(distDir, 'build-manifest.json');
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Emit a single-line summary for CI logs.
  // (Keep it stable; avoid embedding paths.)
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      build_manifest: path.posix.join('dist', 'build-manifest.json'),
      producer: manifest.producer,
      payload_profile: manifest.payload_profile,
      git_sha: manifest.git_sha,
      package_lock_sha256: manifest.package_lock_sha256,
      dist_tree_sha256: manifest.dist_tree_sha256,
      node_version: manifest.node_version,
    })
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
