import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(2 * 60 * 60 * 1000);

test("Validate URLs and Broken Links", async () => {
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);

  const extractedUrlsFromExcel = await objectFactory.utility.loadExcel("basic_page.xlsx");
  await tempBrowser.close();

  console.log(`Total URLs loaded:${extractedUrlsFromExcel.length}`);
  const results = { allValidated: [], broken: [] };

  // Config
  const totalBrowsers = 6;
  const contextsPerBrowser = 5;
  const batchSize = 4;

  // ✅ Split URLs evenly across browsers
  const urlChunks = objectFactory.utility.chunkArray(extractedUrlsFromExcel, totalBrowsers);

  await Promise.all(
    Array.from({ length: totalBrowsers }, async (_, bIndex) => {
      const browser = await chromium.launch({ headless: true });
      const browserQueue = [...urlChunks[bIndex]]; // 👈 each browser gets its own slice

      // ✅ Optionally: also split per context
      const contextChunks = objectFactory.utility.chunkArray(browserQueue, contextsPerBrowser);

      await Promise.all(
        Array.from({ length: contextsPerBrowser }, async (_, cIndex) => {
          const workerId = `${bIndex + 1}-${cIndex + 1}`;
          const factory = createObjects(null, browser);

          const workerQueue = [...contextChunks[cIndex]]; // 👈 per-context slice
          if (workerQueue.length === 0) return; // skip idle contexts

          await factory.siteScannerOld.runLinkCheckerWorker(
            browser,
            batchSize,
            workerId,
            workerQueue,
            results
          );
        })
      );

      await browser.close();
      console.log(`🛑 Browser ${bIndex + 1} closed`);
    })
  );

  // --- Save results ---
  const finalBrowser = await chromium.launch();
  const finalFactory = createObjects(null, finalBrowser);

  finalFactory.utility.saveToExcel("validated-urls.xlsx", "ValidatedUrls", results.allValidated, "url-reports");
  finalFactory.utility.saveToExcel("broken-links.xlsx", "BrokenLinks", results.broken, "url-reports");

  await finalBrowser.close();
});
