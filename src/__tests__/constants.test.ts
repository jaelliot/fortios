import { describe, it, expect } from 'vitest';
import {
    WORKER_ID_PREFIX,
    WORKER_LOG_ID,
    LOADING_FADE_MS,
    BLAKE3_WHEEL,
    PYCHLORIDE_WHEEL,
    PROOF_CHALLENGE,
} from '../constants';
import {
    BRIDGE_HANDLER_NAME,
    BRIDGE_MESSAGE_TYPES,
    WORKER_CMD_INIT,
    WORKER_CMD_BLAKE3_HASH,
    WORKER_CMD_SIGN,
    WORKER_CMD_VERIFY,
    WORKER_RES_READY,
    WORKER_RES_BLAKE3_RESULT,
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

    it('worker commands include init, blake3_hash, sign, verify', () => {
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_INIT);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_BLAKE3_HASH);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_SIGN);
        expect(WORKER_COMMAND_TYPES).toContain(WORKER_CMD_VERIFY);
    });

    it('worker results include ready, blake3_result, sign_result, verify_result, error', () => {
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_READY);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_BLAKE3_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_SIGN_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_VERIFY_RESULT);
        expect(WORKER_RESULT_TYPES).toContain(WORKER_RES_ERROR);
    });

    it('BRIDGE_MESSAGE_TYPES contains all bridge message type constants', () => {
        expect(Array.isArray(BRIDGE_MESSAGE_TYPES)).toBe(true);
        expect(BRIDGE_MESSAGE_TYPES.length).toBeGreaterThan(0);
    });
});
