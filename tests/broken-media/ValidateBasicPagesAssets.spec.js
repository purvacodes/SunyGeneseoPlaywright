import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";
import { contentPostTypesUrls } from "../../data/contentPostTypesUrls.js";


test.setTimeout(60 * 60 * 1000);

test("Verify broken media across Basic Pages", async () => {
  const cptName = contentPostTypesUrls.CPT.basicPage; // 🔹 Change this to your CPT slug

  // Step 1: Launch browser and fetch CPT URLs
  const tempBrowser = await chromium.launch();
  const context = await tempBrowser.newContext();
  const page = await context.newPage();

  const { cptHandler } = createObjects(page, tempBrowser);
  await cptHandler.getCPTUrls(cptName);

//   // Load back the CPT URLs from the Excel that getCPTUrls generated
//   const { siteScanner } = createObjects(null, tempBrowser);
//   const urls = siteScanner.loadUrlsFromExcel(
//     `./test-artifacts/broken-media/${cptName}-totalUrls-Listing.xlsx`,
//     credentials.env.wordPress
//   );

//   await tempBrowser.close();

//   // Step 2: Distribute URLs across multiple browsers
//   const totalBrowsers = 6;
//   const batchSize = 3;

//   const urlQueue = [...urls];
//   const results = {
//     allGlobalMedia: [],
//     allBrokenMedia: [],
//     allValidatedUrls: []
//   };

//   async function runWorker(browser, browserId) {
//     const { siteScanner } = createObjects(null, browser);

//     while (urlQueue.length > 0) {
//       const batch = urlQueue.splice(0, batchSize);
//       if (batch.length === 0) break;

//       try {
//         const { globalAllMedia, globalBrokenMedia, validatedUrls } =
//           await siteScanner.checkBrokenMedia(batch, batchSize, browserId);

//         results.allGlobalMedia.push(...globalAllMedia);
//         results.allBrokenMedia.push(...globalBrokenMedia);
//         results.allValidatedUrls.push(...validatedUrls);
//       } catch (err) {
//         for (const url of batch) {
//           results.allValidatedUrls.push({
//             browserId,
//             url,
//             status: "failed",
//             totalMedia: 0,
//             brokenMedia: 0,
//             error: err.message || "Unknown error"
//           });
//         }
//       }
//     }

//     await browser.close();
//   }

//   // Step 3: Run workers
//   const browsers = await Promise.all(
//     Array.from({ length: totalBrowsers }, () =>
//       chromium.launch({ headless: true })
//     )
//   );

//   await Promise.all(
//     browsers.map((browser, index) => runWorker(browser, index + 1))
//   );

//   // Step 4: Save results to Excel
//   const finalBrowser = await chromium.launch();
//   const { siteScanner: finalScanner } = createObjects(null, finalBrowser);

//   finalScanner.saveToExcel("cpt-all-media.xlsx", "AllMedia", results.allGlobalMedia);
//   finalScanner.saveToExcel("cpt-broken-media.xlsx", "BrokenMedia", results.allBrokenMedia);
//   finalScanner.saveToExcel("cpt-validated-urls.xlsx", "ValidatedURLs", results.allValidatedUrls);

//   await finalBrowser.close();

//   console.log(`✅ Done. CPT: ${cptName} results saved.`);
});
