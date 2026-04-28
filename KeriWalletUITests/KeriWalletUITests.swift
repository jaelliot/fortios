import XCTest

final class KeriWalletUITests: XCTestCase {
    func test_app_launches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.state == .runningForeground)
    }
}
