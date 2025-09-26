import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(60 * 60 * 1000);

test("Validate URLs and Broken Links", async () => {
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);

  const extractedUrlsFromExcel = await objectFactory.utility.loadExcel("basic_page.xlsx");
  await tempBrowser.close();

  console.log(`Total URLs loaded: ${extractedUrlsFromExcel.length}`);
  const urlQueue = [...extractedUrlsFromExcel];

  const results = { allValidated: [], broken: [] };

  // Config
  const totalBrowsers = 5;
  const contextsPerBrowser = 5;
  const batchSize = 3;

  await Promise.all(
    Array.from({ length: totalBrowsers }, async (_, bIndex) => {
      const browser = await chromium.launch({ headless: true });

      await Promise.all(
        Array.from({ length: contextsPerBrowser }, async (_, cIndex) => {
          const workerId = `${bIndex + 1}-${cIndex + 1}`;
          const factory = createObjects(null, browser);

          await factory.siteScanner.runLinkCheckerWorker(browser, batchSize, workerId, urlQueue, results);
        })
      );

      await browser.close();
      console.log(`🛑 Browser ${bIndex + 1} closed`);
    })
  );

  // --- Save results ---
  const finalBrowser = await chromium.launch();
  const finalFactory = createObjects(null, finalBrowser);

  finalFactory.utility.saveToExcel("validated-urls.xlsx", "ValidatedUrls", results.allValidated, "ValidatedUrls");

  finalFactory.utility.saveToExcel("broken-links.xlsx", "BrokenLinks", results.broken, "BrokenLinks" );

  await finalBrowser.close();
});
