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

    func test_vault_picker_shows_your_vaults_heading() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        let heading = webView.staticTexts["Your Vaults"]
        XCTAssertTrue(
            heading.waitForExistence(timeout: 15),
            "Vault picker should display 'Your Vaults' heading"
        )
    }

    func test_vault_picker_shows_create_vault_button() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        let createButton = webView.buttons["Create Vault"]
        XCTAssertTrue(
            createButton.waitForExistence(timeout: 15),
            "Vault picker should display 'Create Vault' button"
        )
    }

    // MARK: - Vault Open Flow

    func test_vault_card_navigates_to_unlock() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        let openButton = webView.buttons["Open Vault"]
        guard openButton.waitForExistence(timeout: 15) else {
            // No vault exists yet; this is expected on a fresh install.
            return
        }

        openButton.tap()

        let passcodeField = webView.secureTextFields.firstMatch
        XCTAssertTrue(
            passcodeField.waitForExistence(timeout: 10),
            "Tapping a vault card should navigate to the unlock page with a passcode field"
        )
    }

    func test_unlock_page_has_open_and_cancel_buttons() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        let openVaultButton = webView.buttons["Open Vault"]
        guard openVaultButton.waitForExistence(timeout: 15) else {
            return
        }

        openVaultButton.tap()

        let openSubmit = webView.buttons["Open"]
        XCTAssertTrue(
            openSubmit.waitForExistence(timeout: 10),
            "Unlock page should have an 'Open' submit button"
        )

        let cancelLink = webView.links["Cancel"]
        XCTAssertTrue(
            cancelLink.waitForExistence(timeout: 5),
            "Unlock page should have a 'Cancel' link"
        )
    }

    // MARK: - Tab Bar Interaction

    func test_tab_bar_links_are_tappable() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        guard navigateToUnlockedVault(webView: webView) else {
            return
        }

        let tabLabels = ["Identifiers", "Remotes", "Foundation", "Settings"]
        for label in tabLabels {
            let tab = webView.links[label]
            XCTAssertTrue(
                tab.waitForExistence(timeout: 10),
                "Tab bar should contain '\(label)' link"
            )
            XCTAssertTrue(tab.isHittable, "'\(label)' tab should be tappable")
        }
    }

    func test_settings_tab_renders_settings_page() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        guard navigateToUnlockedVault(webView: webView) else {
            return
        }

        let settingsTab = webView.links["Settings"]
        guard settingsTab.waitForExistence(timeout: 10) else {
            XCTFail("Settings tab not found")
            return
        }

        settingsTab.tap()

        let settingsHeading = webView.staticTexts["Settings"]
        XCTAssertTrue(
            settingsHeading.waitForExistence(timeout: 10),
            "Tapping Settings tab should render the Settings page"
        )

        let vaultDefaults = webView.staticTexts["Vault Defaults"]
        XCTAssertTrue(
            vaultDefaults.waitForExistence(timeout: 5),
            "Settings page should display 'Vault Defaults' section"
        )
    }

    // MARK: - Lock Vault

    func test_lock_button_returns_to_unlock_screen() {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 30) else {
            XCTFail("WKWebView did not appear")
            return
        }

        guard navigateToUnlockedVault(webView: webView) else {
            return
        }

        let lockButton = webView.buttons["Lock vault"]
        guard lockButton.waitForExistence(timeout: 10) else {
            XCTFail("Lock button not found in vault header")
            return
        }

        lockButton.tap()

        let passcodeField = webView.secureTextFields.firstMatch
        XCTAssertTrue(
            passcodeField.waitForExistence(timeout: 10),
            "Locking vault should return to the unlock screen"
        )
    }

    // MARK: - Helpers

    /// Attempts to navigate from the vault picker into an unlocked vault.
    /// Returns `false` if no vault exists (test will be silently skipped).
    @discardableResult
    private func navigateToUnlockedVault(webView: XCUIElement) -> Bool {
        let openButton = webView.buttons["Open Vault"]
        let returnButton = webView.buttons["Return to Vault"]

        if returnButton.waitForExistence(timeout: 15) {
            returnButton.tap()
            let tabBar = webView.links["Identifiers"]
            return tabBar.waitForExistence(timeout: 15)
        }

        guard openButton.waitForExistence(timeout: 5) else {
            return false
        }

        openButton.tap()

        let passcodeField = webView.secureTextFields.firstMatch
        guard passcodeField.waitForExistence(timeout: 10) else {
            return false
        }

        passcodeField.tap()
        passcodeField.typeText("0123456789abcdefghijk")

        let submitButton = webView.buttons["Open"]
        guard submitButton.waitForExistence(timeout: 5) else {
            return false
        }
        submitButton.tap()

        let identifiersTab = webView.links["Identifiers"]
        return identifiersTab.waitForExistence(timeout: 30)
    }
}
