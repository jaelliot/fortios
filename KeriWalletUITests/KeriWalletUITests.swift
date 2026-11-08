import XCTest

final class KeriWalletUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    // MARK: - Launch

    func test_app_launches() {
        XCTAssertTrue(app.state == .runningForeground)
    }

    func test_webview_loads() {
        let webView = app.webViews.firstMatch
        XCTAssertTrue(
            webView.waitForExistence(timeout: 30),
            "WKWebView should appear within 30 seconds"
        )
    }

    // MARK: - Vault Picker

    /// Opens the vault drawer: waits for the Vaults toggle to become enabled,
    /// taps it, and returns the drawer element. Fails the test with a precise
    /// message if any step times out.
    private func openVaultDrawer(
        webView: XCUIElement, toggleTimeout: TimeInterval = 10.0, drawerTimeout: TimeInterval = 10.0
    ) -> XCUIElement {
        let vaultsToggle = webView.buttons["Vaults"]
        guard vaultsToggle.waitForExistence(timeout: toggleTimeout) else {
            XCTFail("Vaults toggle button did not appear")
            return webView // unreachable; satisfies the compiler
        }

        let enabled = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"),
            object: vaultsToggle
        )
        guard XCTWaiter().wait(for: [enabled], timeout: toggleTimeout) == .completed else {
            XCTFail(vaultsToggle.isHittable
                ? "Vaults toggle is hittable but never became enabled"
                : "Vaults toggle exists but never became enabled")
            return webView
        }

        vaultsToggle.tap()

        // The drawer is an <aside role="dialog" aria-label="Vault switcher">.
        // WebKit appends ", web dialog" to the accessible label, so use a
        // predicate instead of an exact string match.
        let drawerPredicate = NSPredicate(format: "label BEGINSWITH 'Vault switcher'")
        let drawer = webView.otherElements.element(matching: drawerPredicate)
        guard drawer.waitForExistence(timeout: drawerTimeout) else {
            XCTFail("Vault drawer did not open (label BEGINSWITH 'Vault switcher')")
            return webView
        }

        return drawer
    }

    func test_vault_picker_shows_your_vaults_heading() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        let drawer = openVaultDrawer(webView: webView)

        let heading = drawer.staticTexts["Vaults"]
        XCTAssertTrue(
            heading.waitForExistence(timeout: 5),
            "Vault drawer should display 'Vaults' heading"
        )
    }

    func test_vault_picker_shows_create_vault_button() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        let drawer = openVaultDrawer(webView: webView)

        let createButton = drawer.buttons["Initialize New Vault"]
        XCTAssertTrue(
            createButton.waitForExistence(timeout: 5),
            "Vault drawer should display 'Initialize New Vault' button"
        )
    }

    // MARK: - Vault Flow

    func test_vault_restart_open_navigation_and_lock() {
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "WKWebView did not appear")

        let name = "UI Test " + UUID().uuidString
        let passcode = "test-only-passcode"
        let drawer = openVaultDrawer(webView: webView, toggleTimeout: 60)
        let createVault = drawer.buttons["Initialize New Vault"]
        XCTAssertTrue(createVault.waitForExistence(timeout: 10))
        createVault.tap()

        let nameField = webView.textFields["Name"]
        let createPasscode = webView.secureTextFields["Passcode"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 10), "Vault name field did not appear")
        typeText(name, into: nameField)
        XCTAssertEqual(nameField.value as? String, name)
        XCTAssertTrue(createPasscode.waitForExistence(timeout: 10), "Vault passcode field did not appear")
        typeText(passcode, into: createPasscode)
        XCTAssertEqual(nameField.value as? String, name)
        webView.buttons["Create"].tap()

        let openButton = webView.buttons["Open"]
        XCTAssertTrue(openButton.waitForExistence(timeout: 90), "Created vault did not reach the unlock screen")
        webView.links["Cancel"].tap()

        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
        app.launch()
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "WKWebView did not reappear after relaunch")

        let vaultDrawer = openVaultDrawer(webView: webView, toggleTimeout: 60)
        let vault = vaultDrawer.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(vault.waitForExistence(timeout: 10), "Created vault was not listed in the switcher")
        vault.tap()
        XCTAssertTrue(openButton.waitForExistence(timeout: 10), "Selecting the vault did not show unlock")

        let unlockPasscode = webView.secureTextFields.firstMatch
        XCTAssertTrue(unlockPasscode.waitForExistence(timeout: 10))
        typeText(passcode, into: unlockPasscode)
        openButton.tap()

        let lockButton = webView.buttons["Lock vault"]
        XCTAssertTrue(lockButton.waitForExistence(timeout: 90), "Opening the vault did not reach its workspace")
        let navigationButton = webView.buttons["Open navigation"]
        XCTAssertTrue(navigationButton.waitForExistence(timeout: 10))
        navigationButton.tap()
        for label in ["Identifiers", "Remote Identifiers", "KERI Foundation", "Settings"] {
            let link = webView.links.matching(identifier: label).firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 10), "Missing navigation link: \(label)")
            XCTAssertTrue(link.isHittable, "Navigation link is not tappable: \(label)")
        }
        webView.links.matching(identifier: "Settings").firstMatch.tap()
        XCTAssertTrue(webView.staticTexts["Vault Defaults"].waitForExistence(timeout: 10))

        lockButton.tap()
        XCTAssertTrue(
            webView.secureTextFields.firstMatch.waitForExistence(timeout: 30), "Lock did not return to unlock"
        )
    }

    private func typeText(_ value: String, into field: XCUIElement) {
        for _ in 0..<3 {
            field.tap()
            if app.keyboards.firstMatch.waitForExistence(timeout: 5) {
                app.typeText(value)
                return
            }
        }
        XCTFail("Keyboard did not appear for \(field.label)")
    }
}
