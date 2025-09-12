import { test, expect, chromium } from '@playwright/test';
import { createObjects } from '../../pages/ObjectFactory.js';
import { credentials } from "../../data/credentials.js";
import * as XLSX from 'xlsx';
import fs from 'fs';
import { contentPostTypesUrls } from "../../data/contentPostTypesUrls.js";
import { Utility } from '../../pages/Utility.js';

test('Verify broken media across Basic Pages CPT', async () => {
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);

  // 1. Collect URLs
  await objectFactory.siteScanner.collectUrlsToScan(
    tempBrowser,
    credentials.env.wordPress,
    contentPostTypesUrls.CPT.basicPage,
    5
  );

  // 2. Load collected URLs from Excel
  const extractedUrlsFromExcel = objectFactory.utility.loadUrlsFromExcel(
    `${contentPostTypesUrls.CPT.basicPage}`,
    credentials.env.wordPress
  );

  await tempBrowser.close();

  // 3. Prepare queue
  const totalBrowsers = 7;
  const batchSize = 3;
  const urlQueue = [...extractedUrlsFromExcel];
  const results = {
    allGlobalMedia: [],
    allBrokenMedia: [],
    allValidatedUrls: []
  };

  // 4. Launch parallel workers
  await Promise.all(
    Array.from({ length: totalBrowsers }, async (_, index) => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const factory = createObjects(page, browser);

      try {
        await factory.siteScanner.runWorker(browser, batchSize, index + 1, urlQueue, results);
      } finally {
        await browser.close();
      }
    })
  );

  // 5. Save results
  const finalBrowser = await chromium.launch();
  const finalObjectFactory = createObjects(null, finalBrowser);

  finalObjectFactory.utility.saveToExcel("all-media.xlsx", "AllMedia", results.allGlobalMedia);
  finalObjectFactory.utility.saveToExcel("broken-media.xlsx", "BrokenMedia", results.allBrokenMedia);
  finalObjectFactory.utility.saveToExcel("validated-urls.xlsx", "ValidatedURLs", results.allValidatedUrls);

  await finalBrowser.close();

  console.log("✅ Done. Excel files written.");
});

