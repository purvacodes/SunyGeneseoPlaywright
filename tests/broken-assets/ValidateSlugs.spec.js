// 🔥 tests/validate-urls.test.js
import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(30 * 60 * 60 * 1000); // 15 hours

test("Validate URLs and Broken Links (CPT + Slug support, normalized headers)", async () => {
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);
  // 🔄 Clear any old caches from previous runs
if (objectFactory.siteScanner.mediaCache) factory.siteScanner.mediaCache.clear?.();
if (objectFactory.siteScanner.linkCache) factory.siteScanner.linkCache.clear?.();

  const extractedRows = await objectFactory.utility.loadUrlswithCPT("basic_page.xlsx");
  await tempBrowser.close();


  if (!Array.isArray(extractedRows) || extractedRows.length === 0) {
    console.error("❌ No rows found in Excel or invalid format.");
    return;
  }

  // 🧹 Normalize keys (remove spaces, lowercase)
  const normalizedRows = extractedRows.map(row => {
    const normalized = {};
    for (const key in row) {
      if (key) normalized[key.trim().toLowerCase()] = row[key];
    }
    return normalized;
  });

  // ✅ Filter and build queue from CPT + Slug
  const urlQueue = normalizedRows
    .filter(r => r.cpt && r.slug)
    .map(r => {
      const cpt = r.cpt.trim();
      let slug = r.slug.trim();
      if (!slug.startsWith("/")) slug = "/" + slug;
      return { cpt, originalUrl: slug };
    });

  if (urlQueue.length === 0) {
    console.error("❌ No valid CPT/Slug rows found in Excel after normalization.");
    return;
  }

  console.log(`📄 Total URLs loaded: ${urlQueue.length}`);

  const totalUrls = urlQueue.length;
  const results = { allValidated: [], broken: [] };
  const globalProgress = { total: totalUrls, completed: 0 };

  const batchSize = 2;
  let maxBrowsers = totalUrls > 400 ? 1 : 2;
  let contextsPerBrowser = totalUrls > 400 ? 2 : 3;
  const totalAvailableWorkers = maxBrowsers * contextsPerBrowser;
  const totalRequiredWorkers = Math.min(
    Math.ceil(totalUrls / batchSize),
    totalAvailableWorkers
  );

  console.log(`🧮 Total workers needed: ${totalRequiredWorkers}`);

  let workerCount = 0;
  const allBrowserTasks = [];

  const progressTimer = setInterval(() => {
    console.log(
      `⏱️ [${new Date().toLocaleTimeString()}] Progress: ${globalProgress.completed}/${globalProgress.total} URLs validated`
    );
  }, 5 * 60 * 1000);

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
  const context = await browser.newContext();
  await context.clearCookies();
  await context.storageState({ path: 'empty.json' });
      const task = factory.siteScanner.runLinkCheckerWorker(
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

  // ✅ Save with CPT column
  const finalBrowser = await chromium.launch();
  const finalFactory = createObjects(null, finalBrowser);

  await finalFactory.utility.saveToExcel(
    "validated-slugs.xlsx",
    "ValidatedSlugs",
    results.allValidated.map(r => ({
      CPT: r.cpt || "",
      originalUrl: r.originalUrl || "",
      finalUrl: r.finalUrl || "",
      isRedirected: r.isRedirected,
      childUrl: r.childUrl,
      isParent: r.isParent,
      status: r.status,
      httpStatus: r.httpStatus,
      error: r.error,
    })),
    "url-reports"
  );

  await finalFactory.utility.saveToExcel(
    "broken-slugs.xlsx",
    "BrokenSlugs",
    results.broken.map(r => ({
      CPT: r.cpt || "",
      originalUrl: r.originalUrl || "",
      finalUrl: r.finalUrl || "",
      isRedirected: r.isRedirected,
      childUrl: r.childUrl,
      isParent: r.isParent,
      status: r.status,
      httpStatus: r.httpStatus,
      error: r.error,
    })),
    "url-reports"
  );

  await finalBrowser.close();
  console.log(`✅ Done. Results saved in url-reports/.`);
});
