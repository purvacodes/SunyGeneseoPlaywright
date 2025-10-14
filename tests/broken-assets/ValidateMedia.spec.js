// 🔥 tests/verify-media-assets.test.js
import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(6 * 60 * 60 * 1000); // 6 hours max

test("Verify Media Assets across pages (parallel, retry, progress)", async () => {
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);

  const extractedUrlsFromExcel = await objectFactory.utility.loadExcel("basic_page.xlsx");
  await tempBrowser.close();

  console.log(`📄 Total URLs loaded: ${extractedUrlsFromExcel.length}`);

  const urlQueue = [...extractedUrlsFromExcel];
  const totalUrls = urlQueue.length;

  const results = { allGlobalMedia: [], allBrokenMedia: [], validatedPages: [] };
  const globalProgress = { total: totalUrls, completed: 0 };

  // 🧮 Parallelism strategy
  const batchSize = 2;
  let maxBrowsers = totalUrls > 400 ? 1 : 2;
  let contextsPerBrowser = totalUrls > 400 ? 2 : 3;
  const totalAvailableWorkers = maxBrowsers * contextsPerBrowser;
  const totalRequiredWorkers = Math.min(Math.ceil(totalUrls / batchSize), totalAvailableWorkers);

  console.log(`🧮 Total workers needed: ${totalRequiredWorkers}`);

  let workerCount = 0;
  const allBrowserTasks = [];

  // 🕒 Progress log every 5 minutes
  const progressTimer = setInterval(() => {
    console.log(`⏱️ [${new Date().toLocaleTimeString()}] Progress: ${globalProgress.completed}/${globalProgress.total} URLs validated`);
  }, 5 * 60 * 1000);

  // 🧵 Launch browsers
  for (let bIndex = 0; bIndex < maxBrowsers; bIndex++) {
    const browser = await chromium.launch({ headless: true });
    const browserTasks = [];

    const factory = createObjects(null, browser, {
      batchDelayMs: 2000,
      browserLaunchDelayMs: 3000,
    });


    for (let cIndex = 0; cIndex < contextsPerBrowser; cIndex++) {
      if (workerCount >= totalRequiredWorkers) break;

      const workerId = `B${bIndex + 1}-W${cIndex + 1}`;

      const task = factory.siteScanner.runMediaCheckerWorker(
        browser,
        batchSize,
        workerId,
        urlQueue,
        results,
        globalProgress
      );

      browserTasks.push(task);
      workerCount++;
    }

    allBrowserTasks.push(
      Promise.all(browserTasks).then(() => {
        console.log(`🛑 Browser ${bIndex + 1} completed and closed`);
        return browser.close();
      })
    );

    if (workerCount >= totalRequiredWorkers) break;
  }

  await Promise.all(allBrowserTasks);
  clearInterval(progressTimer);

  // 🧾 Save results
  const finalBrowser = await chromium.launch();
  const finalFactory = createObjects(null, finalBrowser);

  await finalFactory.utility.saveToExcel("all-media.xlsx", "AllMedia", results.allGlobalMedia, "media-reports");
  await finalFactory.utility.saveToExcel("broken-media.xlsx", "BrokenMedia", results.allBrokenMedia, "media-reports");
  await finalFactory.utility.saveToExcel("validated-media.xlsx", "ValidatedMedia", results.validatedPages, "media-reports");

  await finalBrowser.close();
  console.log(`✅ Done. Reports saved in media-reports/.`);
});
