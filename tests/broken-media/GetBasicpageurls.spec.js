import { test, chromium } from "@playwright/test";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";
import { contentPostTypesUrls } from "../../data/contentPostTypesUrls.js";

test.setTimeout(90 * 60 * 1000); // 1.5h safety

test("Verify broken media across Basic Pages CPT", async () => {
  // 1. Collect URLs
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);

  await objectFactory.siteScanner.collectUrlsToScan(
    tempBrowser,
    credentials.env.wordPress,
    contentPostTypesUrls.CPT.basicPage,
    5
  );

  // 2. Load collected URLs
  const extractedUrlsFromExcel = objectFactory.utility.loadUrlsFromExcel(
    `${contentPostTypesUrls.CPT.basicPage}`,
    credentials.env.wordPress
  );
  await tempBrowser.close();

  console.log(`✅ Total URLs loaded: ${extractedUrlsFromExcel.length}`);

  const urlQueue = [...extractedUrlsFromExcel];
  const results = { allGlobalMedia: [], allBrokenMedia: [], allValidatedUrls: [] };

  // 3. Use 3 browsers × 5 contexts = 15 workers
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
          await factory.siteScanner.runWorker(browser, batchSize, workerId, urlQueue, results);
        })
      );

      await browser.close();
      console.log(`🛑 Browser ${bIndex + 1} closed`);
    })
  );

  // 4. Save results
  const finalBrowser = await chromium.launch();
  const finalObjectFactory = createObjects(null, finalBrowser);

  finalObjectFactory.utility.saveToExcel("all-media.xlsx", "AllMedia", results.allGlobalMedia,"AllMedia");
  finalObjectFactory.utility.saveToExcel("broken-media.xlsx", "BrokenMedia", results.allBrokenMedia, "BrokenMedia");
  finalObjectFactory.utility.saveToExcel("validated-urls.xlsx", "ValidatedURLs", results.allValidatedUrls,"ValidatedURLs");

  await finalBrowser.close();
  console.log("✅ Done. Excel files written.");
});
