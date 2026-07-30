import os
import time
from playwright.sync_api import sync_playwright, expect

def main():
    os.makedirs("/home/jules/verification", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Mock electronAPI with pre-loaded saved locations
        # One is Paris (very far), another is close to New York
        page.add_init_script("""
            window.electronAPI = {
                readSavedLocations: async () => {
                    return [
                        { lat: 48.8566, lng: 2.3522, name: "Paris, France" },
                        { lat: 40.7130, lng: -74.0065, name: "Near NY (Close)" }
                    ];
                },
                saveLocation: async (locationData) => {
                    return [];
                },
                deleteLocation: async (locationData) => {
                    return [];
                }
            };
        """)

        print("Navigating to local dev server...")
        page.goto("http://localhost:3000")

        # Wait for app and Leaflet to load
        page.wait_for_timeout(2000)

        # Let's take an initial screenshot
        page.screenshot(path="/home/jules/verification/teleport_1_initial.png")
        print("1. Initial state screenshot captured.")

        # Click the "Saved" dropdown button to show the saved list
        saved_dropdown_btn = page.locator('button:has-text("Saved")')
        expect(saved_dropdown_btn).to_be_visible()
        saved_dropdown_btn.click()
        page.wait_for_timeout(1000)

        page.screenshot(path="/home/jules/verification/teleport_2_saved_list_open.png")
        print("2. Saved list opened screenshot captured.")

        # Let's click the "Paris, France" saved location
        paris_item = page.locator('div:has-text("Paris, France")').last
        expect(paris_item).to_be_visible()
        paris_item.click()
        page.wait_for_timeout(1000)

        # The warning modal should now be visible
        page.screenshot(path="/home/jules/verification/teleport_3_warning_modal.png")
        warning_modal = page.locator('h2:has-text("Teleport Warning")')
        if warning_modal.is_visible():
            print("3. Teleport Warning Modal is visible!")
        else:
            print("3. Warning modal NOT visible!")

        # Click "Cancel" on the warning modal
        cancel_btn = page.locator('button:has-text("Cancel")')
        if cancel_btn.is_visible():
            cancel_btn.click()
            print("Clicked Cancel.")
        page.wait_for_timeout(1000)

        page.screenshot(path="/home/jules/verification/teleport_4_after_cancel.png")

        # Let's open the "Saved" dropdown again and select Paris
        saved_dropdown_btn.click()
        page.wait_for_timeout(500)
        paris_item.click()
        page.wait_for_timeout(500)

        # Click "Teleport" on the warning modal
        teleport_btn = page.locator('button:has-text("Teleport")')
        if teleport_btn.is_visible():
            teleport_btn.click()
            print("Clicked Teleport.")
        page.wait_for_timeout(1000)

        page.screenshot(path="/home/jules/verification/teleport_5_after_teleport.png")

        # Let's open the "Saved" dropdown again and select the close location
        saved_dropdown_btn.click()
        page.wait_for_timeout(500)
        close_item = page.locator('div:has-text("Near NY (Close)")').last
        expect(close_item).to_be_visible()
        close_item.click()
        page.wait_for_timeout(1000)

        page.screenshot(path="/home/jules/verification/teleport_6_after_close_teleport.png")
        print("4. Completed saved locations teleport test.")

        browser.close()

if __name__ == "__main__":
    main()
