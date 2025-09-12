import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";

test.setTimeout(60 * 60 * 1000);
test("Verify broken media across pages (collective Excel)", async () => {


  // Load URLs once
  const tempBrowser = await chromium.launch();
  const objectFactoryTemp = createObjects(null, tempBrowser);

  const urls = objectFactoryTemp.siteScanner.loadUrlsFromExcel(
    "./Content-Inventory.xlsx",
    credentials.env.wordPress
  );
  await tempBrowser.close();

  console.log(`Total URLs loaded: ${urls.length}`);

  // Split across browsers
  const totalBrowsers = 6;
  const urlsPerBrowser = Math.ceil(urls.length / totalBrowsers);
  const urlChunks = [];
  for (let i = 0; i < urls.length; i += urlsPerBrowser) {
    urlChunks.push(urls.slice(i, i + urlsPerBrowser));
  }

  const browsers = await Promise.all(
    Array.from({ length: totalBrowsers }, () => chromium.launch({ headless: true }))
  );

  // Collect all results here
  const allGlobalMedia = [];
  const allBrokenMedia = [];
  const allValidatedUrls = []; // New array for aggregation

  const results = await Promise.all(
    urlChunks.map(async (chunk, index) => {
      const browser = browsers[index];
      const objectFactory = createObjects(null, browser);

      const { globalAllMedia, globalBrokenMedia, validatedUrls } =
        await objectFactory.siteScanner.checkBrokenMedia(chunk, 3, index + 1);

      return { browser, globalAllMedia, globalBrokenMedia, validatedUrls };
    })
  );

  for (const res of results) {
    await res.browser.close();
    allGlobalMedia.push(...res.globalAllMedia);
    allBrokenMedia.push(...res.globalBrokenMedia);
    allValidatedUrls.push(...res.validatedUrls); // Collect all
  }

  // --- Save Excel files ---
  const finalBrowser = await chromium.launch();
  const finalObjectFactory = createObjects(null, finalBrowser);

  finalObjectFactory.siteScanner.saveToExcel("all-media.xlsx", "AllMedia", allGlobalMedia);
  finalObjectFactory.siteScanner.saveToExcel("broken-media.xlsx", "BrokenMedia", allBrokenMedia);
  finalObjectFactory.siteScanner.saveToExcel("validated-urls.xlsx", "ValidatedURLs", allValidatedUrls);

  await finalBrowser.close();

  console.log("📊 Final Excel files saved: all-media.xlsx & broken-media.xlsx");
});
