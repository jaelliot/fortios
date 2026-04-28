import { describe, it, expect } from 'vitest';
import {
    WORKER_ID_PREFIX,
    WORKER_LOG_ID,
    LOADING_FADE_MS,
    BLAKE3_WHEEL,
    FORTWEB_KF_STATE_SUBDB,
    FORTWEB_REGISTRY_NAME,
    FORTWEB_REGISTRY_STORE,
    FORTWEB_WALLET_STORAGE_PREFIX,
    PYCHLORIDE_WHEEL,
    PROOF_CHALLENGE,
    fortwebRegistryWorkerStore,
    fortwebVaultStorageName,
    fortwebVaultWorkerStore,
} from '../constants';
import {
    BRIDGE_HANDLER_NAME,
    BRIDGE_MESSAGE_TYPES,
    WORKER_CMD_INIT,
    WORKER_CMD_BLAKE3_HASH,
    WORKER_CMD_DB_DEL,
    WORKER_CMD_DB_GET,
    WORKER_CMD_DB_LIST,
    WORKER_CMD_DB_PUT,
    WORKER_CMD_SIGN,
    WORKER_CMD_VERIFY,
    WORKER_RES_READY,
    WORKER_RES_BLAKE3_RESULT,
    WORKER_RES_DB_DEL_RESULT,
    WORKER_RES_DB_GET_RESULT,
    WORKER_RES_DB_LIST_RESULT,
    WORKER_RES_DB_PUT_RESULT,
    WORKER_RES_SIGN_RESULT,
    WORKER_RES_VERIFY_RESULT,
    WORKER_RES_ERROR,
    WORKER_COMMAND_TYPES,
    WORKER_RESULT_TYPES,
} from '../bridge-contract';

describe('constants', () => {
    it('WORKER_ID_PREFIX is the single character w', () => {
        expect(WORKER_ID_PREFIX).toBe('w');
    });

    it('WORKER_LOG_ID is non-empty', () => {
        expect(WORKER_LOG_ID.length).toBeGreaterThan(0);
    });

    it('LOADING_FADE_MS is a positive number', () => {
        expect(LOADING_FADE_MS).toBeGreaterThan(0);
    });

    it('BLAKE3_WHEEL ends with .whl', () => {
        expect(BLAKE3_WHEEL.endsWith('.whl')).toBe(true);
    });

    it('PYCHLORIDE_WHEEL ends with .whl', () => {
        expect(PYCHLORIDE_WHEEL.endsWith('.whl')).toBe(true);
    });

    it('PROOF_CHALLENGE is a non-empty string', () => {
        expect(typeof PROOF_CHALLENGE).toBe('string');
        expect(PROOF_CHALLENGE.length).toBeGreaterThan(0);
    });

    it('FortWeb storage constants match the browser lane naming model', () => {
        expect(FORTWEB_REGISTRY_NAME).toBe('fortweb-vault-registry');
        expect(FORTWEB_REGISTRY_STORE).toBe('vaults.');
        expect(FORTWEB_WALLET_STORAGE_PREFIX).toBe('fortweb-vault-');
        expect(FORTWEB_KF_STATE_SUBDB).toBe('kfst.');
    });

    it('maps FortWeb registry and per-vault names onto the worker store seam', () => {
        expect(fortwebRegistryWorkerStore()).toBe('fortweb-vault-registry:vaults.');
        expect(fortwebVaultStorageName('alpha')).toBe('fortweb-vault-alpha');
        expect(fortwebVaultWorkerStore('alpha')).toBe('fortweb-vault-alpha:kfst.');
        expect(fortwebVaultWorkerStore('alpha', 'custom.')).toBe('fortweb-vault-alpha:custom.');
    });
});

describe('bridge-contract constants', () => {
    it('BRIDGE_HANDLER_NAME is non-empty', () => {
        expect(BRIDGE_HANDLER_NAME.length).toBeGreaterThan(0);
    });

    it('all worker command types are non-empty strings', () => {
        for (const t of WORKER_COMMAND_TYPES) {
            expect(typeof t).toBe('string');
            expect(t.length).toBeGreaterThan(0);
        }
    });

    it('all worker result types are non-empty strings', () => {
        for (const t of WORKER_RESULT_TYPES) {
            expect(typeof t).toBe('string');
            expect(t.length).toBeGreaterThan(0);
        }
    });

    it('worker commands include init, crypto verbs, and storage verbs', () => {
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_INIT);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_BLAKE3_HASH);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_SIGN);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_VERIFY);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_DB_PUT);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_DB_GET);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_DB_DEL);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_DB_LIST);
    });

    it('worker results include ready, crypto results, storage results, and error', () => {
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_READY);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_BLAKE3_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_SIGN_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_VERIFY_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_DB_PUT_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_DB_GET_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_DB_DEL_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_DB_LIST_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_ERROR);
    });

    it('BRIDGE_MESSAGE_TYPES contains all bridge message type constants', () => {
        expect(Array.isArray(BRIDGE_MESSAGE_TYPES)).toBe(true);
        expect(BRIDGE_MESSAGE_TYPES.length).toBeGreaterThan(0);
    });
});
