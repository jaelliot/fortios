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
        list: vi.fn(async (prefix: string) => Object.entries(store)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value }))),
        close: vi.fn(),
    };
}

function makeMockKVFactory(stores: Record<string, Record<string, string>> = {}): KVFactory {
    const cache = new Map<string, WorkerKV>();

    const factory = ((store: string) => {
        const existing = cache.get(store);
        if (existing) return existing;

        const kv = makeMockKV(stores[store] ?? (stores[store] = {}));
        cache.set(store, kv);
        return kv;
    }) as KVFactory;

    factory.close = vi.fn();
    return factory;
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
            { id: 'r4', type: 'db_put', store: 'profile', key: 'k', value: 'v' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_put_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('routes db_get → handleDbGet', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({ profile: { k: 'loaded' } });
        const result = await routeMessage(
            { id: 'r5', type: 'db_get', store: 'profile', key: 'k' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_get_result');
        expect(result).toHaveProperty('value', 'loaded');
    });

    it('routes db_del → handleDbDel', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({ profile: { k: 'val' } });
        const result = await routeMessage(
            { id: 'r6', type: 'db_del', store: 'profile', key: 'k' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_del_result');
        expect(result).toHaveProperty('ok', true);
    });

    it('routes db_list → handleDbList', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({ profile: { alice: 'A', bob: 'B' } });
        const result = await routeMessage(
            { id: 'r7', type: 'db_list', store: 'profile', prefix: 'a' },
            pyodide,
            true,
            kvFactory,
        );
        expect(result.type).toBe('db_list_result');
        if (result.type !== 'db_list_result') throw new Error('unreachable');
        expect(result.entries).toEqual([{ key: 'alice', value: 'A' }]);
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

    it('calls store-scoped kv.set with key and value', async () => {
        const kvFactory = makeMockKVFactory();
        const kv = kvFactory('profile');
        await handleDbPut('id', 'profile', 'mykey', 'myval', kvFactory);

        expect(kv.set).toHaveBeenCalledWith('mykey', 'myval');
    });

    it('throws when kvFactory is null (ephemeral mode)', async () => {
        await expect(handleDbPut('id', 'profile', 'k', 'v', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbGet ──────────────────────────────────────────────────────────────

describe('handleDbGet', () => {
    it('returns db_get_result with string value', async () => {
        const kvFactory = makeMockKVFactory({ profile: { '1': '{"name":"alice"}' } });

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
        await expect(handleDbGet('id', 'profile', 'k', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbDel ──────────────────────────────────────────────────────────────

describe('handleDbDel', () => {
    it('returns db_del_result with ok=true when key existed', async () => {
        const kvFactory = makeMockKVFactory({ profile: { '1': 'data' } });

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
        await expect(handleDbDel('id', 'profile', 'k', null)).rejects.toThrow(/IndexedDB not available/);
    });
});

// ── handleDbList ─────────────────────────────────────────────────────────────

describe('handleDbList', () => {
    it('returns db_list_result entries for a prefix', async () => {
        const kvFactory = makeMockKVFactory({
            names: {
                'personal^alice': 'EAlice',
                'personal^bob': 'EBob',
                'work^carol': 'ECarol',
            },
        });

        const result = await handleDbList('req-db7', 'names', 'personal^', kvFactory);

        expect(result.type).toBe('db_list_result');
        if (result.type !== 'db_list_result') throw new Error('unreachable');
        expect(result.entries).toEqual([
            { key: 'personal^alice', value: 'EAlice' },
            { key: 'personal^bob', value: 'EBob' },
        ]);
    });

    it('returns all entries for an empty prefix', async () => {
        const kvFactory = makeMockKVFactory({ habs: { 'primary.hab': '{"pre":"E1"}', 'test.hab': '{"pre":"E2"}' } });

        const result = await handleDbList('req-db8', 'habs', '', kvFactory);

        expect(result.type).toBe('db_list_result');
        if (result.type !== 'db_list_result') throw new Error('unreachable');
        expect(result.entries).toEqual([
            { key: 'primary.hab', value: '{"pre":"E1"}' },
            { key: 'test.hab', value: '{"pre":"E2"}' },
        ]);
    });

    it('throws when kvFactory is null (ephemeral mode)', async () => {
        await expect(handleDbList('id', 'names', '', null)).rejects.toThrow(/IndexedDB not available/);
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
    it('saved data is returned by get', async () => {
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
            { id: 'db-rt6', type: 'db_put', store: 'profile', key: 'k', value: 'v1' },
            pyodide,
            true,
            kvFactory,
        );
        await routeMessage(
            { id: 'db-rt7', type: 'db_put', store: 'profile', key: 'k', value: 'v2' },
            pyodide,
            true,
            kvFactory,
        );

        const loadRes = await routeMessage(
            { id: 'db-rt8', type: 'db_get', store: 'profile', key: 'k' },
            pyodide,
            true,
            kvFactory,
        );
        expect(loadRes).toHaveProperty('value', 'v2');
    });

    it('keeps stores isolated during list operations', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory({
            names: { 'personal^alice': 'EAlice' },
            habs: { 'personal^alice': '{"pre":"EAlice"}' },
        });

        const result = await routeMessage(
            { id: 'db-rt9', type: 'db_list', store: 'names', prefix: '' },
            pyodide,
            true,
            kvFactory,
        );

        expect(result.type).toBe('db_list_result');
        if (result.type !== 'db_list_result') throw new Error('unreachable');
        expect(result.entries).toEqual([{ key: 'personal^alice', value: 'EAlice' }]);
    });

    it('models FortWeb registry and per-vault store names without widening the contract', async () => {
        const pyodide = makeMockPyodide();
        const kvFactory = makeMockKVFactory();
        const registryStore = 'fortweb-vault-registry:vaults.';
        const vaultStateStore = 'fortweb-vault-alpha:kfst.';

        await routeMessage(
            {
                id: 'fw-1',
                type: 'db_put',
                store: registryStore,
                key: 'alpha',
                value: '{"id":"alpha","opened":true}',
            },
            pyodide,
            true,
            kvFactory,
        );
        await routeMessage(
            {
                id: 'fw-2',
                type: 'db_put',
                store: vaultStateStore,
                key: 'state',
                value: '{"status":"ready"}',
            },
            pyodide,
            true,
            kvFactory,
        );

        const registryRes = await routeMessage(
            { id: 'fw-3', type: 'db_list', store: registryStore, prefix: '' },
            pyodide,
            true,
            kvFactory,
        );
        const stateRes = await routeMessage(
            { id: 'fw-4', type: 'db_get', store: vaultStateStore, key: 'state' },
            pyodide,
            true,
            kvFactory,
        );

        expect(registryRes.type).toBe('db_list_result');
        if (registryRes.type !== 'db_list_result') throw new Error('unreachable');
        expect(registryRes.entries).toEqual([{ key: 'alpha', value: '{"id":"alpha","opened":true}' }]);

        expect(stateRes.type).toBe('db_get_result');
        expect(stateRes).toHaveProperty('value', '{"status":"ready"}');
    });
});

// ── WorkerKV.close() ─────────────────────────────────────────────────────────

describe('WorkerKV.close()', () => {
    it('is callable without side effects on the mock', () => {
        const kv = makeMockKV({ k: 'v' });
        expect(() => kv.close()).not.toThrow();
        expect(kv.close).toHaveBeenCalledOnce();
    });

    it('does not prevent subsequent operations on mock KV', async () => {
        const kv = makeMockKV({ k: 'v' });
        kv.close();
        const value = await kv.get('k');
        expect(value).toBe('v');
    });
});
