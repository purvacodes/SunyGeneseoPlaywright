import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(5 * 60 * 60 * 1000); // 2 hours

test("Validate URLs and Broken Links", async () => {
  // --- Setup phase ---
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);

  const extractedUrlsFromExcel = await objectFactory.utility.loadExcel("basic_page.xlsx");
  await tempBrowser.close();

  console.log(`Total URLs loaded: ${extractedUrlsFromExcel.length}`);

  const results = { allValidated: [], broken: [] };

  // --- Config ---
  const totalBrowsers = 2;
  const contextsPerBrowser = 5;
  const tabsPerContext = 5;
  const batchSize = 50;
  const logInterval = 5 * 60 * 1000; // log every 5 minutes
  let lastLogTime = Date.now();

  // --- Step 1: Split URLs among total workers ---
  const totalWorkers = totalBrowsers * contextsPerBrowser * tabsPerContext;
  const urlChunks = objectFactory.utility.chunkArray(extractedUrlsFromExcel, totalWorkers);
  let workerCounter = 0;

  await Promise.all(
    Array.from({ length: totalBrowsers }).map(async (_, bIndex) => {
      const browser = await chromium.launch({ headless: true });

      const contexts = await Promise.all(
        Array.from({ length: contextsPerBrowser }).map(async (_, cIndex) => {
          const context = await browser.newContext();

          const pages = await Promise.all(
            Array.from({ length: tabsPerContext }).map(() => context.newPage())
          );

          await Promise.all(
            pages.map(async (page) => {
              const workerId = `B${bIndex + 1}-C${cIndex + 1}-T${workerCounter + 1}`;
              workerCounter++;

              const workerQueue = urlChunks.pop() || [];

              while (workerQueue.length > 0) {
                const batch = workerQueue.splice(0, batchSize);

                for (const url of batch) {
                  try {
                    const records = await objectFactory.siteScannerOld.checkParentPage(
                      page,
                      url,
                      workerId
                    );

                    results.allValidated.push(...records);
                    results.broken.push(...records.filter((r) => r.status === "failed"));
                  } catch (err) {
                    console.error(`⚠️ [${workerId}] Failed ${url}: ${err.message}`);
                  }

                  // --- Log progress every 5 minutes ---
                  const now = Date.now();
                  if (now - lastLogTime >= logInterval) {
                    lastLogTime = now;
                    console.log(`ℹ️ Progress: ${results.allValidated.length} URLs validated so far`);
                  }
                }
              }

              await page.close();
            })
          );

          await context.close();
        })
      );

      await browser.close();
      console.log(`🛑 Browser ${bIndex + 1} closed`);
    })
  );

  // --- Save results ---
  const finalBrowser = await chromium.launch();
  const finalFactory = createObjects(null, finalBrowser);

  console.log("💾 Saving results...");

  await finalFactory.utility.saveToExcel(
    "validated-urls.xlsx",
    "ValidatedUrls",
    results.allValidated,
    "url-reports"
  );

  await finalFactory.utility.saveToExcel(
    "broken-links.xlsx",
    "BrokenLinks",
    results.broken,
    "url-reports"
  );

  await finalBrowser.close();

  console.log("✅ URL validation complete.");
});
