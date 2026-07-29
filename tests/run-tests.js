import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Temporary file for testing
const testLocFilePath = path.join(__dirname, 'test_saved_locations.locsim');

// Mocked/implemented functions from main.ts using the test file path
function readSavedLocations() {
  if (fs.existsSync(testLocFilePath)) {
    try {
      const data = fs.readFileSync(testLocFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      console.error("Error reading .locsim file:", e);
      return [];
    }
  }
  return [];
}

function saveLocation(locationData) {
  try {
    let existingData = [];
    if (fs.existsSync(testLocFilePath)) {
      const data = fs.readFileSync(testLocFilePath, 'utf-8');
      existingData = JSON.parse(data);
    }
    if (!existingData.some(loc => loc.lat === locationData.lat && loc.lng === locationData.lng)) {
       existingData.push(locationData);
       fs.writeFileSync(testLocFilePath, JSON.stringify(existingData, null, 2), 'utf-8');
    }
    return existingData;
  } catch (e) {
    console.error("Error writing .locsim file:", e);
    return null;
  }
}

function deleteLocation(locationData) {
  try {
    if (fs.existsSync(testLocFilePath)) {
      const data = fs.readFileSync(testLocFilePath, 'utf-8');
      let existingData = JSON.parse(data);
      existingData = existingData.filter(loc => loc.lat !== locationData.lat || loc.lng !== locationData.lng);
      fs.writeFileSync(testLocFilePath, JSON.stringify(existingData, null, 2), 'utf-8');
      return existingData;
    }
    return [];
  } catch (e) {
    console.error("Error deleting from .locsim file:", e);
    return null;
  }
}

// Clean up helper
function cleanUp() {
  if (fs.existsSync(testLocFilePath)) {
    fs.unlinkSync(testLocFilePath);
  }
}

// Test Runner
async function runTests() {
  console.log("Starting tests for Saved Locations storage...");

  try {
    // Make sure we start clean
    cleanUp();

    // Test 1: Reading from non-existent file returns empty array
    console.log("Test 1: Read non-existent file...");
    const initialList = readSavedLocations();
    assert.deepStrictEqual(initialList, []);
    console.log("Test 1: Passed.");

    // Test 2: Saving a new location
    console.log("Test 2: Save a new location...");
    const loc1 = { lat: 40.7128, lng: -74.0060, name: "New York" };
    const savedList1 = saveLocation(loc1);
    assert.strictEqual(savedList1.length, 1);
    assert.deepStrictEqual(savedList1[0], loc1);

    // Verify file actually exists and has correct content
    const fileContent = JSON.parse(fs.readFileSync(testLocFilePath, 'utf-8'));
    assert.deepStrictEqual(fileContent, [loc1]);
    console.log("Test 2: Passed.");

    // Test 3: Preventing duplicate locations (same lat/lng)
    console.log("Test 3: Avoid duplicates...");
    const duplicateLoc = { lat: 40.7128, lng: -74.0060, name: "NY Duplicate" };
    const savedList2 = saveLocation(duplicateLoc);
    // Should still have length 1 because lat/lng match loc1
    assert.strictEqual(savedList2.length, 1);
    assert.deepStrictEqual(savedList2[0].name, "New York");
    console.log("Test 3: Passed.");

    // Test 4: Saving a different location
    console.log("Test 4: Save another location...");
    const loc2 = { lat: 34.0522, lng: -118.2437, name: "Los Angeles" };
    const savedList3 = saveLocation(loc2);
    assert.strictEqual(savedList3.length, 2);
    assert.deepStrictEqual(savedList3[1], loc2);
    console.log("Test 4: Passed.");

    // Test 5: Deleting a location
    console.log("Test 5: Delete a location...");
    const deletedList = deleteLocation(loc1);
    assert.strictEqual(deletedList.length, 1);
    assert.deepStrictEqual(deletedList[0], loc2);

    // Verify file content is updated
    const updatedContent = JSON.parse(fs.readFileSync(testLocFilePath, 'utf-8'));
    assert.deepStrictEqual(updatedContent, [loc2]);
    console.log("Test 5: Passed.");

    console.log("\nAll tests completed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  } finally {
    cleanUp();
  }
}

runTests();
