import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const VALIDATOR = path.join(PROJECT_DIR, 'tools/validate-runtime-requirements-compatibility.mjs');
const CANONICAL_CONFIG = path.join(PROJECT_DIR, 'runtime-platform-config.json');
const PAYLOAD_SOURCE = path.join(PROJECT_DIR, 'WebPayload');
const V1_FIXTURE = path.join(PROJECT_DIR, 'tools/fixtures/runtime-requirements-v1.json');
const V2_FIXTURE = path.join(PROJECT_DIR, 'tools/fixtures/runtime-requirements-v2.json');
let PAYLOAD_DIR;

before(async () => {
    PAYLOAD_DIR = await mkdtemp(path.join(tmpdir(), 'rrc-fixture-'));
    await cp(PAYLOAD_SOURCE, PAYLOAD_DIR, { recursive: true });
    const requirements = await readFile(V2_FIXTURE);
    await writeFile(path.join(PAYLOAD_DIR, 'contracts/runtime-requirements.json'), requirements);
    const manifestPath = path.join(PAYLOAD_DIR, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const entry = manifest.files.find((file) => file.path === 'contracts/runtime-requirements.json');
    entry.bytes = requirements.length;
    entry.sha256 = createHash('sha256').update(requirements).digest('hex');
    await writeFile(manifestPath, JSON.stringify(manifest));
});

after(async () => {
    if (PAYLOAD_DIR) await rm(PAYLOAD_DIR, { recursive: true, force: true });
});

function runValidator(args = []) {
    try {
        execFileSync('node', [VALIDATOR, ...args], {
            cwd: PROJECT_DIR,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { passed: true };
    } catch (err) {
        return { passed: false, stderr: (err.stderr || '').toString() };
    }
}

async function withTempDir(fn) {
    const dir = await mkdtemp(path.join(tmpdir(), 'rrc-test-'));
    try {
        await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * Create a temporary payload directory with a mutated manifest and/or
 * requirements file. Returns the temp dir path.
 */
async function withMutatedPayload(mutations) {
    const dir = await mkdtemp(path.join(tmpdir(), 'rrc-payload-'));
    await cp(PAYLOAD_DIR, dir, { recursive: true });
    if (mutations.manifest) {
        const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
        mutations.manifest(m);
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
    }
    if (mutations.requirements) {
        const rr = JSON.parse(await readFile(path.join(dir, 'contracts/runtime-requirements.json'), 'utf8'));
        mutations.requirements(rr);
        const rrText = JSON.stringify(rr);
        await writeFile(path.join(dir, 'contracts/runtime-requirements.json'), rrText);
        if (mutations.updateInventory !== false) {
            const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
            const entry = m.files.find((f) => f.path === 'contracts/runtime-requirements.json');
            if (entry) {
                entry.bytes = Buffer.byteLength(rrText, 'utf8');
                entry.sha256 = createHash('sha256').update(rrText).digest('hex');
                await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
            }
        }
    }
    return dir;
}

// --- Positive ---

test('checked-in config remains compatible with the v1 contract', async () => {
    const fixture = JSON.parse(await readFile(V1_FIXTURE, 'utf8'));
    const dir = await withMutatedPayload({
        requirements(rr) {
            for (const key of Object.keys(rr)) delete rr[key];
            Object.assign(rr, fixture);
        },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(result.passed, `Expected v1 compatibility: ${result.stderr}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('valid v2 contract is rejected when the host has no verified HTTPS service policy', () => {
    const result = runValidator(['--payload', PAYLOAD_DIR, '--config', CANONICAL_CONFIG]);
    assert.equal(result.passed, false);
    assert.match(result.stderr, /wallet_service_https.*not verified/);
    assert.match(result.stderr, /does not declare support.*v2/);
});

test('compatibility evaluation is deterministic', () => {
    const r1 = runValidator(['--payload', PAYLOAD_DIR, '--config', CANONICAL_CONFIG]);
    const r2 = runValidator(['--payload', PAYLOAD_DIR, '--config', CANONICAL_CONFIG]);
    assert.equal(r1.passed, r2.passed);
});

// --- Negative: discovery ---

test('missing contracts descriptor is rejected', async () => {
    await withTempDir(async (dir) => {
        const manifest = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(JSON.stringify(require('${path.join(PAYLOAD_DIR, 'manifest.json')}'),null,2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        delete manifest.contracts;
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /descriptor.*missing/);
    });
});

test('non-conventional descriptor path is rejected', async () => {
    await withTempDir(async (dir) => {
        const manifest = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(JSON.stringify(require('${path.join(PAYLOAD_DIR, 'manifest.json')}'),null,2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        manifest.contracts.runtime_requirements.path = 'other/path.json';
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /conventional/);
    });
});

// --- Negative: byte integrity ---

test('byte-count mismatch is rejected', async () => {
    await withTempDir(async (dir) => {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(path.join(dir, 'contracts'), { recursive: true });
        const manifest = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(JSON.stringify(require('${path.join(PAYLOAD_DIR, 'manifest.json')}'),null,2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const entry = manifest.files.find((f) => f.path === 'contracts/runtime-requirements.json');
        entry.bytes = 99999;
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
        await writeFile(path.join(dir, 'contracts/runtime-requirements.json'), execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync('${path.join(PAYLOAD_DIR, 'contracts/runtime-requirements.json')}','utf8'))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /byte.count/i);
    });
});

// --- Negative: semantic ---

test('unsupported requirements schema is rejected', async () => {
    await withTempDir(async (dir) => {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(path.join(dir, 'contracts'), { recursive: true });
        const manifest = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(JSON.stringify(require('${path.join(PAYLOAD_DIR, 'manifest.json')}'),null,2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const rr = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync('${path.join(PAYLOAD_DIR, 'contracts/runtime-requirements.json')}','utf8'))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        rr.schema = 'com.other.v99';
        const rrText = JSON.stringify(rr);
        const entry = manifest.files.find((f) => f.path === 'contracts/runtime-requirements.json');
        entry.bytes = Buffer.byteLength(rrText, 'utf8');
        entry.sha256 = execFileSync('node', ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(${JSON.stringify(rrText)}).digest('hex'))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
        await writeFile(path.join(dir, 'contracts/runtime-requirements.json'), rrText);
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /Unsupported requirements schema/);
    });
});

test('schema and version must agree', async () => {
    const dir = await withMutatedPayload({ requirements(rr) { rr.version = 1; } });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.equal(result.passed, false);
        assert.match(result.stderr, /Unsupported requirements version/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('unknown required capability is rejected', async () => {
    await withTempDir(async (dir) => {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(path.join(dir, 'contracts'), { recursive: true });
        const manifest = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(JSON.stringify(require('${path.join(PAYLOAD_DIR, 'manifest.json')}'),null,2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const rr = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync('${path.join(PAYLOAD_DIR, 'contracts/runtime-requirements.json')}','utf8'))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        rr.capabilities.unknown_cap = { required: true, description: 'Unknown' };
        const rrText = JSON.stringify(rr);
        const entry = manifest.files.find((f) => f.path === 'contracts/runtime-requirements.json');
        entry.bytes = Buffer.byteLength(rrText, 'utf8');
        entry.sha256 = execFileSync('node', ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(${JSON.stringify(rrText)}).digest('hex'))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
        await writeFile(path.join(dir, 'contracts/runtime-requirements.json'), rrText);
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /Unknown required capability/);
    });
});

// --- Negative: inventory ---

test('missing inventory entry is rejected', async () => {
    const dir = await withMutatedPayload({
        manifest(m) { m.files = m.files.filter((f) => f.path !== 'contracts/runtime-requirements.json'); },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /not found in.*inventory/i);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('duplicate inventory entry is rejected', async () => {
    const dir = await withMutatedPayload({
        manifest(m) { m.files.push({ ...m.files.find((f) => f.path === 'contracts/runtime-requirements.json') }); },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /appears.*times/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// --- Negative: byte integrity ---

test('digest mismatch is rejected', async () => {
    const dir = await withMutatedPayload({
        manifest(m) {
            const entry = m.files.find((f) => f.path === 'contracts/runtime-requirements.json');
            entry.sha256 = '0'.repeat(64);
        },
        updateInventory: false,
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /SHA-256 mismatch/i);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('missing requirements file is rejected', async () => {
    const dir = await withMutatedPayload({});
    try {
        await rm(path.join(dir, 'contracts/runtime-requirements.json'));
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.equal(result.passed, false);
        assert.match(result.stderr, /Cannot read requirements artifact/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('invalid UTF-8 is rejected', async () => {
    const dir = await withMutatedPayload({
        manifest(m) {
            const entry = m.files.find((f) => f.path === 'contracts/runtime-requirements.json');
            const badBytes = Buffer.from([0xFF, 0x7B, 0x7D, 0x0A]);
            entry.bytes = badBytes.length;
            entry.sha256 = createHash('sha256').update(badBytes).digest('hex');
        },
    });
    try {
        const badBytes = Buffer.from([0xFF, 0x7B, 0x7D, 0x0A]);
        await writeFile(path.join(dir, 'contracts/runtime-requirements.json'), badBytes);
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /not valid UTF-8/i);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// --- Negative: semantic ---

test('wrong producer is rejected', async () => {
    const dir = await withMutatedPayload({
        requirements(rr) { rr.producer = 'other-app'; },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /producer/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('unsupported payload profile is rejected', async () => {
    const dir = await withMutatedPayload({
        requirements(rr) { rr.payload_profile = 'other-profile'; },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /payload_profile/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('missing required capability in producer is rejected', async () => {
    const dir = await withMutatedPayload({
        requirements(rr) { delete rr.capabilities.stable_origin_across_launches; },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /Missing required capability/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('missing requirements collections are rejected', async () => {
    for (const field of ['capabilities', 'forbidden_behaviors']) {
        const dir = await withMutatedPayload({ requirements(rr) { delete rr[field]; } });
        try {
            const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
            assert.equal(result.passed, false);
            assert.match(result.stderr, new RegExp(`Requirements ${field} must be`));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
});

test('unknown forbidden behavior is rejected', async () => {
    const dir = await withMutatedPayload({
        requirements(rr) { rr.forbidden_behaviors.push('unknown_behavior'); },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /Unknown forbidden behavior/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('missing forbidden behavior is rejected', async () => {
    const dir = await withMutatedPayload({
        requirements(rr) { rr.forbidden_behaviors = rr.forbidden_behaviors.filter((f) => f !== 'remote_runtime_acquisition'); },
    });
    try {
        const result = runValidator(['--payload', dir, '--config', CANONICAL_CONFIG]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /Missing forbidden behavior/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('platform mechanism conflict is rejected', async () => {
    const badConfig = path.join(tmpdir(), 'bad-config.json');
    try {
        const cfg = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(JSON.stringify(require('${CANONICAL_CONFIG}'),null,2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        cfg.network.policy = 'allow-some';
        await writeFile(badConfig, JSON.stringify(cfg));
        const result = runValidator(['--payload', PAYLOAD_DIR, '--config', badConfig]);
        assert.ok(!result.passed);
        assert.match(result.stderr, /compatibility failure/);
        assert.match(result.stderr, /no verified policy separates bundled runtime code from service data/);
    } finally {
        await rm(badConfig, { force: true });
    }
});

test('declaring v2 support cannot bypass missing service and runtime isolation', async () => {
    await withTempDir(async (dir) => {
        const cfg = JSON.parse(await readFile(CANONICAL_CONFIG, 'utf8'));
        cfg.requirements_compatibility.supported_schemas.push('fort.runtime-requirements.v2');
        cfg.network.policy = 'allow-some';
        const config = path.join(dir, 'config.json');
        await writeFile(config, JSON.stringify(cfg));
        const result = runValidator(['--payload', PAYLOAD_DIR, '--config', config]);
        assert.equal(result.passed, false);
        assert.match(result.stderr, /wallet_service_https.*not verified/);
        assert.match(result.stderr, /no verified policy separates bundled runtime code from service data/);
        assert.match(result.stderr, /no verified policy rejects cleartext wallet-service traffic/);
    });
});

test('platform must declare the required payload profile', async () => {
    await withTempDir(async (dir) => {
        const cfg = JSON.parse(await readFile(CANONICAL_CONFIG, 'utf8'));
        cfg.requirements_compatibility.supported_profiles = [];
        const config = path.join(dir, 'config.json');
        await writeFile(config, JSON.stringify(cfg));
        const result = runValidator(['--payload', PAYLOAD_DIR, '--config', config]);
        assert.equal(result.passed, false);
        assert.match(result.stderr, /does not declare support for profile 'offline-runtime'/);
    });
});
