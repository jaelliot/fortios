import {
    FORTWEB_KF_STATE_SUBDB,
    FORTWEB_REGISTRY_STORE,
    LOADING_FADE_MS,
    PROOF_CHALLENGE,
    fortwebRegistryWorkerStore,
    fortwebVaultStorageName,
    fortwebVaultWorkerStore,
} from './constants';
import {
    generateId,
    initPyodide,
    installGlobalErrorHooks,
    installNativeCommandHandler,
    isoNow,
    onWorkerLog,
    postToBridge,
    sendToWorker,
} from './keri_runtime';

// Legacy proof-harness entry point. This file is still useful for worker-seam
// validation, but it is not the authoritative FortWeb-hosted product path.

// ── DOM helpers ───────────────────────────────────────────────────────────────
const loadingEl = document.getElementById('loading');
const loadingStatusEl = document.getElementById('loading-status');
const appEl = document.getElementById('app');
const statusEl = document.getElementById('status');
const statusDotEl = document.getElementById('status-dot');
const outputEl = document.getElementById('output');

// Profile form elements for the local seam-validation lane.
const profileIdEl = document.getElementById('profile-id') as HTMLInputElement | null;
const profileNameEl = document.getElementById('profile-name') as HTMLInputElement | null;
const profileNoteEl = document.getElementById('profile-note') as HTMLTextAreaElement | null;
const btnSaveEl = document.getElementById('btn-save');
const btnLoadEl = document.getElementById('btn-load');
const dbStatusEl = document.getElementById('db-status');
const recordJsonEl = document.getElementById('record-json');

// Identifiers section elements
const btnSeedEl = document.getElementById('btn-seed');
const btnListIdsEl = document.getElementById('btn-list-ids');
const idStatusEl = document.getElementById('id-status');
const idListEl = document.getElementById('id-list');

function setLoadingStatus(text: string): void {
    if (loadingStatusEl) loadingStatusEl.textContent = text;
}

function showApp(): void {
    if (loadingEl) loadingEl.classList.add('hidden');
    // Wait for fade-out transition before showing app
    setTimeout(() => {
        if (loadingEl) loadingEl.style.display = 'none';
        if (appEl) appEl.classList.add('visible');
    }, LOADING_FADE_MS);
}

function setStatus(text: string, state?: 'done' | 'error'): void {
    if (statusEl) statusEl.textContent = text;
    if (statusDotEl) {
        statusDotEl.classList.remove('done', 'error');
        if (state) statusDotEl.classList.add(state);
    }
}

function log(line: string): void {
    if (!outputEl) return;
    outputEl.textContent = `${outputEl.textContent ?? ''}${line}\n`;
}

// ── Profile persistence (IndexedDB via worker) ───────────────────────────────

function setDbStatus(text: string, ok = true): void {
    if (dbStatusEl) {
        dbStatusEl.textContent = `${ok ? '●' : '○'} ${text}`;
        dbStatusEl.style.color = ok ? 'var(--status-done)' : 'var(--status-error)';
    }
}

async function saveProfile(): Promise<void> {
    const id = profileIdEl?.value.trim();
    const name = profileNameEl?.value.trim();
    if (!id) { setDbStatus('Profile ID is required.', false); return; }
    if (!name) { setDbStatus('Name is required.', false); return; }

    const record = {
        id,
        name,
        note: profileNoteEl?.value ?? '',
        updated_at: isoNow(),
    };

    const cmdId = generateId();
    const result = await sendToWorker({
        id: cmdId,
        type: 'db_put',
        store: 'profile',
        key: id,
        value: JSON.stringify(record),
    });

    if (result.type === 'db_put_result' && result.ok) {
        setDbStatus(`Saved profile '${id}'.`);
        if (recordJsonEl) recordJsonEl.textContent = JSON.stringify(record, null, 2);
        log(`saved profile id=${id}`);
    } else {
        setDbStatus(`Save failed: ${result.type === 'error' ? result.error : 'unknown'}`, false);
    }
}

async function loadProfile(): Promise<void> {
    const id = profileIdEl?.value.trim();
    if (!id) { setDbStatus('Enter a Profile ID to load.', false); return; }

    const cmdId = generateId();
    const result = await sendToWorker({
        id: cmdId,
        type: 'db_get',
        store: 'profile',
        key: id,
    });

    if (result.type === 'db_get_result') {
        if (result.value === null) {
            setDbStatus(`No profile found for '${id}'.`, false);
            if (recordJsonEl) recordJsonEl.textContent = 'No record loaded.';
        } else {
            try {
                const record = JSON.parse(result.value);
                if (profileNameEl) profileNameEl.value = record.name ?? '';
                if (profileNoteEl) profileNoteEl.value = record.note ?? '';
                if (recordJsonEl) recordJsonEl.textContent = JSON.stringify(record, null, 2);
                setDbStatus(`Loaded profile '${id}'.`);
                log(`loaded profile id=${id}`);
            } catch {
                setDbStatus('Stored data is corrupt (invalid JSON).', false);
                if (recordJsonEl) recordJsonEl.textContent = result.value;
            }
        }
    } else {
        setDbStatus(`Load failed: ${result.type === 'error' ? result.error : 'unknown'}`, false);
    }
}

function installProfileHandlers(): void {
    btnSaveEl?.addEventListener('click', () => { void saveProfile(); });
    btnLoadEl?.addEventListener('click', () => { void loadProfile(); });
    setDbStatus('Ready. Enter profile id and name, then Save or Load.');
}

// ── Identifiers proof slice (store-scoped KV demo) ───────────────────────────

function setIdStatus(text: string, ok = true): void {
    if (idStatusEl) {
        idStatusEl.textContent = `${ok ? '●' : '○'} ${text}`;
        idStatusEl.style.color = ok ? 'var(--status-done)' : 'var(--status-error)';
    }
}

/**
 * Seed mock KERI store data that mimics what Locksmith would persist.
 * Uses the stores from STORE-KEY-INVENTORY.md:
 *   - gbls: keeper globals (aeid for existence/encryption check)
 *   - names: alias → prefix mapping (Suber with ^ separator)
 *   - habs: habitat records (Komer with compact JSON)
 *   - stts: key state records
 *   - idm: Locksmith identifier metadata overlay
 */
async function seedTestData(): Promise<void> {
    setIdStatus('Seeding…');

    // Mock AIDs (KERI-style prefixes)
    const aid1 = 'EBmFUI0myoXC_1ldpPhAkXcY46tB410gPGgjfAWJR-Jo';
    const aid2 = 'EDj3BWFbPRCw0JznpFpV2uSfcEKU8aQfS5-ewu4YQ6UM';
    const aid3 = 'EHn3ekdlOHb976jJKF_bxYLxNhipSXUfVFXWvIJ3i1KQ';

    const puts = [
        // Stage 1: Keeper global — vault exists and is encrypted
        { store: 'gbls', key: 'aeid', value: aid1 },

        // Stage 2: Name→prefix mappings (Suber uses ^ separator for namespace^alias)
        { store: 'names', key: 'personal^alice', value: aid1 },
        { store: 'names', key: 'personal^bob-delegator', value: aid2 },
        { store: 'names', key: 'work^acme-corp', value: aid3 },

        // Habitat records (compact JSON, mirrors Komer serialization)
        { store: 'habs', key: 'personal^alice', value: JSON.stringify({
            hid: aid1, mid: null, smids: null, rmids: null,
            sid: null, transferable: true, watchers: [],
        }) },
        { store: 'habs', key: 'personal^bob-delegator', value: JSON.stringify({
            hid: aid2, mid: null, smids: [aid1, aid2], rmids: [aid1, aid2],
            sid: null, transferable: true, watchers: [],
        }) },
        { store: 'habs', key: 'work^acme-corp', value: JSON.stringify({
            hid: aid3, mid: null, smids: null, rmids: null,
            sid: aid1, transferable: true, watchers: [],
        }) },

        // Key state records (minimal current state)
        { store: 'stts', key: aid1, value: JSON.stringify({
            i: aid1, s: '0', d: aid1, kt: '1', k: ['DSuhyBcPZEZLK-fcw5tzHn2N46wRCG_ZOoeKtWTOunRA'],
        }) },
        { store: 'stts', key: aid2, value: JSON.stringify({
            i: aid2, s: '1', d: 'EFdew2349sdf3jlf_sdflj3SD9fjsd9343jlsdf_Sdf',
            kt: '2', k: ['DSuhyBcPZEZLK-fcw5tzHn2N46wRCG_ZOoeKtWTOunRA', 'DVcuJOOJF1IE8svqEtrSuyQjGTd2HhfAkt9y2QkUtFJI'],
        }) },
        { store: 'stts', key: aid3, value: JSON.stringify({
            i: aid3, s: '0', d: aid3, kt: '1', k: ['DHr0-I-mMN7h6cLMOTRJkkfPuMd0vgQPrOk4Y3edaHjr'],
        }) },

        // Stage 3: Locksmith overlay — identifier metadata
        { store: 'idm', key: aid1, value: JSON.stringify({ prefix: aid1, auth_pending: false }) },
        { store: 'idm', key: aid2, value: JSON.stringify({ prefix: aid2, auth_pending: true }) },
        { store: 'idm', key: aid3, value: JSON.stringify({ prefix: aid3, auth_pending: false }) },
    ];

    for (const { store, key, value } of puts) {
        const result = await sendToWorker({
            id: generateId(), type: 'db_put', store, key, value,
        });
        if (result.type === 'error') {
            setIdStatus(`Seed failed: ${result.error}`, false);
            return;
        }
    }

    setIdStatus(`Seeded ${puts.length} entries across 5 stores.`);
    log(`seeded ${puts.length} test entries`);
}

/**
 * List local identifiers by reading the store-scoped KV:
 *   1. Check gbls/aeid for vault existence
 *   2. db_list on names store (all entries)
 *   3. db_get on habs + stts for each alias
 *   4. db_get on idm for overlay metadata
 *   5. Render into the id-list element
 */
async function listIdentifiers(): Promise<void> {
    setIdStatus('Loading…');
    if (idListEl) idListEl.innerHTML = '';

    // Stage 1: vault existence check
    const aeidRes = await sendToWorker({
        id: generateId(), type: 'db_get', store: 'gbls', key: 'aeid',
    });
    if (aeidRes.type === 'error') {
        setIdStatus(`Error: ${aeidRes.error}`, false);
        return;
    }
    if (aeidRes.type === 'db_get_result' && aeidRes.value === null) {
        setIdStatus('No vault found (gbls/aeid missing). Seed test data first.', false);
        return;
    }

    // Stage 2: list all name→prefix mappings
    const namesRes = await sendToWorker({
        id: generateId(), type: 'db_list', store: 'names', prefix: '',
    });
    if (namesRes.type !== 'db_list_result') {
        setIdStatus(`Error listing names: ${namesRes.type === 'error' ? namesRes.error : 'unknown'}`, false);
        return;
    }

    if (namesRes.entries.length === 0) {
        setIdStatus('Vault exists but no identifiers found.', false);
        return;
    }

    // Stage 2+3: resolve each identifier
    for (const entry of namesRes.entries) {
        const alias = entry.key;        // e.g. "personal^alice"
        const prefix = entry.value;     // e.g. "EBmFUI0my..."

        // Get habitat record
        const habRes = await sendToWorker({
            id: generateId(), type: 'db_get', store: 'habs', key: alias,
        });

        // Get key state
        const sttsRes = await sendToWorker({
            id: generateId(), type: 'db_get', store: 'stts', key: prefix,
        });

        // Get Locksmith overlay metadata
        const idmRes = await sendToWorker({
            id: generateId(), type: 'db_get', store: 'idm', key: prefix,
        });

        // Parse records
        let hab: Record<string, unknown> | null = null;
        let stts: Record<string, unknown> | null = null;
        let idm: Record<string, unknown> | null = null;

        if (habRes.type === 'db_get_result' && habRes.value) {
            try { hab = JSON.parse(habRes.value); } catch { /* ignore */ }
        }
        if (sttsRes.type === 'db_get_result' && sttsRes.value) {
            try { stts = JSON.parse(sttsRes.value); } catch { /* ignore */ }
        }
        if (idmRes.type === 'db_get_result' && idmRes.value) {
            try { idm = JSON.parse(idmRes.value); } catch { /* ignore */ }
        }

        // Render
        const li = document.createElement('li');
        const parts = alias.split('^');
        const namespace = parts[0] ?? '';
        const name = parts[1] ?? alias;

        const isMultisig = hab && Array.isArray(hab.smids) && (hab.smids as unknown[]).length > 1;
        const isDelegated = hab && hab.sid != null;
        const authPending = idm && idm.auth_pending === true;
        const seqNo = stts ? String(stts.s ?? '?') : '?';
        const sigThreshold = stts ? String(stts.kt ?? '?') : '?';

        const tags: string[] = [];
        if (isMultisig) tags.push('multisig');
        if (isDelegated) tags.push('delegated');
        if (authPending) tags.push('⚠ auth pending');

        const aliasEl = document.createElement('div');
        aliasEl.className = 'id-alias';
        aliasEl.textContent = name;

        if (tags.length > 0) {
            aliasEl.appendChild(document.createTextNode(' '));

            const tagsEl = document.createElement('small');
            tagsEl.textContent = `(${tags.join(', ')})`;
            aliasEl.appendChild(tagsEl);
        }

        const prefixEl = document.createElement('div');
        prefixEl.className = 'id-prefix';
        prefixEl.textContent = prefix;

        const stateEl = document.createElement('div');
        stateEl.className = 'id-state';
        stateEl.textContent = `${namespace} · seq ${seqNo} · threshold ${sigThreshold}`;

        li.append(aliasEl, prefixEl, stateEl);
        idListEl?.appendChild(li);
    }

    setIdStatus(`${namesRes.entries.length} identifier${namesRes.entries.length !== 1 ? 's' : ''} loaded.`);
    log(`listed ${namesRes.entries.length} identifiers from names store`);
}

function installIdentifierHandlers(): void {
    btnSeedEl?.addEventListener('click', () => { void seedTestData(); });
    btnListIdsEl?.addEventListener('click', () => { void listIdentifiers(); });
    setIdStatus('Tap "Seed Test Data" then "List Identifiers".');
}

async function putWorkerValue(store: string, key: string, value: string): Promise<void> {
    const result = await sendToWorker({ id: generateId(), type: 'db_put', store, key, value });
    if (result.type !== 'db_put_result' || !result.ok) {
        throw new Error(result.type === 'error' ? result.error : `unexpected worker result: ${result.type}`);
    }
}

async function getWorkerValue(store: string, key: string): Promise<string | null> {
    const result = await sendToWorker({ id: generateId(), type: 'db_get', store, key });
    if (result.type !== 'db_get_result') {
        throw new Error(result.type === 'error' ? result.error : `unexpected worker result: ${result.type}`);
    }
    return result.value;
}

async function listWorkerValues(store: string, prefix: string): Promise<Array<{ key: string; value: string }>> {
    const result = await sendToWorker({ id: generateId(), type: 'db_list', store, prefix });
    if (result.type !== 'db_list_result') {
        throw new Error(result.type === 'error' ? result.error : `unexpected worker result: ${result.type}`);
    }
    return result.entries;
}

async function deleteWorkerValue(store: string, key: string): Promise<void> {
    const result = await sendToWorker({ id: generateId(), type: 'db_del', store, key });
    if (result.type !== 'db_del_result') {
        throw new Error(result.type === 'error' ? result.error : `unexpected worker result: ${result.type}`);
    }
}

// Validate one real FortWeb storage slice on the live worker seam: registry entry
// plus per-vault key-state data using the same naming model FortWeb uses.
async function runFortwebStorageProof(): Promise<void> {
    const vaultId = 'proof-alpha';
    const registryStore = fortwebRegistryWorkerStore();
    const vaultStateStore = fortwebVaultWorkerStore(vaultId);
    const createdAt = isoNow();
    const registryValue = JSON.stringify({
        id: vaultId,
        alias: 'Proof Alpha',
        storageName: fortwebVaultStorageName(vaultId),
        runtimeMode: 'pyodide-worker',
        createdAt,
    });
    const stateValue = JSON.stringify({
        status: 'ready',
        vaultId,
        updatedAt: createdAt,
    });

    log(`fortweb storage seam check: registry=${registryStore} vaultState=${vaultStateStore}`);

    try {
        await putWorkerValue(registryStore, vaultId, registryValue);
        await putWorkerValue(vaultStateStore, 'state', stateValue);

        const registryEntries = await listWorkerValues(registryStore, '');
        const registryEntry = registryEntries.find((entry) => entry.key === vaultId);
        if (!registryEntry || registryEntry.value !== registryValue) {
            throw new Error(`FortWeb registry seam check failed for ${FORTWEB_REGISTRY_STORE}${vaultId}`);
        }

        const loadedState = await getWorkerValue(vaultStateStore, 'state');
        if (loadedState !== stateValue) {
            throw new Error(`FortWeb vault state seam check failed for ${FORTWEB_KF_STATE_SUBDB}state`);
        }

        log(`fortweb storage seam check: registry + ${FORTWEB_KF_STATE_SUBDB} state round-trip ok`);
    } finally {
        await deleteWorkerValue(vaultStateStore, 'state');
        await deleteWorkerValue(registryStore, vaultId);
        log('fortweb storage seam check: cleaned validation records');
    }
}

// ── Boot-time proof ───────────────────────────────────────────────────────────
async function runProof(): Promise<void> {
    const probe = PROOF_CHALLENGE;

    const hashId = generateId();
    const hashRes = await sendToWorker({ id: hashId, type: 'blake3_hash', data: probe });
    log(`blake3: ${hashRes.type === 'blake3_result' ? hashRes.hex : `(error: ${hashRes.type === 'error' ? hashRes.error : hashRes.type})`}`);

    const signId = generateId();
    const signRes = await sendToWorker({ id: signId, type: 'sign', message: probe });
    if (signRes.type !== 'sign_result') { log(`sign failed: ${signRes.type === 'error' ? signRes.error : signRes.type}`); return; }
    const { signature, publicKey } = signRes;
    log(`signed ok, pk: ${publicKey.slice(0, 16)}…`);

    const verifyId = generateId();
    const verifyRes = await sendToWorker({ id: verifyId, type: 'verify', message: probe, signature, publicKey });
    log(`pychloride sign+verify: ${verifyRes.type === 'verify_result' ? verifyRes.valid : false}`);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    installGlobalErrorHooks();
    installNativeCommandHandler();
    onWorkerLog(log);
    postToBridge({ type: 'lifecycle', timestamp: isoNow(), message: 'boot' });

    setLoadingStatus('Loading Pyodide…');
    await initPyodide();

    setLoadingStatus('Running seam validation…');
    showApp();
    installProfileHandlers();
    installIdentifierHandlers();

    setStatus('running crypto seam check');
    await runProof();

    setStatus('running fortweb storage seam check');
    await runFortwebStorageProof();

    setStatus('seam validation ready', 'done');
    postToBridge({ type: 'lifecycle', timestamp: isoNow(), message: 'done' });
}

main().catch((e: unknown) => {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    setStatus(err, 'error');
    showApp();
    log(err);
});
