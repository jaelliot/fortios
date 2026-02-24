import XCTest

@testable import KeriWallet

final class WebNavigationPolicyTests: XCTestCase {
    func test_allows_app_scheme() {
        let policy = WebNavigationPolicy()
        XCTAssertTrue(policy.isAllowed(url: URL(string: AppConfig.Scheme.entryURL)!))
    }

    func test_allows_about_blank_only() {
        let policy = WebNavigationPolicy()
        XCTAssertTrue(policy.isAllowed(url: URL(string: "about:blank")!))
        XCTAssertFalse(policy.isAllowed(url: URL(string: "about:config")!))
    }

    func test_blocks_https() {
        let policy = WebNavigationPolicy()
        XCTAssertFalse(policy.isAllowed(url: URL(string: "https://example.com")!))
    }
}
