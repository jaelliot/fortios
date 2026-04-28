import { describe, expect, it, vi } from 'vitest';
import type { PyodideInterface } from '../types';
import type { KVFactory, WorkerKV } from '../worker_router';
import {
    handleBlake3Hash,
    handleDbDel,
    handleDbGet,
    handleDbList,
    handleDbPut,
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

// ── Mock KVFactory ───────────────────────────────────────────────────────────

function makeMockKVFactory(backing: Record<string, string> = {}): KVFactory {
    const cache = new Map<string, WorkerKV>();

    function makeKV(storeName: string): WorkerKV {
        const prefix = `${storeName}/`;
        return {
            get: vi.fn(async (key: string) => backing[prefix + key] ?? null),
            set: vi.fn(async (key: string, value: string) => { backing[prefix + key] = value; }),
            del: vi.fn(async (key: string) => {
                const fullKey = prefix + key;
                const existed = fullKey in backing;
                delete backing[fullKey];
                return existed;
            }),
            list: vi.fn(async (scanPrefix: string) => {
                const fullPrefix = prefix + scanPrefix;
                return Object.entries(backing)
                    .filter(([k]) => k.startsWith(fullPrefix))
                    .map(([k, v]) => ({ key: k.slice(prefix.length), value: v }));
            }),
            close: vi.fn(),
        };
    }

    return {
        kv: vi.fn((storeName: string) => {
            let instance = cache.get(storeName);
            if (!instance) {
                instance = makeKV(storeName);
                cache.set(storeName, instance);
            }
            return instance;
        }),
        close: vi.fn(),
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

    it('routes db_put → handleDbPut', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory();
        const result = await routeMessage(
            { id: 'r4', type: 'db_put', store: 'test', key: 'k', value: 'v' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_put_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('routes db_get → handleDbGet', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({ 'test/k': 'loaded' });
        const result = await routeMessage(
            { id: 'r5', type: 'db_get', store: 'test', key: 'k' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_get_result');
        expect(result).toHaveProperty('value', 'loaded');
    });

    it('routes db_del → handleDbDel', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({ 'test/k': 'val' });
        const result = await routeMessage(
            { id: 'r6', type: 'db_del', store: 'test', key: 'k' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_del_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('routes db_list → handleDbList', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({ 'test/user:1': 'a', 'test/user:2': 'b', 'test/other': 'c' });
        const result = await routeMessage(
            { id: 'r7', type: 'db_list', store: 'test', prefix: 'user:' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_list_result');
        expect(result).toHaveProperty('entries');
        if (result.type === 'db_list_result') {
            expect(result.entries).toHaveLength(2);
            expect(result.entries.map(e => e.key).sort()).toEqual(['user:1', 'user:2']);
        }
    });
});

// ── handleDbPut ──────────────────────────────────────────────────────────────

describe('handleDbPut', () => {
    it('returns db_put_result with ok=true on success', async () => {
        const kvFactory = makeMockKVFactory();

        const result = await handleDbPut('req-db1', 'profile', '1', '{"name":"alice"}', kvFactory);

        expect(result.type).toBe('db_put_result');
        expect(result).toHaveProperty('ok', true);
        expect(result.id).toBe('req-db1');
    });

    it('calls kv.set with key and value via factory', async () => {
        const kvFactory = makeMockKVFactory();
        await handleDbPut('id', 'mystore', 'mykey', 'myval', kvFactory);

        const storeKV = kvFactory.kv('mystore');
        expect(storeKV.set).toHaveBeenCalledWith('mykey', 'myval');
    });

    it('throws when kvFactory is null (ephemeral mode)', async () => {
        await expect(handleDbPut('id', 's', 'k', 'v', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbGet ──────────────────────────────────────────────────────────────

describe('handleDbGet', () => {
    it('returns db_get_result with string value', async () => {
        const kvFactory = makeMockKVFactory({ 'profile/1': '{"name":"alice"}' });

        const result = await handleDbGet('req-db2', 'profile', '1', kvFactory);

        expect(result.type).toBe('db_get_result');
        expect(result).toHaveProperty('value', '{"name":"alice"}');
    });

    it('returns null when key is missing', async () => {
        const kvFactory = makeMockKVFactory({});

        const result = await handleDbGet('req-db3', 'profile', 'missing', kvFactory);

        expect(result.type).toBe('db_get_result');
        expect(result).toHaveProperty('value', null);
    });

    it('throws when kvFactory is null (ephemeral mode)', async () => {
        await expect(handleDbGet('id', 's', 'k', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbDel ──────────────────────────────────────────────────────────────

describe('handleDbDel', () => {
    it('returns db_del_result with ok=true when key existed', async () => {
        const kvFactory = makeMockKVFactory({ 'profile/1': 'data' });

        const result = await handleDbDel('req-db5', 'profile', '1', kvFactory);

        expect(result.type).toBe('db_del_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('returns ok=false when key did not exist', async () => {
        const kvFactory = makeMockKVFactory({});

        const result = await handleDbDel('req-db6', 'profile', 'nonexistent', kvFactory);

        expect(result).toHaveProperty('ok', false);
    });

    it('throws when kvFactory is null (ephemeral mode)', async () => {
        await expect(handleDbDel('id', 's', 'k', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbList ─────────────────────────────────────────────────────────────

describe('handleDbList', () => {
    it('returns matching entries for prefix', async () => {
        const kvFactory = makeMockKVFactory({ 'data/user:1': 'a', 'data/user:2': 'b', 'data/admin:1': 'c' });

        const result = await handleDbList('req-db7', 'data', 'user:', kvFactory);

        expect(result.type).toBe('db_list_result');
        if (result.type === 'db_list_result') {
            expect(result.entries).toHaveLength(2);
            expect(result.entries.map(e => e.key).sort()).toEqual(['user:1', 'user:2']);
        }
    });

    it('returns empty array when no keys match', async () => {
        const kvFactory = makeMockKVFactory({});

        const result = await handleDbList('req-db8', 'data', 'nope:', kvFactory);

        expect(result.type).toBe('db_list_result');
        if (result.type === 'db_list_result') {
            expect(result.entries).toHaveLength(0);
        }
    });

    it('throws when kvFactory is null (ephemeral mode)', async () => {
        await expect(handleDbList('id', 's', 'p', null)).rejects.toThrow(/IndexedDB not available/);
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

// ── IndexedDB put → get → del round-trip ────────────────────────────────────

describe('IndexedDB put → get → del round-trip', () => {
    it('put data is returned by get', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory();
        const profile = JSON.stringify({ name: 'Alice', note: 'KERI controller' });

        await routeMessage(
            { id: 'db-rt1', type: 'db_put', store: 'profile', key: 'alice', value: profile },
            pyodide,
            true,
            kvFactory,
        );

        const loadRes = await routeMessage(
            { id: 'db-rt2', type: 'db_get', store: 'profile', key: 'alice' },
            pyodide,
            true,
            kvFactory,
        );
        expect(loadRes.type).toBe('db_get_result');
        expect(loadRes).toHaveProperty('value', profile);
    });

    it('deleted data returns null on get', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory();

        await routeMessage(
            { id: 'db-rt3', type: 'db_put', store: 'profile', key: 'bob', value: '{"name":"Bob"}' },
            pyodide,
            true,
            kvFactory,
        );

        const delRes = await routeMessage(
            { id: 'db-rt4', type: 'db_del', store: 'profile', key: 'bob' },
            pyodide,
            true,
            kvFactory,
        );
        expect(delRes).toHaveProperty('ok', true);

        const loadRes = await routeMessage(
            { id: 'db-rt5', type: 'db_get', store: 'profile', key: 'bob' },
            pyodide,
            true,
            kvFactory,
        );
        expect(loadRes).toHaveProperty('value', null);
    });

    it('overwrite replaces old value', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory();

        await routeMessage(
            { id: 'db-rt6', type: 'db_put', store: 's', key: 'k', value: 'v1' },
            pyodide,
            true,
            kvFactory,
        );
        await routeMessage(
            { id: 'db-rt7', type: 'db_put', store: 's', key: 'k', value: 'v2' },
            pyodide,
            true,
            kvFactory,
        );

        const loadRes = await routeMessage(
            { id: 'db-rt8', type: 'db_get', store: 's', key: 'k' },
            pyodide,
            true,
            kvFactory,
        );
        expect(loadRes).toHaveProperty('value', 'v2');
    });
});

// ── KVFactory.close() ────────────────────────────────────────────────────────

describe('KVFactory.close()', () => {
    it('is callable without side effects on the mock', () => {
        const kvFactory = makeMockKVFactory({ 'test/k': 'v' });
        expect(() => kvFactory.close()).not.toThrow();
        expect(kvFactory.close).toHaveBeenCalledOnce();
    });

    it('does not prevent subsequent operations on mock KV', async () => {
        const kvFactory = makeMockKVFactory({ 'test/k': 'v' });
        kvFactory.close();
        const value = await kvFactory.kv('test').get('k');
        expect(value).toBe('v');
    });
});
