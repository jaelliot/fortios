import CryptoKit
import Foundation
import WebKit
import XCTest

@testable import KeriWallet

@MainActor
final class CoreSediDeviceTests: XCTestCase {
    func testSyntheticCorePresentation() async throws {
        let runID = try verifyPayload()

        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let directory = documents.appendingPathComponent("sedi-core-qualification-\(runID)", isDirectory: true)
        guard !FileManager.default.fileExists(atPath: directory.path) else {
            XCTFail("Test directory already exists")
            throw CocoaError(.fileWriteFileExists)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)

        try await exerciseCore(in: directory)
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
        XCTAssertFalse(files.isEmpty)
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

    private func exerciseCore(in directory: URL) async throws {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
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

        print("Core test stage: setup")
        let setupResult = try await webView.callAsyncJavaScript(
            Self.setup, arguments: [:], in: nil, contentWorld: .page
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
        let readyData = try XCTUnwrap(ready.data(using: .utf8))
        let readyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: readyData) as? [String: Any])
        if let stage = readyObject["failureStage"] as? String {
            XCTFail("Core prepare failed at \(stage): \(readyObject["message"] ?? "unknown")")
            return
        }
        try Data(ready.utf8).write(to: directory.appendingPathComponent("ready.json"), options: .atomic)
        try await waitForFile(directory.appendingPathComponent("go.json"))
        try await presentAndRecover(in: directory, webView: webView)
        withExtendedLifetime((handler, navigation)) {}
    }

    private func presentAndRecover(in directory: URL, webView: WKWebView) async throws {
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
            Self.recover, arguments: [:], in: nil, contentWorld: .page
        )
        let recovered = try XCTUnwrap(recoveredResult as? String)
        try Data(recovered.utf8).write(to: directory.appendingPathComponent("recovered.json"), options: .atomic)
        let resultFile = directory.appendingPathComponent("native-result.json")
        let resultValue = try await waitForJSON(resultFile)
        let result = try XCTUnwrap(resultValue as? [String: Bool])
        XCTAssertEqual(result["valid"], true)
        XCTAssertEqual(result["wrong"], true)
        XCTAssertEqual(result["missing"], true)
        XCTAssertEqual(result["missingAgent"], true)
        XCTAssertEqual(result["missingProof"], true)
        XCTAssertEqual(result["rechecked"], true)
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

    private static let setup = #"""
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
    const vault = await ctx.request("vaults.create", {
        name:"synthetic-core-holder", passcode:"synthetic-holder-passcode"});
    ctx.vaultId = vault.vault.id;
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

    private static let recover = #"""
    const ctx = globalThis.__coreSediTest;
    await ctx.request("vaults.close", {vaultId:ctx.vaultId});
    ctx.bridge.destroy();
    ctx.bridge = ctx.newBridge();
    await ctx.request("vaults.open", {vaultId:ctx.vaultId, passcode:"synthetic-holder-passcode"});
    const received = await ctx.request("credentials.getReceived", {
        vaultId:ctx.vaultId, syntheticOnly:true, said:ctx.fixture.evidence.said});
    const canonical = value => value && typeof value === "object"
        ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(
            Object.keys(value).sort().map(key => [key, canonical(value[key])]))
        : value;
    if (JSON.stringify(canonical(received.evidence)) !== JSON.stringify(canonical(ctx.fixture.evidence)))
        throw new Error("Core credential evidence changed on worker restart");
    const binding = await ctx.request("registries.present", {
        vaultId:ctx.vaultId, name:"presentations", grantSaid:ctx.result.exchange.said});
    if (JSON.stringify(canonical(binding.presentation)) !== JSON.stringify(canonical(ctx.result.presentation)))
        throw new Error("Presentation binding changed on worker restart");
    const exchange = await ctx.request("ipex.get", {
        vaultId:ctx.vaultId, syntheticOnly:true, said:ctx.result.exchange.said});
    if (exchange.exchange.said !== ctx.result.exchange.said) throw new Error("Grant metadata changed");
    await ctx.request("vaults.close", {vaultId:ctx.vaultId});
    ctx.bridge.destroy();
    return JSON.stringify({credentialRecovered:true, bindingRecovered:true, grantMetadataRecovered:true});
    """#
}
