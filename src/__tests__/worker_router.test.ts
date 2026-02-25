import { describe, it, expect, vi } from 'vitest';
import type { PyodideInterface } from '../types';
import {
    handleBlake3Hash,
    handleSign,
    handleVerify,
    routeMessage,
} from '../worker_router';

// ── Mock PyodideInterface factory ────────────────────────────────────────────

function makeMockPyodide(runPythonAsyncImpl?: (code: string) => Promise<unknown>): PyodideInterface {
    return {
        loadPackage: vi.fn(),
        pyimport: vi.fn(),
        runPythonAsync: vi.fn(runPythonAsyncImpl ?? (() => Promise.resolve(undefined))),
        unpackArchive: vi.fn(),
    };
}

// ── handleBlake3Hash ─────────────────────────────────────────────────────────

describe('handleBlake3Hash', () => {
    it('returns blake3_result with hex string from pyodide', async () => {
        const mockHex = 'deadbeef01234567';
        const pyodide = makeMockPyodide(() => Promise.resolve(mockHex));

        const result = await handleBlake3Hash('req-1', 'hello world', pyodide);

        expect(result.type).toBe('blake3_result');
        expect(result).toHaveProperty('hex', mockHex);
        expect(result.id).toBe('req-1');
    });

    it('passes data as JSON-encoded Python string in the code', async () => {
        const pyodide = makeMockPyodide(() => Promise.resolve('aa'));
        await handleBlake3Hash('id', 'test "data"', pyodide);

        const calledCode = (pyodide.runPythonAsync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(calledCode).toContain('"test \\"data\\""');
    });
});

// ── handleSign ───────────────────────────────────────────────────────────────

describe('handleSign', () => {
    it('returns sign_result with signature and publicKey (plain array)', async () => {
        const mockTuple = ['aabbcc', 'pubkey112233'];
        const pyodide = makeMockPyodide(() => Promise.resolve(mockTuple));

        const result = await handleSign('req-2', 'message to sign', pyodide);

        expect(result.type).toBe('sign_result');
        expect(result).toHaveProperty('signature', 'aabbcc');
        expect(result).toHaveProperty('publicKey', 'pubkey112233');
    });

    it('calls toJs() on PyProxy result and destroys it', async () => {
        const destroy = vi.fn();
        const mockProxy = {
            toJs: () => ['sig', 'pk'],
            destroy,
        };
        const pyodide = makeMockPyodide(() => Promise.resolve(mockProxy));

        const result = await handleSign('req-3', 'msg', pyodide);

        expect(destroy).toHaveBeenCalledOnce();
        expect(result).toHaveProperty('signature', 'sig');
    });
});

// ── handleVerify ─────────────────────────────────────────────────────────────

describe('handleVerify', () => {
    it('returns verify_result with valid=true for matching signature', async () => {
        const pyodide = makeMockPyodide(() => Promise.resolve(true));

        const result = await handleVerify('req-4', 'msg', 'sig', 'pk', pyodide);

        expect(result.type).toBe('verify_result');
        expect(result).toHaveProperty('valid', true);
    });

    it('returns verify_result with valid=false for bad signature', async () => {
        const pyodide = makeMockPyodide(() => Promise.resolve(false));

        const result = await handleVerify('req-5', 'msg', 'badsig', 'pk', pyodide);

        expect(result).toHaveProperty('valid', false);
    });

    it('extracts boolean from PyProxy via toJs()', async () => {
        const destroy = vi.fn();
        const mockProxy = { toJs: () => true, destroy };
        const pyodide = makeMockPyodide(() => Promise.resolve(mockProxy));

        const result = await handleVerify('req-6', 'msg', 'sig', 'pk', pyodide);

        expect(destroy).toHaveBeenCalledOnce();
        expect(result).toHaveProperty('valid', true);
    });
});

// ── routeMessage ─────────────────────────────────────────────────────────────

describe('routeMessage', () => {
    it('returns error when worker is not booted', async () => {
        const pyodide = makeMockPyodide();
        const result = await routeMessage(
            { id: 'x', type: 'blake3_hash', data: 'hello' },
            pyodide,
            false,
        );
        expect(result.type).toBe('error');
        expect((result as { error: string }).error).toMatch(/not initialized/i);
    });

    it('returns error when pyodide is null', async () => {
        const result = await routeMessage(
            { id: 'x', type: 'blake3_hash', data: 'hello' },
            null,
            true,
        );
        expect(result.type).toBe('error');
    });

    it('routes blake3_hash → handleBlake3Hash', async () => {
        const pyodide = makeMockPyodide(() => Promise.resolve('cafebabe'));
        const result = await routeMessage(
            { id: 'r1', type: 'blake3_hash', data: 'test' },
            pyodide,
            true,
        );
        expect(result.type).toBe('blake3_result');
        expect(result).toHaveProperty('hex', 'cafebabe');
    });

    it('routes sign → handleSign', async () => {
        const pyodide = makeMockPyodide(() => Promise.resolve(['sig', 'pk']));
        const result = await routeMessage(
            { id: 'r2', type: 'sign', message: 'hello' },
            pyodide,
            true,
        );
        expect(result.type).toBe('sign_result');
    });

    it('routes verify → handleVerify (valid=true)', async () => {
        const pyodide = makeMockPyodide(() => Promise.resolve(true));
        const result = await routeMessage(
            { id: 'r3', type: 'verify', message: 'msg', signature: 'sig', publicKey: 'pk' },
            pyodide,
            true,
        );
        expect(result.type).toBe('verify_result');
        expect(result).toHaveProperty('valid', true);
    });
});
