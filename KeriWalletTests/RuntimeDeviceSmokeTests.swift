import CryptoKit
import Foundation
import WebKit
import XCTest

@testable import KeriWallet

final class RuntimeSmokeSchemeHandler: NSObject, WKURLSchemeHandler {
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
final class RuntimeSmokeNavigation: NSObject, WKNavigationDelegate {
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
    private let strictPolicyManifest = "665722ddca6a8a367086e439b64f4c15f888df7e36287954f19948a3ba7e6644"
    private let strictPolicyManifests: Set<String> = [
        "4b5197f8d91ecda56260e7cc7337d85586499cc3c668342e9757d7de81182629",
        "665722ddca6a8a367086e439b64f4c15f888df7e36287954f19948a3ba7e6644"
    ]

    func testSyntheticNativePresentation() async throws {
        try await exercise(persistent: false)
    }

    func testSyntheticNativePersistenceAcrossAppRestart() async throws {
        try await exercise(persistent: true)
    }

    func testStrictRuntimePolicyMatchesSelectedCandidate() async throws {
        try await exercise(persistent: false, strictPolicy: true)
    }

    private func exercise(persistent: Bool, strictPolicy: Bool = false) async throws {
        let selectedManifest = try verifyInstalledPayload()
        let selectedRun = ProcessInfo.processInfo.environment["SEDI_TEST_RUN_ID"]
        if persistent && ProcessInfo.processInfo.environment["SEDI_MANIFEST_SHA256"] != nil {
            guard let selectedRun, UUID(uuidString: selectedRun) != nil else {
                throw CocoaError(.validationMissingMandatoryProperty)
            }
        }
        let checkpointKey = "org.kerifoundation.runtime-persistence-test-v1" + (selectedRun.map { "." + $0 } ?? "")
        let checkpoint = persistent ? UserDefaults.standard.dictionary(forKey: checkpointKey) : nil
        let configuration = try makeConfiguration(persistent: persistent, selectedRun: selectedRun)
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
            try await verifyStrictPolicy(webView)
        }

        let result = try await webView.callAsyncJavaScript(
            Self.exerciseRuntime, arguments: ["schema": Self.schema, "persistent": persistent,
                                               "processId": ProcessInfo.processInfo.processIdentifier,
                                               "checkpoint": checkpoint ?? [:]],
            in: nil, contentWorld: .page
        )
        let outcome = try XCTUnwrap(result as? [String: Any])
        if strictPolicy && !strictPolicyManifests.contains(selectedManifest) {
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
        verifyNonpersistentOutcome(outcome)
        withExtendedLifetime((schemeHandler, navigation)) {}
    }

    private func verifyNonpersistentOutcome(_ outcome: [String: Any]) {
        XCTAssertEqual(outcome["negativeRejected"] as? Bool, true)
        XCTAssertEqual(outcome["bindingRejected"] as? Bool, true)
        XCTAssertEqual(outcome["tamperRecovered"] as? Bool, true)
        XCTAssertEqual(outcome["recovered"] as? Bool, true)
        XCTAssertEqual(outcome["contentionRejected"] as? Bool, true)
        XCTAssertEqual(outcome["restartRecovered"] as? Bool, true)
    }

    private func makeConfiguration(persistent: Bool, selectedRun: String?) throws -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        if persistent {
            guard #available(iOS 17.0, *) else {
                throw XCTSkip("An isolated persistent WebKit store requires iOS 17")
            }
            let identifier = try XCTUnwrap(UUID(uuidString: selectedRun ?? "AD137EF7-36C9-4DBF-8D04-FB47547C2AE6"))
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: identifier)
            XCTAssertTrue(configuration.websiteDataStore.isPersistent)
        } else {
            configuration.websiteDataStore = .nonPersistent()
        }
        return configuration
    }

    private func verifyStrictPolicy(_ webView: WKWebView) async throws {
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

    private func verifyInstalledPayload() throws -> String {
        let candidates = [
            "9a95757579f1f2c79c8841f7151d2d3da16eed61af0fb893852a8c626f984347":
                "37ce9f39fda858338e68397afa5bcc626b88c72f",
            "4b5197f8d91ecda56260e7cc7337d85586499cc3c668342e9757d7de81182629":
                "374583defa75a6e2e0eb933e5a3cbdef192f79e4",
            strictPolicyManifest: "a88507b38b6cf15a938b80ce4833f93642b9c7aa"
        ]
        let environment = ProcessInfo.processInfo.environment
        let requested = environment["SEDI_MANIFEST_SHA256"]
            ?? "9a95757579f1f2c79c8841f7151d2d3da16eed61af0fb893852a8c626f984347"
        guard let expectedCommit = candidates[requested],
              environment["SEDI_FORTWEB_COMMIT"].map({ $0 == expectedCommit }) ?? true else {
            XCTFail("Unsupported runtime candidate")
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let root = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("WebPayload", isDirectory: true)
        let data = try Data(contentsOf: root.appendingPathComponent("manifest.json"))
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == requested else {
            if environment["SEDI_MANIFEST_SHA256"] == nil {
                throw XCTSkip("This smoke test requires the selected runtime candidate")
            }
            XCTFail("Installed runtime manifest differs from the requested candidate")
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let actualCommit = try XCTUnwrap(manifest["fortweb_commit_sha"] as? String)
        _ = try XCTUnwrap(actualCommit == expectedCommit ? actualCommit : nil, "Installed runtime commit differs")
        let files = try XCTUnwrap(manifest["files"] as? [[String: Any]])
        _ = try XCTUnwrap(files.count == 160 ? files : nil, "Unexpected runtime file count")
        for file in files {
            let path = try XCTUnwrap(file["path"] as? String)
            let expected = try XCTUnwrap(file["sha256"] as? String)
            let contents = try Data(contentsOf: root.appendingPathComponent(path))
            let actual = SHA256.hash(data: contents).map { String(format: "%02x", $0) }.joined()
            _ = try XCTUnwrap(actual == expected ? actual : nil, "Installed runtime file differs: \(path)")
        }
        return requested
    }
}
