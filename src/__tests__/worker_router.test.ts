import { describe, expect, it, vi } from 'vitest';
import type { PyodideInterface } from '../types';
import type { WorkerKV } from '../worker_router';
import {
    handleBlake3Hash,
    handleDbDelete,
    handleDbLoad,
    handleDbSave,
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

// ── Mock WorkerKV factory ────────────────────────────────────────────────────

function makeMockKV(store: Record<string, string> = {}): WorkerKV {
    return {
        get: vi.fn(async (key: string) => store[key] ?? null),
        set: vi.fn(async (key: string, value: string) => { store[key] = value; }),
        del: vi.fn(async (key: string) => {
            const existed = key in store;
            delete store[key];
            return existed;
        }),
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

    it('routes db_save → handleDbSave', async () => {
        const pyodide = makeMockPyodide();
        const kv = makeMockKV();
        const result = await routeMessage(
            { id: 'r4', type: 'db_save', key: 'k', value: 'v' },
            pyodide,
            true,
            kv,
        );
        expect(result.type).toBe('db_save_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('routes db_load → handleDbLoad', async () => {
        const pyodide = makeMockPyodide();
        const kv = makeMockKV({ k: 'loaded' });
        const result = await routeMessage(
            { id: 'r5', type: 'db_load', key: 'k' },
            pyodide,
            true,
            kv,
        );
        expect(result.type).toBe('db_load_result');
        expect(result).toHaveProperty('value', 'loaded');
    });

    it('routes db_delete → handleDbDelete', async () => {
        const pyodide = makeMockPyodide();
        const kv = makeMockKV({ k: 'val' });
        const result = await routeMessage(
            { id: 'r6', type: 'db_delete', key: 'k' },
            pyodide,
            true,
            kv,
        );
        expect(result.type).toBe('db_delete_result');
        expect(result).toHaveProperty('ok', true);
    });
});

// ── handleDbSave ─────────────────────────────────────────────────────────────

describe('handleDbSave', () => {
    it('returns db_save_result with ok=true on success', async () => {
        const kv = makeMockKV();

        const result = await handleDbSave('req-db1', 'profile:1', '{"name":"alice"}', kv);

        expect(result.type).toBe('db_save_result');
        expect(result).toHaveProperty('ok', true);
        expect(result.id).toBe('req-db1');
    });

    it('calls kv.set with key and value', async () => {
        const kv = makeMockKV();
        await handleDbSave('id', 'mykey', 'myval', kv);

        expect(kv.set).toHaveBeenCalledWith('mykey', 'myval');
    });

    it('throws when kv is null (ephemeral mode)', async () => {
        await expect(handleDbSave('id', 'k', 'v', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbLoad ─────────────────────────────────────────────────────────────

describe('handleDbLoad', () => {
    it('returns db_load_result with string value', async () => {
        const kv = makeMockKV({ 'profile:1': '{"name":"alice"}' });

        const result = await handleDbLoad('req-db2', 'profile:1', kv);

        expect(result.type).toBe('db_load_result');
        expect(result).toHaveProperty('value', '{"name":"alice"}');
    });

    it('returns null when key is missing', async () => {
        const kv = makeMockKV({});

        const result = await handleDbLoad('req-db3', 'missing', kv);

        expect(result.type).toBe('db_load_result');
        expect(result).toHaveProperty('value', null);
    });

    it('throws when kv is null (ephemeral mode)', async () => {
        await expect(handleDbLoad('id', 'k', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbDelete ───────────────────────────────────────────────────────────

describe('handleDbDelete', () => {
    it('returns db_delete_result with ok=true when key existed', async () => {
        const kv = makeMockKV({ 'profile:1': 'data' });

        const result = await handleDbDelete('req-db5', 'profile:1', kv);

        expect(result.type).toBe('db_delete_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('returns ok=false when key did not exist', async () => {
        const kv = makeMockKV({});

        const result = await handleDbDelete('req-db6', 'nonexistent', kv);

        expect(result).toHaveProperty('ok', false);
    });

    it('throws when kv is null (ephemeral mode)', async () => {
        await expect(handleDbDelete('id', 'k', null)).rejects.toThrow(/IndexedDB not available/);
    });
});
 
// ── sign → verify round-trip ────────────────────────────────────────────────

describe('sign → verify round-trip', () => {
    it('sign output feeds directly into verify (plain values)', async () => {
        const mockSig = 'aabb0011deadbeef';
        const mockPk = 'ccdd2233cafebabe';
        const message = 'hello KERI';

        // sign returns [sig, pk]; verify returns true
        const pyodide = makeMockPyodide(async (code: string) => {
            if (code.includes('crypto_sign_detached')) return [mockSig, mockPk];
            if (code.includes('crypto_sign_verify_detached')) return true;
            return undefined;
        });

        const signRes = await routeMessage(
            { id: 'rt-1', type: 'sign', message },
            pyodide,
            true,
        );
        expect(signRes.type).toBe('sign_result');
        if (signRes.type !== 'sign_result') throw new Error('unreachable');

        const verifyRes = await routeMessage(
            {
                id: 'rt-2',
                type: 'verify',
                message,
                signature: signRes.signature,
                publicKey: signRes.publicKey,
            },
            pyodide,
            true,
        );
        expect(verifyRes.type).toBe('verify_result');
        expect(verifyRes).toHaveProperty('valid', true);
    });

    it('sign output feeds into verify (PyProxy values)', async () => {
        const mockSig = 'ff001122';
        const mockPk = '33445566';

        const pyodide = makeMockPyodide(async (code: string) => {
            if (code.includes('crypto_sign_detached')) {
                return { toJs: () => [mockSig, mockPk], destroy: vi.fn() };
            }
            if (code.includes('crypto_sign_verify_detached')) {
                return { toJs: () => true, destroy: vi.fn() };
            }
            return undefined;
        });

        const signRes = await routeMessage(
            { id: 'rt-3', type: 'sign', message: 'test' },
            pyodide,
            true,
        );
        if (signRes.type !== 'sign_result') throw new Error('unreachable');

        const verifyRes = await routeMessage(
            {
                id: 'rt-4',
                type: 'verify',
                message: 'test',
                signature: signRes.signature,
                publicKey: signRes.publicKey,
            },
            pyodide,
            true,
        );
        expect(verifyRes).toHaveProperty('valid', true);
    });

    it('verify rejects tampered message', async () => {
        const pyodide = makeMockPyodide(async (code: string) => {
            if (code.includes('crypto_sign_detached')) return ['sig123', 'pk456'];
            if (code.includes('crypto_sign_verify_detached')) return false;
            return undefined;
        });

        const signRes = await routeMessage(
            { id: 'rt-5', type: 'sign', message: 'original' },
            pyodide,
            true,
        );
        if (signRes.type !== 'sign_result') throw new Error('unreachable');

        const verifyRes = await routeMessage(
            {
                id: 'rt-6',
                type: 'verify',
                message: 'tampered',
                signature: signRes.signature,
                publicKey: signRes.publicKey,
            },
            pyodide,
            true,
        );
        expect(verifyRes).toHaveProperty('valid', false);
    });
});

// ── IndexedDB save → load → delete round-trip ───────────────────────────────

describe('IndexedDB save → load → delete round-trip', () => {
    it('saved data is returned by load', async () => {
        const pyodide = makeMockPyodide();
        const kv = makeMockKV();
        const profile = JSON.stringify({ name: 'Alice', note: 'KERI controller' });

        await routeMessage(
            { id: 'db-rt1', type: 'db_save', key: 'profile:alice', value: profile },
            pyodide,
            true,
            kv,
        );

        const loadRes = await routeMessage(
            { id: 'db-rt2', type: 'db_load', key: 'profile:alice' },
            pyodide,
            true,
            kv,
        );
        expect(loadRes.type).toBe('db_load_result');
        expect(loadRes).toHaveProperty('value', profile);
    });

    it('deleted data returns null on load', async () => {
        const pyodide = makeMockPyodide();
        const kv = makeMockKV();

        await routeMessage(
            { id: 'db-rt3', type: 'db_save', key: 'profile:bob', value: '{"name":"Bob"}' },
            pyodide,
            true,
            kv,
        );

        const delRes = await routeMessage(
            { id: 'db-rt4', type: 'db_delete', key: 'profile:bob' },
            pyodide,
            true,
            kv,
        );
        expect(delRes).toHaveProperty('ok', true);

        const loadRes = await routeMessage(
            { id: 'db-rt5', type: 'db_load', key: 'profile:bob' },
            pyodide,
            true,
            kv,
        );
        expect(loadRes).toHaveProperty('value', null);
    });

    it('overwrite replaces old value', async () => {
        const pyodide = makeMockPyodide();
        const kv = makeMockKV();

        await routeMessage(
            { id: 'db-rt6', type: 'db_save', key: 'k', value: 'v1' },
            pyodide,
            true,
            kv,
        );
        await routeMessage(
            { id: 'db-rt7', type: 'db_save', key: 'k', value: 'v2' },
            pyodide,
            true,
            kv,
        );

        const loadRes = await routeMessage(
            { id: 'db-rt8', type: 'db_load', key: 'k' },
            pyodide,
            true,
            kv,
        );
        expect(loadRes).toHaveProperty('value', 'v2');
    });
});
