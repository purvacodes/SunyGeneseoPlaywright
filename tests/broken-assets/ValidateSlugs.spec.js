import { test } from "@playwright/test";
import { SiteAudit } from "../../pages/SiteAudit.js";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";

//test.setTimeout(15 * 60 * 60 * 1000); // 6 hours


// ---------------- CONFIG ----------------
const CONFIG = {
  MAX_PARALLEL_WORKERS: 6,
  THROTTLE_DELAY_MS: 350,
  RETRY_ATTEMPTS: 2,
  REQUEST_TIMEOUT_MS: 10000,
  PROGRESS_INTERVAL_MS: 300000, // 5 minutes
  INPUT_FILE: "basic_page.xlsx",
  OUTPUT_SUBFOLDER: "url-reports",
  VALIDATED_FILE: "validated-slugs.xlsx",
  BROKEN_FILE: "broken-slugs.xlsx",
  ENV_BASE_URL: credentials.env.wordPress,

};

test("Validate Parent Page URLs", async ({}, testInfo) => {
  const { utility } = createObjects(null, null);

  // --- Load URLs from Excel ---
  const extractedUrlsFromExcel = await utility.loadExcel(CONFIG.INPUT_FILE);
  console.log(`Total URLs loaded: ${extractedUrlsFromExcel.length}`);

  // --- Split URLs among internal workers ---
  const totalWorkers = CONFIG.MAX_PARALLEL_WORKERS;
  const chunkSize = Math.ceil(extractedUrlsFromExcel.length / totalWorkers);
  const allValidated = [];
  const broken = [];

  for (let w = 0; w < totalWorkers; w++) {
    const urlsForWorker = extractedUrlsFromExcel.slice(w * chunkSize, (w + 1) * chunkSize);
    const audit = new SiteAudit(CONFIG, w + 1, urlsForWorker);
    await audit.run(); // sequential per internal worker
    allValidated.push(...audit.results);
    broken.push(...audit.broken);
  }

  // --- Save final Excel reports ---
  utility.saveToExcel(CONFIG.VALIDATED_FILE, "ValidatedUrls", allValidated, CONFIG.OUTPUT_SUBFOLDER);
  utility.saveToExcel(CONFIG.BROKEN_FILE, "BrokenLinks", broken, CONFIG.OUTPUT_SUBFOLDER);
});
