import os
import time
from playwright.sync_api import sync_playwright, expect

def main():
    # Ensure verification directory exists
    os.makedirs("/home/jules/verification", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create a new page
        page = browser.new_page()

        # In order to mock electronAPI, we can add an init script before navigating
        page.add_init_script("""
            window.electronAPI = {
                readSavedLocations: async () => {
                    console.log("Mock readSavedLocations called");
                    return [];
                },
                saveLocation: async (locationData) => {
                    console.log("Mock saveLocation called with", locationData);
                    return [locationData];
                },
                deleteLocation: async (locationData) => {
                    console.log("Mock deleteLocation called with", locationData);
                    return [];
                }
            };
        """)

        print("Navigating to local dev server...")
        page.goto("http://localhost:5173")

        # Let's wait a bit for Leaflet/app to load
        page.wait_for_timeout(2000)

        # Let's take an initial screenshot
        page.screenshot(path="/home/jules/verification/1_initial_page.png")
        print("Initial page screenshot saved.")

        # Click the Bookmark button to open the save location modal
        # Looking at App.tsx: title="Save Location"
        save_button = page.locator('button[title="Save Location"]')
        expect(save_button).to_be_visible()
        save_button.click()
        print("Clicked Save Location button.")

        # Let's wait for modal to animate / display
        page.wait_for_timeout(1000)

        # Capture modal screenshot
        page.screenshot(path="/home/jules/verification/2_save_modal_open.png")
        print("Save modal open screenshot saved.")

        # Let's type a name into the input field
        input_field = page.locator('input[placeholder="Location Name"]')
        expect(input_field).to_be_visible()
        # Input should have auto-focused and have some default name like "Location XXXX"
        # Let's clear and fill it with "Central Park"
        input_field.fill("Central Park")
        page.wait_for_timeout(500)

        # Capture filled modal screenshot
        page.screenshot(path="/home/jules/verification/3_save_modal_filled.png")
        print("Save modal filled screenshot saved.")

        # Press Enter or click Save
        page.press('input[placeholder="Location Name"]', 'Enter')
        page.wait_for_timeout(1000)

        # Confirm the modal is closed
        expect(input_field).not_to_be_visible()
        print("Modal successfully closed after save.")

        # Click the "Saved" dropdown button to show the saved list
        # Look for button text containing "Saved"
        saved_dropdown_btn = page.locator('button:has-text("Saved")')
        expect(saved_dropdown_btn).to_be_visible()
        saved_dropdown_btn.click()
        page.wait_for_timeout(1000)

        # Capture dropdown screenshot with the saved location "Central Park"
        page.screenshot(path="/home/jules/verification/4_saved_list_open.png")
        print("Saved list open screenshot saved.")

        browser.close()

if __name__ == "__main__":
    main()
