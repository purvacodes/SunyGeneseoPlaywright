import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(60 * 60 * 1000);

test("Validate URLs and Broken Links", async () => {
    const tempBrowser = await chromium.launch();
    const tempPage = await tempBrowser.newPage();
    const objectFactory = createObjects(tempPage, tempBrowser);

    const extractedUrlsFromExcel = await objectFactory.utility.loadExcel("basic_page.xlsx");

    const liveUrls = extractedUrlsFromExcel.map(r => ({ url: r.live, type: "live" }));
    const devUrls = extractedUrlsFromExcel.map(r => ({ url: r.dev, type: "dev" }));
    const urlQueue = [...liveUrls, ...devUrls];
    await tempBrowser.close();

    // --- Parallel execution config ---
    const results = { all: [] };
    const totalBrowsers = 5;
    const contextsPerBrowser = 5;
    const batchSize = 5;

    await Promise.all(
        Array.from({ length: totalBrowsers }, async (_, bIndex) => {
            const browser = await chromium.launch({ headless: true });

            await Promise.all(
                Array.from({ length: contextsPerBrowser }, async (_, cIndex) => {
                    const workerId = `${bIndex + 1}-${cIndex + 1}`;
                    const factory = createObjects(null, browser);
                    await factory.sitScanner.runMetadataWorker(browser, batchSize, workerId, urlQueue, results);
                })
            );

            await browser.close();
            console.log(`🛑 Browser ${bIndex + 1} closed`);
        })
    );

    // Separate live/dev again
    const liveResults = results.all.filter(r => r.type === "live");
    const devResults = results.all.filter(r => r.type === "dev");

    // Save to Excel
    const finalBrowser = await chromium.launch();
    const finalFactory = createObjects(null, finalBrowser);

    finalFactory.utility.saveToExcel("seo-metadata.xlsx", "Live", liveResults, "seo-reports");
    finalFactory.utility.saveToExcel("seo-metadata.xlsx", "Dev", devResults, "seo-reports");

    // Compare
    const diffs = seoScanner.compareMetadata(liveResults, devResults);
    finalFactory.utility.saveToExcel("seo-metadata.xlsx", "Diff", diffs, "seo-reports");

    await finalBrowser.close();

    console.log("✅ SEO metadata validation completed.");
});