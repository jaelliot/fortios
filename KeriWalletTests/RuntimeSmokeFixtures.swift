import Foundation

extension RuntimeDeviceSmokeTests {
    // Same public fixture used by the producer's registry receipt tests.
    static let schema = #"""
    {"$id":"EPrsJF2BXyDUgDCVbGURsGNwCZjyrxD5M2qnBmhvoZYQ","$schema":"https://json-schema.org/draft/2020-12/schema",
    "title":"ACM Default Schema","description":"Default JSON Schema for acm ACDC.",
    "credentialType":"ACDC_acm_message","version":"2.0.0","type":"object","required":["v","d","i","s"],
    "properties":{"v":{"description":"ACDC version string","type":"string"},
    "t":{"description":"Message type","type":"string"},"d":{"description":"Message SAID","type":"string"},
    "u":{"description":"Message UUID","type":"string"},"i":{"description":"Issuer AID","type":"string"},
    "rd":{"description":"Registry SAID","type":"string"},"s":{"description":"Schema Section","oneOf":[
    {"description":"Schema Section SAID","type":"string"},
    {"description":"Uncompacted Schema Section","type":"object"}]},
    "a":{"description":"Attribute Section","oneOf":[{"description":"Attribute Section SAID","type":"string"},
    {"description":"Uncompacted Attribute Section","type":"object"}]},
    "A":{"description":"Aggregate Section","oneOf":[{"description":"Aggregate Section AGID","type":"string"},
    {"description":"Uncompacted Aggregate Section","type":"array"}]},
    "e":{"description":"Edge Section","oneOf":[{"description":"Edge Section SAID","type":"string"},
    {"description":"Uncompacted Edge Section","type":"object"}]},"r":{"description":"Rule Section","oneOf":[
    {"description":"Rule Section SAID","type":"string"},
    {"description":"Uncompacted Rule Section","type":"object"}]}},
    "additionalProperties":false}
    """#

    static let exerciseRuntime = #"""
    let stage = "initialization";
    let bridge;
    try {
        // Match the producer's test-only config override without changing package bytes.
        const originalFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (...args) => {
            const response = await originalFetch(...args);
            const url = typeof args[0] === "string" ? args[0] : args[0].url;
            if (url === "app://local/pyscript-ci.toml") {
                return { ok: response.ok, status: response.status,
                    text: async () => "fort_synthetic_recipient_testing = true\n" + await response.text() };
            }
            return response;
        };
        const { createRuntimeBridge } = await import("app://local/app/runtime/bridge.js");
        const origin = {
            schema: "fortweb.runtime-origin.v1", version: 1, platform: "ios-wkwebview",
            mode: "bundled-offline", documentOrigin: "app://local", appBaseUrl: "app://local",
            entryUrl: "app://local/app/index.html", workerUrl: "app://local/app/runtime/wallet-worker.py",
            configUrl: "app://local/pyscript-ci.toml",
            storage: { storageNamespace: "keri-wallet-ios", indexedDbRequired: true, originPartition: "app://local/" },
            capabilities: { customScheme: true, httpsLikeAssetOrigin: false, implicitBlobOriginSafe: false,
                networkAllowed: false, bundledAssetsOnly: true }
        };
        const newBridge = () => createRuntimeBridge({ workerUrl: new URL(origin.workerUrl),
            configUrl: new URL(origin.configUrl), runtimeOriginContract: origin });
        bridge = newBridge();
        const request = (method, params = {}) => bridge.request(method, params, 180000);
        const schemaId = JSON.parse(schema).$id;
        const require = (condition) => { if (!condition) throw new Error("assertion failed"); };

        if (persistent && checkpoint.processId && !checkpoint.complete) {
            stage = "restart-process";
            require(checkpoint.processId !== processId);
            stage = "restart-issuer";
            await request("vaults.open", {vaultId: checkpoint.sourceId, passcode: "synthetic-issuer-passcode"});
            const issued = (await request("credentials.getIssued", {vaultId: checkpoint.sourceId,
                name: "registry", requestId: "credential"})).credential;
            const issuer = await request("identifiers.export", {vaultId: checkpoint.sourceId,
                aid: checkpoint.issuerAid});
            require(issued.said === checkpoint.credentialSaid && issued.registryId === checkpoint.registryId &&
                issued.sequence === checkpoint.sequence && issued.head === checkpoint.registryHead &&
                issuer.cesr === checkpoint.issuerKel);
            await request("vaults.close", {vaultId: checkpoint.sourceId});
            stage = "restart-holder";
            await request("vaults.open", {vaultId: checkpoint.holderId, passcode: "synthetic-holder-passcode"});
            const received = await request("credentials.getReceived", {vaultId: checkpoint.holderId,
                syntheticOnly: true, said: checkpoint.credentialSaid});
            const holder = await request("identifiers.export", {vaultId: checkpoint.holderId,
                aid: checkpoint.holderAid});
            const vault = (await request("vaults.list")).vaults.find(item => item.id === checkpoint.holderId);
            require(vault && checkpoint.presentation);
            const hex = value => Array.from(new TextEncoder().encode(value),
                byte => byte.toString(16).padStart(2, "0")).join("");
            const records = async namespace => {
                const name = `IDBMap/@fortweb-v2/${namespace}`;
                require((await indexedDB.databases()).some(item => item.name === name));
                const db = await new Promise((resolve, reject) => {
                    const open = indexedDB.open(name);
                    open.onupgradeneeded = () => open.transaction.abort();
                    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
                });
                try {
                    return JSON.parse(await new Promise((resolve, reject) => {
                        const query = db.transaction("entries", "readonly")
                            .objectStore("entries").get("__records__");
                        query.onsuccess = () => resolve(query.result || "{}");
                        query.onerror = () => reject(query.error);
                    }));
                } finally { db.close(); }
            };
            const saved = (await records(`${vault.storageName}:fwpn.`))[hex(checkpoint.grantSaid)];
            require(saved);
            const storedBinding = JSON.parse(new TextDecoder().decode(Uint8Array.from(
                saved.match(/../g), byte => parseInt(byte, 16))));
            const bound = checkpoint.presentation;
            require(["registryId", "sequence", "blinder", "event"]
                .every(key => storedBinding[key] === bound[key]));
            const registryEvents = Object.values(await records(`acdc-reg:${vault.storageName}:evts.`));
            require(bound.tel.every(event => registryEvents.includes(hex(atob(event)))));
            require(received.credential.issuance === "verified" &&
                received.credential.said === checkpoint.credentialSaid && holder.cesr === checkpoint.holderKel &&
                bound.registryId === checkpoint.presentationRegistryId && bound.head === checkpoint.presentationHead &&
                bound.sequence === checkpoint.presentationSequence && bound.event === checkpoint.presentationEvent);
            await request("vaults.close", {vaultId: checkpoint.holderId});
            stage = "restart-verifier";
            await request("vaults.open", {vaultId: checkpoint.verifierId, passcode: "synthetic-verifier-passcode"});
            const stored = await request("ipex.get", {vaultId: checkpoint.verifierId,
                syntheticOnly: true, said: checkpoint.grantSaid});
            require(stored.exchange.said === checkpoint.grantSaid &&
                stored.exchange.senderAid === checkpoint.holderAid &&
                stored.exchange.recipientAid === checkpoint.verifierAid);
            const verification = {vaultId: checkpoint.verifierId, syntheticOnly: true, cesr: checkpoint.grantCesr,
                evidence: received.evidence, presenterAid: checkpoint.holderAid, verifierAid: checkpoint.verifierAid,
                presentation: bound};
            const verified = await request("ipex.verifyPresentation", verification);
            require(verified.exchange.said === checkpoint.grantSaid &&
                verified.credential.said === checkpoint.credentialSaid && verified.credential.issuance === "verified");
            stage = "restart-corruption";
            let rejected = false;
            try {
                await request("ipex.verifyPresentation", {...verification,
                    presentation: {...bound, grantSaid: checkpoint.credentialSaid}});
            } catch (error) {
                rejected = error?.code === "VALIDATION";
            }
            require(rejected);
            await request("vaults.close", {vaultId: checkpoint.verifierId});
            return {ok: true, phase: "read"};
        }

        const suffix = persistent ? `-${Date.now()}-${processId}` : "";

        stage = "issuer";
        const sourceId = (await request("vaults.create", {
            name: "smoke-issuer" + suffix, passcode: "synthetic-issuer-passcode"})).vault.id;
        await request("vaults.open", {vaultId: sourceId, passcode: "synthetic-issuer-passcode"});
        const issuerAid = (await request("identifiers.create", {vaultId: sourceId, alias: "issuer"})).identifier.aid;
        const issuer = await request("identifiers.export", {vaultId: sourceId, aid: issuerAid});
        stage = "writer-contention";
        const rival = newBridge();
        let contentionRejected = false;
        try {
            await rival.request("identifiers.create", {vaultId: sourceId, alias: "rival"}, 180000);
        } catch (error) {
            contentionRejected = error?.code === "BUSY" && /already open/i.test(error.message);
        } finally {
            rival.destroy();
        }
        require(contentionRejected);
        const identifiers = (await request("identifiers.list", {vaultId: sourceId})).identifiers;
        require(identifiers.some((identifier) => identifier.aid === issuerAid) &&
            identifiers.every((identifier) => identifier.alias !== "rival"));
        await request("vaults.close", {vaultId: sourceId});

        stage = "holder";
        const holderId = (await request("vaults.create", {
            name: "smoke-holder" + suffix, passcode: "synthetic-holder-passcode"})).vault.id;
        await request("vaults.open", {vaultId: holderId, passcode: "synthetic-holder-passcode"});
        const holderAid = (await request("identifiers.create", {vaultId: holderId, alias: "holder"})).identifier.aid;
        const holder = await request("identifiers.export", {vaultId: holderId, aid: holderAid});
        await request("schemas.import", {vaultId: holderId, schemaId, schema});
        await request("remotes.import", {vaultId: holderId, alias: "issuer", cesr: issuer.cesr});
        const presentationRegistry = (await request("registries.create", {vaultId: holderId,
            issuerAid: holderAid, name: "presentations"})).registry;
        await request("vaults.close", {vaultId: holderId});

        stage = "issuance";
        await request("vaults.open", {vaultId: sourceId, passcode: "synthetic-issuer-passcode"});
        await request("remotes.import", {vaultId: sourceId, alias: "holder", cesr: holder.cesr});
        await request("schemas.import", {vaultId: sourceId, schemaId, schema});
        const registry = (await request("registries.create", {
            vaultId: sourceId, issuerAid, name: "registry"})).registry;
        const credential = (await request("credentials.issueRegistered", {vaultId: sourceId, name: "registry",
            requestId: "credential", issuerAid, recipientAid: holderAid, schemaId,
            attributes: {name: "Synthetic Presentation", rd: presentationRegistry.registryId}})).credential;
        require(credential.registryId === registry.registryId && credential.sequence === 1);
        await request("vaults.close", {vaultId: sourceId});
        await request("vaults.open", {vaultId: sourceId, passcode: "synthetic-issuer-passcode"});
        const restored = (await request("credentials.getIssued", {vaultId: sourceId,
            name: "registry", requestId: "credential"})).credential;
        const recovered = restored.said === credential.said && restored.registryId === registry.registryId;
        require(recovered);
        await request("vaults.close", {vaultId: sourceId});

        stage = "receipt";
        await request("vaults.open", {vaultId: holderId, passcode: "synthetic-holder-passcode"});
        const receipt = await request("credentials.receive", {vaultId: holderId, syntheticOnly: true,
            issuerAid, recipientAid: holderAid, schemaId, evidence: credential});
        require(receipt.credential.issuance === "verified");
        await request("vaults.close", {vaultId: holderId});

        stage = "verifier";
        const verifierId = (await request("vaults.create", {
            name: "smoke-verifier" + suffix, passcode: "synthetic-verifier-passcode"})).vault.id;
        await request("vaults.open", {vaultId: verifierId, passcode: "synthetic-verifier-passcode"});
        const verifierAid = (await request("identifiers.create", {
            vaultId: verifierId, alias: "verifier"})).identifier.aid;
        const verifier = await request("identifiers.export", {vaultId: verifierId, aid: verifierAid});
        await request("schemas.import", {vaultId: verifierId, schemaId, schema});
        await request("remotes.import", {vaultId: verifierId, alias: "issuer", cesr: issuer.cesr});
        await request("remotes.import", {vaultId: verifierId, alias: "holder", cesr: holder.cesr});
        await request("vaults.close", {vaultId: verifierId});

        stage = "presentation";
        await request("vaults.open", {vaultId: holderId, passcode: "synthetic-holder-passcode"});
        await request("remotes.import", {vaultId: holderId, alias: "verifier", cesr: verifier.cesr});
        const presentation = await request("ipex.present", {vaultId: holderId, syntheticOnly: true,
            credentialSaid: credential.said, presenterAid: holderAid, verifierAid,
            message: "Synthetic presentation", presentationRegistry: "presentations"});
        require(presentation.exchange.route === "/ipex/grant" &&
            presentation.presentation.grantSaid === presentation.exchange.said &&
            presentation.presentation.registryId === presentationRegistry.registryId);
        await request("vaults.close", {vaultId: holderId});

        stage = "verification";
        await request("vaults.open", {vaultId: verifierId, passcode: "synthetic-verifier-passcode"});
        const verification = {vaultId: verifierId, syntheticOnly: true, cesr: presentation.exchange.cesr,
            evidence: presentation.evidence, presenterAid: holderAid, verifierAid,
            presentation: presentation.presentation};
        let negativeRejected = false;
        try {
            await request("ipex.verifyPresentation", {...verification, presenterAid: issuerAid});
        } catch (error) {
            negativeRejected = error?.code === "VALIDATION" && /holder and presentation parties/i.test(error.message);
        }
        require(negativeRejected);
        let bindingRejected = false;
        try {
            await request("ipex.verifyPresentation", {...verification,
                presentation: {...presentation.presentation, grantSaid: credential.said}});
        } catch (error) {
            bindingRejected = error?.code === "VALIDATION" && /does not bind this Grant/i.test(error.message);
        }
        require(bindingRejected);
        stage = "tamper-recovery";
        const bytes = Uint8Array.from(atob(presentation.exchange.cesr), (value) => value.charCodeAt(0));
        bytes[bytes.length - 1] ^= 1;
        const tampered = btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""));
        let tamperRejected = false;
        try {
            await request("ipex.verifyPresentation", {...verification, cesr: tampered});
        } catch (_) {
            tamperRejected = true;
        }
        require(tamperRejected);
        let failClosed = false;
        try {
            await request("ipex.get", {vaultId: verifierId, syntheticOnly: true, said: presentation.exchange.said});
        } catch (error) {
            failClosed = /persistence failed/i.test(error.message);
        }
        require(failClosed);
        await request("vaults.close", {vaultId: verifierId});
        await request("vaults.open", {vaultId: verifierId, passcode: "synthetic-verifier-passcode"});
        let absent = false;
        try {
            await request("ipex.get", {vaultId: verifierId, syntheticOnly: true, said: presentation.exchange.said});
        } catch (error) {
            absent = /was not found/i.test(error.message);
        }
        const tamperRecovered = failClosed && absent;
        require(tamperRecovered);
        stage = "valid-verification-after-recovery";
        const verified = await request("ipex.verifyPresentation", verification);
        require(verified.exchange.said === presentation.exchange.said && verified.credential.said === credential.said);
        await request("vaults.close", {vaultId: verifierId});
        await request("vaults.open", {vaultId: verifierId, passcode: "synthetic-verifier-passcode"});
        const persisted = await request("ipex.get", {
            vaultId: verifierId, syntheticOnly: true, said: presentation.exchange.said});
        require(persisted.exchange.said === presentation.exchange.said);
        await request("vaults.close", {vaultId: verifierId});
        stage = "worker-restart";
        bridge.destroy();
        bridge = newBridge();
        await request("vaults.open", {vaultId: verifierId, passcode: "synthetic-verifier-passcode"});
        const afterRestart = await request("ipex.get", {
            vaultId: verifierId, syntheticOnly: true, said: presentation.exchange.said});
        const restartRecovered = afterRestart.exchange.said === presentation.exchange.said;
        require(restartRecovered);
        await request("vaults.close", {vaultId: verifierId});
        if (persistent) {
            stage = "persist-checkpoint";
            await request("vaults.open", {vaultId: sourceId, passcode: "synthetic-issuer-passcode"});
            const issuerAfter = await request("identifiers.export", {vaultId: sourceId, aid: issuerAid});
            await request("vaults.close", {vaultId: sourceId});
            await request("vaults.open", {vaultId: holderId, passcode: "synthetic-holder-passcode"});
            const holderAfter = await request("identifiers.export", {vaultId: holderId, aid: holderAid});
            await request("vaults.close", {vaultId: holderId});
            const saved = {processId, sourceId, holderId, verifierId,
                issuerAid, holderAid, verifierAid, credentialSaid: credential.said, registryId: registry.registryId,
                sequence: restored.sequence, registryHead: restored.head, issuerKel: issuerAfter.cesr,
                holderKel: holderAfter.cesr, grantSaid: presentation.exchange.said,
                grantCesr: presentation.exchange.cesr,
                presentation: presentation.presentation,
                presentationRegistryId: presentation.presentation.registryId,
                presentationHead: presentation.presentation.head,
                presentationSequence: presentation.presentation.sequence,
                presentationEvent: presentation.presentation.event};
            return {ok: true, phase: "write", checkpoint: saved};
        }
        return {ok: true, negativeRejected, bindingRejected, tamperRecovered, recovered,
            contentionRejected, restartRecovered};
    } catch (error) {
        return {ok: false, stage, code: typeof error?.code === "string" ? error.code : "ERROR",
            failureClass: /content security|unsafe-eval|EvalError/i.test(String(error?.message))
                ? "csp-eval" : "other"};
    } finally {
        bridge?.destroy();
    }
    """#
}
