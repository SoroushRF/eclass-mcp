import { chromium } from 'playwright';

/**
 * Direct Relay Store Extraction for RMP
 * This script will bypass network capture and extract the JSON data directly from the page memory.
 */
(async () => {
  console.log('--- Starting RMP Relay Store Extraction script ---');

  // Stealth settings
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // Go directly to a prof page
    await page.goto('https://www.ratemyprofessors.com/professor/2750622', {
      waitUntil: 'load',
      timeout: 60000,
    });

    // Dismiss the modal first
    const acceptButton = page.getByRole('button', { name: /Accept/i }).first();
    if (await acceptButton.isVisible()) {
      await acceptButton.click();
      await page.waitForTimeout(2000);
    }

    console.log('Scrolling a bit to ensure all lazy components load...');
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);

    // --- EXTRACT RELAY STORE ---
    console.log('\nExtracting RELAY_STORE from memory...');
    const relayStore = await page.evaluate(() => {
      // RMP stores their data in a global variable called __RELAY_STORE__
      return (window as any).__RELAY_STORE__ || null;
    });

    if (relayStore) {
      console.log('Relay Store FOUND.');

      // Search for "Teacher" and "Rating" fields in the keys
      const keys = Object.keys(relayStore);
      console.log(`Total Keys in Store: ${keys.length}`);

      const teacherKey = keys.find(
        (k) =>
          k.toLowerCase().includes('teacher') &&
          !k.toLowerCase().includes('search')
      );
      if (teacherKey) {
        console.log(`\nFound Teacher Entry: ${teacherKey}`);
        console.log(
          `Data Snippet: ${JSON.stringify(relayStore[teacherKey], null, 2).substring(0, 500)}...`
        );
      }

      const ratingKeys = keys.filter((k) => k.toLowerCase().includes('rating'));
      console.log(`\nFound ${ratingKeys.length} Rating entries.`);
      if (ratingKeys.length > 0) {
        console.log(
          `First Rating Snippet: ${JSON.stringify(relayStore[ratingKeys[0]], null, 2).substring(0, 500)}...`
        );
      }

      // Dump a larger part of the store into a file for analysis
      const fullStoreJson = JSON.stringify(relayStore, null, 2);
      const fs = require('fs');
      fs.writeFileSync(
        '.eclass-mcp/debug/rmp_relay_store_dump.json',
        fullStoreJson
      );
      console.log(
        '\nFULL RELAY STORE DUMP saved to .eclass-mcp/debug/rmp_relay_store_dump.json'
      );
    } else {
      console.log('Relay Store MISSING.');
    }
  } catch (error) {
    console.error('Error during research:', error);
  } finally {
    await browser.close();
    console.log('\n--- Relay Store Research Script Finished ---');
  }
})();
