import CryptoKit
import Foundation
import WebKit
import XCTest

@testable import KeriWallet

private final class RuntimeSmokeSchemeHandler: NSObject, WKURLSchemeHandler {
    private let payload = PayloadSchemeHandler()
    private let policy: String?

    init(policy: String? = nil) {
        self.policy = policy
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        if let policy, let url = task.request.url, url.path != "/runtime-smoke.html" {
            do {
                let (data, _, originalHeaders) = try payload.loadResource(for: url)
                var headers = originalHeaders
                headers["Content-Security-Policy"] = policy
                guard let response = HTTPURLResponse(
                    url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers
                ) else {
                    throw PayloadSchemeError.invalidURL
                }
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            } catch {
                task.didFailWithError(error)
            }
            return
        }
        guard let url = task.request.url, url.path == "/runtime-smoke.html" else {
            payload.webView(webView, start: task)
            return
        }
        let data = Data("<!doctype html><title>Runtime smoke</title>".utf8)
        var headers = ["Content-Type": "text/html; charset=utf-8"]
        if let policy { headers["Content-Security-Policy"] = policy }
        guard let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            task.didFailWithError(PayloadSchemeError.invalidURL)
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        if task.request.url?.path != "/runtime-smoke.html" {
            payload.webView(webView, stop: task)
        }
    }
}

@MainActor
private final class RuntimeSmokeNavigation: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation

    init(loaded: XCTestExpectation) {
        self.loaded = loaded
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded.fulfill()
    }
}

@MainActor
final class RuntimeDeviceSmokeTests: XCTestCase {
    func testSyntheticNativePresentation() async throws {
        try await exercise(persistent: false)
    }

    func testSyntheticNativePersistenceAcrossAppRestart() async throws {
        try await exercise(persistent: true)
    }

    func testStrictRuntimePolicyReportsPyScriptEvaluationBlock() async throws {
        try await exercise(persistent: false, strictPolicy: true)
    }

    private func exercise(persistent: Bool, strictPolicy: Bool = false) async throws {
        try verifyInstalledPayload()
        let checkpointKey = "org.kerifoundation.runtime-persistence-test-v1"
        let checkpoint = persistent ? UserDefaults.standard.dictionary(forKey: checkpointKey) : nil
        let configuration = WKWebViewConfiguration()
        if persistent {
            guard #available(iOS 17.0, *) else {
                throw XCTSkip("An isolated persistent WebKit store requires iOS 17")
            }
            let identifier = try XCTUnwrap(UUID(uuidString: "AD137EF7-36C9-4DBF-8D04-FB47547C2AE6"))
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: identifier)
            XCTAssertTrue(configuration.websiteDataStore.isPersistent)
        } else {
            configuration.websiteDataStore = .nonPersistent()
        }
        let policy = strictPolicy
            ? "default-src 'none'; script-src app: 'wasm-unsafe-eval'; " +
              "worker-src app: blob:; connect-src app: https:; img-src app: blob: data:; style-src app: 'unsafe-inline'"
            : nil
        let schemeHandler = RuntimeSmokeSchemeHandler(policy: policy)
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "app")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let loaded = expectation(description: "isolated runtime test document loads")
        let navigation = RuntimeSmokeNavigation(loaded: loaded)
        webView.navigationDelegate = navigation
        let url = try XCTUnwrap(URL(string: "app://local/runtime-smoke.html"))
        webView.load(URLRequest(url: url))
        await fulfillment(of: [loaded], timeout: 30)

        if strictPolicy {
            let result = try await webView.callAsyncJavaScript(
                """
                let evaluation = false, wasm = false;
                try { evaluation = eval('40 + 2') === 42; } catch (_) {}
                try { await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0])); wasm = true; } catch (_) {}
                return {evaluation, wasm};
                """, arguments: [:], in: nil, contentWorld: .page
            )
            let checks = try XCTUnwrap(result as? [String: Any])
            XCTAssertEqual(checks["evaluation"] as? Bool, false)
            XCTAssertEqual(checks["wasm"] as? Bool, true)
        }

        let result = try await webView.callAsyncJavaScript(
            Self.exerciseRuntime, arguments: ["schema": Self.schema, "persistent": persistent,
                                               "processId": ProcessInfo.processInfo.processIdentifier,
                                               "checkpoint": checkpoint ?? [:]],
            in: nil, contentWorld: .page
        )
        let outcome = try XCTUnwrap(result as? [String: Any])
        if strictPolicy {
            XCTAssertEqual(outcome["ok"] as? Bool, false)
            XCTAssertEqual(outcome["stage"] as? String, "issuer")
            XCTAssertEqual(outcome["failureClass"] as? String, "csp-eval")
            withExtendedLifetime((schemeHandler, navigation)) {}
            return
        }
        let diagnostic = "Runtime test stopped at \(outcome["stage"] ?? "unknown") (\(outcome["code"] ?? "unknown"))"
        XCTAssertEqual(outcome["ok"] as? Bool, true, diagnostic)
        if persistent {
            try recordPersistence(outcome, previous: checkpoint, key: checkpointKey)
            withExtendedLifetime((schemeHandler, navigation)) {}
            return
        }
        XCTAssertEqual(outcome["negativeRejected"] as? Bool, true)
        XCTAssertEqual(outcome["bindingRejected"] as? Bool, true)
        XCTAssertEqual(outcome["tamperRecovered"] as? Bool, true)
        XCTAssertEqual(outcome["recovered"] as? Bool, true)
        XCTAssertEqual(outcome["contentionRejected"] as? Bool, true)
        XCTAssertEqual(outcome["restartRecovered"] as? Bool, true)
        withExtendedLifetime((schemeHandler, navigation)) {}
    }

    private func recordPersistence(_ outcome: [String: Any], previous: [String: Any]?, key: String) throws {
        let phase = try XCTUnwrap(outcome["phase"] as? String)
        XCTAssertTrue(["write", "read"].contains(phase))
        if phase == "write" {
            UserDefaults.standard.set(try XCTUnwrap(outcome["checkpoint"] as? [String: Any]), forKey: key)
        } else {
            var saved = try XCTUnwrap(previous)
            saved["complete"] = true
            UserDefaults.standard.set(saved, forKey: key)
        }
        UserDefaults.standard.synchronize()
        print("Runtime persistence phase: \(phase), process: \(ProcessInfo.processInfo.processIdentifier)")
    }

    private func verifyInstalledPayload() throws {
        let root = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("WebPayload", isDirectory: true)
        let data = try Data(contentsOf: root.appendingPathComponent("manifest.json"))
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == "9a95757579f1f2c79c8841f7151d2d3da16eed61af0fb893852a8c626f984347" else {
            throw XCTSkip("This smoke test requires the FortWeb 37ce9f3 runtime candidate")
        }
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(manifest["fortweb_commit_sha"] as? String, "37ce9f39fda858338e68397afa5bcc626b88c72f")
        let files = try XCTUnwrap(manifest["files"] as? [[String: Any]])
        XCTAssertEqual(files.count, 160)
        for file in files {
            let path = try XCTUnwrap(file["path"] as? String)
            let expected = try XCTUnwrap(file["sha256"] as? String)
            let contents = try Data(contentsOf: root.appendingPathComponent(path))
            let actual = SHA256.hash(data: contents).map { String(format: "%02x", $0) }.joined()
            XCTAssertEqual(actual, expected, "Installed runtime file differs: \(path)")
        }
    }

}

private extension RuntimeDeviceSmokeTests {
    // Same public fixture used by the producer's registry receipt tests.
    private static let schema = #"""
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

    private static let exerciseRuntime = #"""
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
            const bound = (await request("registries.present", {vaultId: checkpoint.holderId,
                name: "presentations", grantSaid: checkpoint.grantSaid})).presentation;
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
            failureClass: /content security|unsafe-eval|EvalError/i.test(String(error?.message)) ? "csp-eval" : "other"};
    } finally {
        bridge?.destroy();
    }
    """#
}
