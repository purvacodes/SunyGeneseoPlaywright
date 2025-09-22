import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";

test.setTimeout(60 * 60 * 1000);

test("Verify broken media across pages (dynamic batch distribution)", async () => {
  const tempBrowser = await chromium.launch();
  const objectFactoryTemp = createObjects(null, tempBrowser);

  const urls = objectFactoryTemp.siteScanner.loadCptUrlsFromExcel(
    "./Content-Inventory.xlsx",
    credentials.env.wordPress
  );
  await tempBrowser.close();

  const totalBrowsers = 7;
  const batchSize = 3;

  const urlQueue = [...urls]; // shared pool of URLs
  const results = {
    allGlobalMedia: [],
    allBrokenMedia: [],
    allValidatedUrls: []
  };

  async function runWorker(browser, browserId) {
    const objectFactory = createObjects(null, browser);
    const siteScanner = objectFactory.siteScanner;

    while (urlQueue.length > 0) {
      // Get next batch
      const batch = urlQueue.splice(0, batchSize);
      if (batch.length === 0) break;

      try {
        const { globalAllMedia, globalBrokenMedia, validatedUrls } =
          await siteScanner.checkBrokenMedia(batch, batchSize, browserId);

        results.allGlobalMedia.push(...globalAllMedia);
        results.allBrokenMedia.push(...globalBrokenMedia);
        results.allValidatedUrls.push(...validatedUrls);
      } catch (err) {
        for (const url of batch) {
          results.allValidatedUrls.push({
            browserId,
            url,
            status: "failed",
            totalMedia: 0,
            brokenMedia: 0,
            error: err.message || "Unknown error"
          });
        }
      }
    }

    await browser.close();
  }

  const browsers = await Promise.all(
    Array.from({ length: totalBrowsers }, () => chromium.launch({ headless: true }))
  );

  await Promise.all(
    browsers.map((browser, index) => runWorker(browser, index + 1))
  );

  // Save Excel
  const finalBrowser = await chromium.launch();
  const finalObjectFactory = createObjects(null, finalBrowser);

  finalObjectFactory.siteScanner.saveToExcel("all-media.xlsx", "AllMedia", results.allGlobalMedia);
  finalObjectFactory.siteScanner.saveToExcel("broken-media.xlsx", "BrokenMedia", results.allBrokenMedia);
  finalObjectFactory.siteScanner.saveToExcel("validated-urls.xlsx", "ValidatedURLs", results.allValidatedUrls);

  await finalBrowser.close();

  console.log("✅ Done. Excel files written.");
});
