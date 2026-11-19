import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

const source = readFileSync(new URL('../../KeriWalletTests/CoreSediDeviceTests.swift', import.meta.url), 'utf8');
const helper = source.match(/private static let coreHelpers = #"""\n([\s\S]*?)\n    """#/);
assert.ok(helper, 'Core test helpers must be present');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('ctx', 'expected', 'indexedDB', 'crypto',
    `${helper[1]}\nreturn snapshot(ctx, expected);`);
const hex = value => Buffer.from(value).toString('hex');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical)
        : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

function fixture() {
    const binding = { registryId: 'registry', sequence: 1, blinder: 'public', event: 'event' };
    const dbs = {};
    const name = sub => `IDBMap/@fortweb-v2/${sub}`;
    for (const sub of ['kels.', 'evts.', 'sigs.', 'fwpn.', 'fwrc.']) dbs[name(`wallet:${sub}`)] = {};
    for (const sub of ['regs.', 'tels.', 'evts.', 'ancs.', 'heds.']) dbs[name(`acdc-reg:wallet:${sub}`)] = {};
    dbs[name('wallet:fwpn.')][hex('grant')] = hex(JSON.stringify(binding));
    dbs[name('wallet:enst.')] = Object.fromEntries(['credential', 'agent', 'unit']
        .map((value, index) => [hex(`grant.${index}`), hex(value)]));
    dbs[name('acdc-reg:wallet:evts.')][hex('event')] = hex('tel');
    const expected = {holderAid:'holder', credentialSaid:'credential', registryId:'registry', grantSaid:'grant',
        nodeSaids:['credential','agent','unit'], bindingSequence:0, telHashes:[sha('tel')],
        bindingHash:sha(JSON.stringify(canonical(binding)))};
    const indexedDB = {
        databases: async () => Object.keys(dbs).map(key => ({name:key})),
        open: key => {
            const request = {};
            queueMicrotask(() => {
                request.result = {close() {}, transaction(_store, mode) {
                    assert.equal(mode, 'readonly');
                    return {objectStore: () => ({get: () => {
                        const query = {};
                        queueMicrotask(() => { query.result = JSON.stringify(dbs[key]); query.onsuccess(); });
                        return query;
                    }})};
                }};
                request.onsuccess();
            });
            return request;
        }
    };
    const ctx = {vaultId:'vault', storageName:'wallet', request: async method => {
        if (method === 'identifiers.get') return {identifier:{aid:'holder', sequenceNumber:0, lastEventDigest:'head'}};
        if (method === 'identifiers.export') return {cesr:Buffer.from('kel').toString('base64')};
        if (method === 'credentials.getReceived') return {credential:{said:'credential', issuance:'verified'}, evidence:{}};
        if (method === 'registries.get') return {registry:{registryId:'registry'}};
        if (method === 'ipex.get') return {exchange:{said:'grant'}};
        throw Error(`Unexpected operation ${method}`);
    }};
    return {dbs, name, expected, indexedDB, ctx};
}

test('recovery reads matching signed state without modifying the stores', async () => {
    const f = fixture(), before = JSON.stringify(f.dbs);
    const result = await run(f.ctx, f.expected, f.indexedDB, webcrypto);
    assert.equal(result.holderKelHash, sha('kel'));
    assert.equal(result.nestedHashes.length, 3);
    assert.equal(JSON.stringify(f.dbs), before);
});

test.each([
    ['binding', f => { delete f.dbs[f.name('wallet:fwpn.')][hex('grant')]; }],
    ['changed binding', f => { f.dbs[f.name('wallet:fwpn.')][hex('grant')] = hex('{}'); }],
    ['TEL', f => { f.dbs[f.name('acdc-reg:wallet:evts.')] = {}; }],
    ['nested stream', f => { delete f.dbs[f.name('wallet:enst.')][hex('grant.2')]; }],
    ['credential', f => { const request = f.ctx.request; f.ctx.request = async (...args) => {
        if (args[0] === 'credentials.getReceived') throw Error('missing'); return request(...args);
    }; }],
    ['pending receipt', f => { f.dbs[f.name('wallet:fwrc.')][hex('_pending')] = hex('yes'); }],
    ['pending registry', f => { f.dbs[f.name('acdc-reg:wallet:regs.')][hex('_fortweb_pending')] = hex('yes'); }],
    ['incomplete checkpoint', f => { f.expected.bindingSequence = 1; }],
])('recovery rejects invalid %s', async (_label, mutate) => {
    const f = fixture(); mutate(f);
    await assert.rejects(run(f.ctx, f.expected, f.indexedDB, webcrypto));
});
