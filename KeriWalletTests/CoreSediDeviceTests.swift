import CryptoKit
import Foundation
import WebKit
import XCTest

@testable import KeriWallet

@MainActor
final class CoreSediDeviceTests: XCTestCase {
    func testSyntheticCorePresentation() async throws {
        let runID = try verifyPayload()
        let phase = ProcessInfo.processInfo.environment["SEDI_TEST_PHASE"] ?? "single"
        guard ["single", "write", "read"].contains(phase) else {
            XCTFail("Invalid Core test phase")
            throw CocoaError(.validationMissingMandatoryProperty)
        }

        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let directory = documents.appendingPathComponent("sedi-core-qualification-\(runID)", isDirectory: true)
        if phase == "read" {
            let checkpoint = directory.appendingPathComponent("core-checkpoint.json")
            let recovered = directory.appendingPathComponent("process-recovered.json")
            guard FileManager.default.fileExists(atPath: checkpoint.path),
                  !FileManager.default.fileExists(atPath: recovered.path) else {
                XCTFail("Core checkpoint is missing or recovery already completed")
                throw CocoaError(.fileReadNoSuchFile)
            }
            try await recoverCore(in: directory, runID: runID)
            return
        }
        guard !FileManager.default.fileExists(atPath: directory.path) else {
            XCTFail("Test directory already exists")
            throw CocoaError(.fileWriteFileExists)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)

        try await exerciseCore(in: directory, runID: runID, persistent: phase == "write")
    }

    private func verifyPayload() throws -> String {
        let environment = ProcessInfo.processInfo.environment
        guard let runID = environment["SEDI_TEST_RUN_ID"] else {
            throw XCTSkip("Run through the physical Core SEDI test command")
        }
        guard UUID(uuidString: runID) != nil else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let expectedManifest = try XCTUnwrap(environment["SEDI_MANIFEST_SHA256"])
        let expectedCommit = try XCTUnwrap(environment["SEDI_FORTWEB_COMMIT"])
        guard Bundle.main.bundleIdentifier == environment["SEDI_APP_BUNDLE_ID"] else {
            XCTFail("Unexpected development app")
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let payload = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("WebPayload")
        let manifestData = try Data(contentsOf: payload.appendingPathComponent("manifest.json"))
        let digest = SHA256.hash(data: manifestData).map { String(format: "%02x", $0) }.joined()
        guard digest == expectedManifest else {
            XCTFail("Unexpected payload manifest")
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: manifestData) as? [String: Any])
        guard manifest["fortweb_commit_sha"] as? String == expectedCommit else {
            XCTFail("Unexpected FortWeb commit")
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let files = try XCTUnwrap(manifest["files"] as? [[String: Any]])
        guard files.count == 160 else {
            XCTFail("Unexpected payload file count")
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        for item in files {
            let path = try XCTUnwrap(item["path"] as? String)
            let expected = try XCTUnwrap(item["sha256"] as? String)
            let data = try Data(contentsOf: payload.appendingPathComponent(path))
            guard SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expected else {
                XCTFail("Payload file digest mismatch")
                throw CocoaError(.validationMissingMandatoryProperty)
            }
        }

        return runID
    }

    private func exerciseCore(in directory: URL, runID: String, persistent: Bool) async throws {
        let (webView, handler, navigation) = try await coreWebView(runID: runID, persistent: persistent)

        print("Core test stage: setup")
        let setupResult = try await webView.callAsyncJavaScript(
            Self.bridgeSetup + "\n" + Self.setup, arguments: [:], in: nil, contentWorld: .page
        )
        let setup = try XCTUnwrap(setupResult as? String)
        try Data(setup.utf8).write(to: directory.appendingPathComponent("holder.json"), options: .atomic)
        let fixtureFile = directory.appendingPathComponent("fixture.json")
        print("Core test stage: wait for fixture")
        _ = try await waitForJSON(fixtureFile)
        let fixtureJSON = try String(contentsOf: fixtureFile, encoding: .utf8)

        print("Core test stage: prepare")
        let readyResult: Any?
        do {
            readyResult = try await webView.callAsyncJavaScript(
                Self.prepare, arguments: ["fixtureJSON": fixtureJSON], in: nil, contentWorld: .page
            )
        } catch {
            let detail = error as NSError
            XCTFail("Core prepare WebKit error: domain=\(detail.domain) code=\(detail.code) " +
                    "message=\(detail.localizedDescription)")
            return
        }
        let ready = try XCTUnwrap(readyResult as? String)
        let readyData = Data(ready.utf8)
        let readyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: readyData) as? [String: Any])
        if let stage = readyObject["failureStage"] as? String {
            XCTFail("Core prepare failed at \(stage): \(readyObject["message"] ?? "unknown")")
            return
        }
        try readyData.write(to: directory.appendingPathComponent("ready.json"), options: .atomic)
        try await waitForFile(directory.appendingPathComponent("go.json"))
        try await presentAndRecover(in: directory, webView: webView, runID: runID, persistent: persistent)
        withExtendedLifetime((handler, navigation)) {}
    }

    private func coreWebView(runID: String, persistent: Bool) async throws
        -> (WKWebView, RuntimeSmokeSchemeHandler, RuntimeSmokeNavigation) {
        let configuration = WKWebViewConfiguration()
        if persistent {
            guard #available(iOS 17.0, *), let identifier = UUID(uuidString: runID) else {
                throw CocoaError(.featureUnsupported)
            }
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: identifier)
            guard configuration.websiteDataStore.isPersistent else {
                throw CocoaError(.validationMissingMandatoryProperty)
            }
        } else {
            configuration.websiteDataStore = .nonPersistent()
        }
        let policy = "default-src 'none'; script-src app: 'wasm-unsafe-eval'; " +
            "worker-src app: blob:; connect-src app: https:; img-src app: blob: data:; style-src app: 'unsafe-inline'"
        let handler = RuntimeSmokeSchemeHandler(policy: policy)
        configuration.setURLSchemeHandler(handler, forURLScheme: "app")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let loaded = expectation(description: "Core SEDI test document loads")
        let navigation = RuntimeSmokeNavigation(loaded: loaded)
        webView.navigationDelegate = navigation
        webView.load(URLRequest(url: try XCTUnwrap(URL(string: "app://local/runtime-smoke.html"))))
        await fulfillment(of: [loaded], timeout: 30)
        return (webView, handler, navigation)
    }

    private func presentAndRecover(in directory: URL, webView: WKWebView, runID: String,
                                   persistent: Bool) async throws {
        print("Core test stage: present")
        let grantResult = try await webView.callAsyncJavaScript(
            Self.present, arguments: [:], in: nil, contentWorld: .page
        )
        let grant = try XCTUnwrap(grantResult as? String)
        let grantData = Data(grant.utf8)
        let grantObject = try XCTUnwrap(JSONSerialization.jsonObject(with: grantData) as? [String: Any])
        let exchange = try XCTUnwrap(grantObject["exchange"] as? [String: Any])
        let cesr = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(exchange["cesr"] as? String)))
        let cesrDigest = SHA256.hash(data: cesr).map { String(format: "%02x", $0) }.joined()
        try Data(cesrDigest.utf8).write(to: directory.appendingPathComponent("grant-cesr.sha256"), options: .atomic)
        let timing = ["wallSeconds": Date().timeIntervalSince1970,
                      "uptimeSeconds": ProcessInfo.processInfo.systemUptime]
        try JSONSerialization.data(withJSONObject: timing).write(
            to: directory.appendingPathComponent("grant-timing.json"), options: .atomic
        )
        print("Core Grant exported: \(ISO8601DateFormatter().string(from: Date()))")
        try grantData.write(to: directory.appendingPathComponent("fortweb-presentation.json"), options: .atomic)

        print("Core test stage: recover")
        let recoveredResult = try await webView.callAsyncJavaScript(
            Self.coreHelpers + "\n" + Self.recover, arguments: [:], in: nil, contentWorld: .page
        )
        let recovered = try XCTUnwrap(recoveredResult as? String)
        let recoveredData = Data(recovered.utf8)
        let recoveredObject = try XCTUnwrap(JSONSerialization.jsonObject(with: recoveredData) as? [String: Any])
        let checkpoint = try XCTUnwrap(recoveredObject["checkpoint"] as? [String: Any])
        if persistent {
            let wrapper: [String: Any] = ["runID": runID, "processID": ProcessInfo.processInfo.processIdentifier,
                                           "data": checkpoint]
            try JSONSerialization.data(withJSONObject: wrapper).write(
                to: directory.appendingPathComponent("core-checkpoint.json"), options: .atomic
            )
        }
        let summary: [String: Bool] = ["credentialRecovered": true, "bindingRecovered": true,
                                       "grantMetadataRecovered": true]
        try JSONSerialization.data(withJSONObject: summary).write(
            to: directory.appendingPathComponent("recovered.json"), options: .atomic
        )
        let resultFile = directory.appendingPathComponent("native-result.json")
        let resultValue = try await waitForJSON(resultFile)
        let result = try XCTUnwrap(resultValue as? [String: Bool])
        XCTAssertEqual(result["valid"], true)
        XCTAssertEqual(result["wrong"], true)
        XCTAssertEqual(result["missing"], true)
        XCTAssertEqual(result["missingAgent"], true)
        XCTAssertEqual(result["missingProof"], true)
        if !persistent { XCTAssertEqual(result["rechecked"], true) }
    }

    private func recoverCore(in directory: URL, runID: String) async throws {
        let data = try Data(contentsOf: directory.appendingPathComponent("core-checkpoint.json"))
        let wrapper = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        guard wrapper["runID"] as? String == runID,
              let oldPID = wrapper["processID"] as? Int,
              oldPID != Int(ProcessInfo.processInfo.processIdentifier),
              let checkpoint = wrapper["data"] as? [String: Any] else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let (webView, handler, navigation) = try await coreWebView(runID: runID, persistent: true)
        let result = try await webView.callAsyncJavaScript(
            Self.bridgeSetup + "\n" + Self.coreHelpers + "\n" + Self.resume,
            arguments: ["checkpoint": checkpoint], in: nil, contentWorld: .page
        )
        let recovered = try XCTUnwrap(result as? String)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(recovered.utf8)) as? [String: Any])
        guard value["recovered"] as? Bool == true,
              value["missingCredentialRejected"] as? Bool == true,
              value["mismatchedBindingRejected"] as? Bool == true else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        var output = value
        output["processID"] = ProcessInfo.processInfo.processIdentifier
        try JSONSerialization.data(withJSONObject: output).write(
            to: directory.appendingPathComponent("process-recovered.json"), options: .atomic
        )
        withExtendedLifetime((handler, navigation)) {}
    }

    private func waitForJSON(_ url: URL) async throws -> Any {
        for _ in 0..<600 {
            if let data = try? Data(contentsOf: url),
               let value = try? JSONSerialization.jsonObject(with: data) { return value }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        XCTFail("Timed out waiting for synthetic JSON: \(url.lastPathComponent)")
        throw CocoaError(.fileReadNoSuchFile)
    }

    private func waitForFile(_ url: URL) async throws {
        for _ in 0..<600 {
            if FileManager.default.fileExists(atPath: url.path) { return }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        XCTFail("Timed out waiting for synthetic fixture: \(url.lastPathComponent)")
        throw CocoaError(.fileReadNoSuchFile)
    }

}

private extension CoreSediDeviceTests {
    static let bridgeSetup = #"""
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const url = typeof args[0] === "string" ? args[0] : args[0].url;
        if (url === "app://local/pyscript-ci.toml") {
            return {ok: response.ok, status: response.status,
                text: async () => "fort_synthetic_recipient_testing = true\n" + await response.text()};
        }
        return response;
    };
    const {createRuntimeBridge} = await import("app://local/app/runtime/bridge.js");
    const origin = {schema:"fortweb.runtime-origin.v1", version:1, platform:"ios-wkwebview",
        mode:"bundled-offline", documentOrigin:"app://local", appBaseUrl:"app://local",
        entryUrl:"app://local/app/index.html", workerUrl:"app://local/app/runtime/wallet-worker.py",
        configUrl:"app://local/pyscript-ci.toml",
        storage:{storageNamespace:"keri-wallet-ios", indexedDbRequired:true, originPartition:"app://local/"},
        capabilities:{customScheme:true, httpsLikeAssetOrigin:false, implicitBlobOriginSafe:false,
            networkAllowed:false, bundledAssetsOnly:true}};
    const ctx = {};
    ctx.newBridge = () => createRuntimeBridge({workerUrl:new URL(origin.workerUrl),
        configUrl:new URL(origin.configUrl), runtimeOriginContract:origin});
    ctx.bridge = ctx.newBridge();
    ctx.request = (method, params = {}) => ctx.bridge.request(method, params, 180000);
    """#

    private static let setup = #"""
    const vault = await ctx.request("vaults.create", {
        name:"synthetic-core-holder", passcode:"synthetic-holder-passcode"});
    ctx.vaultId = vault.vault.id;
    ctx.storageName = vault.vault.storageName;
    await ctx.request("vaults.open", {vaultId:ctx.vaultId, passcode:"synthetic-holder-passcode"});
    ctx.holderAid = (await ctx.request("identifiers.create", {vaultId:ctx.vaultId, alias:"holder"})).identifier.aid;
    ctx.registry = (await ctx.request("registries.create", {
        vaultId:ctx.vaultId, issuerAid:ctx.holderAid, name:"presentations"})).registry;
    globalThis.__coreSediTest = ctx;
    return JSON.stringify({holderAid:ctx.holderAid, registryId:ctx.registry.registryId});
    """#

    private static let prepare = #"""
    let stage = "setup";
    try {
    const fixture = JSON.parse(fixtureJSON);
    const ctx = globalThis.__coreSediTest;
    const request = ctx.request;
    ctx.fixture = fixture;
    const vaultId = ctx.vaultId;
    stage = "core-schema";
    await request("schemas.import", {vaultId, schemaId:fixture.evidence.schemaId,
        schema:JSON.stringify(fixture.schema)});
    stage = "authority-schemas";
    for (const schema of fixture.authority_schemas) {
        await request("schemas.import", {vaultId, schemaId:schema.$id, schema:JSON.stringify(schema)});
    }
    stage = "remotes";
    for (const [index, evidence] of fixture.supporting.entries()) {
        await request("remotes.import", {vaultId, alias:"authority-" + index, cesr:evidence.kel});
    }
    await request("remotes.import", {vaultId, alias:"issuer", cesr:fixture.issuer});
    await request("remotes.import", {vaultId, alias:"verifier", cesr:fixture.verifierKel});
    stage = "receipt";
    const received = await request("credentials.receive", {vaultId, syntheticOnly:true,
        issuerAid:fixture.evidence.issuerAid, recipientAid:ctx.holderAid,
        schemaId:fixture.evidence.schemaId, evidence:fixture.evidence});
    if (received.credential.issuance !== "verified") throw new Error("Core receipt was not verified");
    ctx.params = {vaultId, syntheticOnly:true, credentialSaid:fixture.evidence.said,
        presenterAid:ctx.holderAid, verifierAid:fixture.verifierAid,
        message:"Present Core SEDI", presentationRegistry:"presentations",
        authorityEvidence:fixture.supporting,
        disclosurePlan:[[fixture.evidence.schemaId, "/", [""]],
            [fixture.supporting[0].schemaId, "/e/utahAgent/_/", [""]],
            [fixture.supporting[1].schemaId, "/e/utahAgent/_/e/orgUnit/_/", [""]]]};
    stage = "negative-preflight";
    const before = await request("identifiers.export", {vaultId, aid:ctx.holderAid});
    for (const invalid of [
        {authorityEvidence:fixture.supporting.slice(0, 1)},
        {authorityEvidence:fixture.supporting.slice(1)},
        {disclosurePlan:ctx.params.disclosurePlan.slice(0, 2)}
    ]) {
        let rejected = false;
        try { await request("ipex.present", {...ctx.params, ...invalid}); } catch (_) { rejected = true; }
        if (!rejected) throw new Error("Invalid Core presentation was accepted");
        const after = await request("identifiers.export", {vaultId, aid:ctx.holderAid});
        if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("Rejected preflight changed holder KEL");
    }
    stage = "other-grant";
    ctx.other = await request("ipex.present", {...ctx.params, message:"Different Core Grant"});
    return JSON.stringify({invalidRejected:true, holderKelUnchanged:true, otherGrant:ctx.other.exchange.said});
    } catch (error) {
        return JSON.stringify({failureStage:stage, message:String(error?.message ?? error),
            code:String(error?.code ?? "")});
    }
    """#

    private static let present = #"""
    const ctx = globalThis.__coreSediTest;
    ctx.result = await ctx.request("ipex.present", ctx.params);
    if (ctx.result.presentation.grantSaid !== ctx.result.exchange.said ||
        ctx.result.presentation.registryId !== ctx.registry.registryId)
        throw new Error("Core presentation binding does not match");
    ctx.result.otherPresentation = ctx.other.presentation;
    return JSON.stringify(ctx.result);
    """#

    private static let coreHelpers = #"""
    const hex = text => Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, "0")).join("");
    const bytes = text => Uint8Array.from(text.match(/../g) ?? [], b => parseInt(b, 16));
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)),
        b => b.toString(16).padStart(2, "0")).join("");
    const canonical = value => value && typeof value === "object"
        ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(
            Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const digest = value => hash(new TextEncoder().encode(JSON.stringify(canonical(value))));
    const records = async namespace => {
        const name = `IDBMap/@fortweb-v2/${namespace}`;
        if (!(await indexedDB.databases()).some(entry => entry.name === name))
            throw new Error("Expected synthetic storage is absent");
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onupgradeneeded = () => request.transaction.abort();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            const raw = await new Promise((resolve, reject) => {
                const request = db.transaction("entries", "readonly").objectStore("entries").get("__records__");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            return JSON.parse(raw || "{}");
        } finally { db.close(); }
    };
    const snapshot = async (ctx, expected) => {
        if (!Array.isArray(expected.nodeSaids) || expected.nodeSaids.length !== 3 ||
            !Array.isArray(expected.telHashes) || !Number.isInteger(expected.bindingSequence) ||
            expected.bindingSequence < 0 || expected.telHashes.length <= expected.bindingSequence)
            throw new Error("Incomplete checkpoint");
        const request = ctx.request, vaultId = ctx.vaultId;
        const identifier = (await request("identifiers.get", {vaultId, aid:expected.holderAid})).identifier;
        const kel = (await request("identifiers.export", {vaultId, aid:expected.holderAid})).cesr;
        const credential = await request("credentials.getReceived", {vaultId, syntheticOnly:true,
            said:expected.credentialSaid});
        if (credential.credential.issuance !== "verified") throw new Error("Core credential is not verified");
        const registry = (await request("registries.get", {vaultId, name:"presentations"})).registry;
        const exchange = (await request("ipex.get", {vaultId, syntheticOnly:true, said:expected.grantSaid})).exchange;
        if (registry.registryId !== expected.registryId || exchange.said !== expected.grantSaid)
            throw new Error("Original registry or Grant differs");
        const binding = (await records(`${ctx.storageName}:fwpn.`))[hex(expected.grantSaid)];
        if (!binding || await digest(JSON.parse(new TextDecoder().decode(bytes(binding)))) !== expected.bindingHash)
            throw new Error("Original presentation binding differs");
        const events = await records(`acdc-reg:${ctx.storageName}:evts.`);
        const eventHashes = await Promise.all(Object.values(events).map(value => hash(bytes(value))));
        if (expected.telHashes.some(value => !eventHashes.includes(value))) throw new Error("Original TEL is missing");
        const nested = await records(`${ctx.storageName}:enst.`), prefix = hex(expected.grantSaid + ".");
        const streams = Object.keys(nested).filter(key => key.startsWith(prefix)).sort().map(key => bytes(nested[key]));
        if (streams.length !== 3 || expected.nodeSaids.some(said =>
            !streams.some(stream => new TextDecoder().decode(stream).includes(said))))
            throw new Error("Original authority streams are missing");
        const signed = {};
        for (const name of ["kels.", "evts.", "sigs.", "fwpn.", "fwrc."]) {
            const values = await records(`${ctx.storageName}:${name}`);
            if (name === "fwrc." && Object.hasOwn(values, hex("_pending"))) throw new Error("Pending operation");
            signed[name] = await digest(values);
        }
        for (const name of ["regs.", "tels.", "evts.", "ancs.", "heds."]) {
            const values = await records(`acdc-reg:${ctx.storageName}:${name}`);
            if (name === "regs." && Object.hasOwn(values, hex("_fortweb_pending")))
                throw new Error("Pending operation");
            signed[`registry:${name}`] = await digest(values);
        }
        return {holderAid:identifier.aid, holderSequence:identifier.sequenceNumber,
            holderHead:identifier.lastEventDigest,
            holderKelHash:await hash(Uint8Array.from(atob(kel), c => c.charCodeAt(0))),
            credentialSaid:credential.credential.said, evidenceHash:await digest(credential.evidence),
            registryId:registry.registryId, grant:exchange, nestedHashes:await Promise.all(streams.map(hash)), signed};
    };
    """#

    private static let recover = #"""
    const ctx = globalThis.__coreSediTest;
    await ctx.request("vaults.close", {vaultId:ctx.vaultId});
    ctx.bridge.destroy();
    ctx.bridge = ctx.newBridge();
    await ctx.request("vaults.open", {vaultId:ctx.vaultId, passcode:"synthetic-holder-passcode"});
    try {
        const p = ctx.result.presentation;
        const expected = {vaultId:ctx.vaultId, storageName:ctx.storageName, holderAid:ctx.holderAid,
            credentialSaid:ctx.fixture.evidence.said, registryId:ctx.registry.registryId,
            grantSaid:ctx.result.exchange.said,
            nodeSaids:[ctx.fixture.evidence.said, ...ctx.fixture.supporting.map(item => item.said)],
            bindingSequence:p.sequence,
            telHashes:await Promise.all(p.tel.map(t => hash(Uint8Array.from(atob(t), c => c.charCodeAt(0))))),
            bindingHash:await digest({registryId:p.registryId, sequence:p.sequence, blinder:p.blinder, event:p.event})};
        const state = await snapshot(ctx, expected);
        const fixtureHash = await digest(ctx.fixture.evidence);
        if (state.evidenceHash !== fixtureHash) throw new Error("Original credential evidence differs");
        return JSON.stringify({checkpoint:{expected, state}});
    } finally {
        await ctx.request("vaults.close", {vaultId:ctx.vaultId});
        ctx.bridge.destroy();
    }
    """#

    private static let resume = #"""
    const expected = checkpoint.expected;
    ctx.vaultId = expected.vaultId;
    ctx.storageName = expected.storageName;
    const vaults = (await ctx.request("vaults.list")).vaults;
    if (!vaults.some(v => v.id === ctx.vaultId && v.storageName === ctx.storageName))
        throw new Error("Original synthetic vault is missing");
    await ctx.request("vaults.open", {vaultId:ctx.vaultId, passcode:"synthetic-holder-passcode"});
    try {
        const state = await snapshot(ctx, expected);
        if (JSON.stringify(canonical(state)) !== JSON.stringify(canonical(checkpoint.state)))
            throw new Error("Recovered Core state differs from checkpoint");
        let missingCredentialRejected = false;
        try { await ctx.request("credentials.getReceived", {vaultId:ctx.vaultId, syntheticOnly:true,
            said:expected.nodeSaids[1]}); } catch (error) { missingCredentialRejected = error?.code === "NOT_FOUND"; }
        let mismatchedBindingRejected = false;
        try { await snapshot(ctx, {...expected, bindingHash:"0".repeat(64)}); }
        catch (error) { mismatchedBindingRejected = String(error?.message).includes("binding differs"); }
        if (!missingCredentialRejected || !mismatchedBindingRejected ||
            JSON.stringify(canonical(await snapshot(ctx, expected))) !== JSON.stringify(canonical(state)))
            throw new Error("Recovery negative checks failed or changed state");
        return JSON.stringify({recovered:true, missingCredentialRejected, mismatchedBindingRejected, state});
    } finally {
        await ctx.request("vaults.close", {vaultId:ctx.vaultId});
        ctx.bridge.destroy();
    }
    """#
}
