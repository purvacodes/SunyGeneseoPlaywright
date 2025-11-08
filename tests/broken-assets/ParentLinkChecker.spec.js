import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";

const finalFactory = createObjects();

// ================= CONFIG =================
const BASE_URL = "https://dev-suny-geneseo.pantheonsite.io";
const EXCEL_INPUT = "Inventory.xlsx";
const OUTPUT_DIR = "url-reports";

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

class ParentLinkCheckerSequential {
  constructor({ baseUrl, inputFile, outputDir }) {
    this.baseUrl = baseUrl;
    this.inputFile = inputFile;
    this.outputDir = outputDir;
    this.results = [];
  }

  async run() {
    const rows = this.loadExcel(this.inputFile);
    const urlQueue = rows
      .filter(r => r.CPT && r.Slug)
      .map(r => ({ cpt: r.CPT.trim(), slug: r.Slug.trim() }));

    console.log(`📄 Total Parent URLs loaded: ${urlQueue.length}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ cacheEnabled: false });
    const page = await context.newPage();

    let completed = 0;

    for (const row of urlQueue) {
      const { cpt, slug } = row;
      const parentUrl = this.buildUrl(slug);

      try {
        // Wait for page to be fully idle before next navigation
        await page.waitForTimeout(500);

        const response = await page.goto(parentUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });

        if (!response) throw new Error("No response from server");

        const httpStatus = response.status();
        const finalUrl = response.url();
        const isRedirected = finalUrl !== parentUrl;
        const status = httpStatus < 400 ? "ok" : "failed";

        console.log(
          `${status === "ok" ? "✅" : "❌"} Parent: ${parentUrl} → ${finalUrl} (${httpStatus})`
        );

        this.results.push({
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl,
          isRedirected,
          isParent: true,
          status,
          httpStatus,
        });
      } catch (err) {
        console.log(`❌ Error on ${parentUrl}: ${err.message}`);
        this.results.push({
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl: parentUrl,
          isRedirected: false,
          isParent: true,
          status: "failed",
          httpStatus: "NAV_ERROR",
          error: err.message,
        });

        // Small delay before continuing to next URL (reduces race conditions)
        await page.waitForTimeout(1000);
      }

      completed++;
      console.log(`📊 Progress: ${completed}/${urlQueue.length}`);
    }

    await browser.close();

    // ✅ Save results
    await finalFactory.utility.saveToExcel(
      "checkedParentLinks.xlsx",
      "ParentLinks",
      this.results,
      this.outputDir
    );

    console.log("✅ All done! Results saved in url-reports/");
  }

  buildUrl(slug) {
    const cleanSlug = slug.replace(/^\//, "");
    return `${this.baseUrl}/${cleanSlug}`;
  }

  loadExcel(file) {
    const wb = XLSX.readFile(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws);
  }
}

// =============================================================
// 🧪 PLAYWRIGHT TEST
// =============================================================
test("Check only parent URLs (Sequential + Stable)", async () => {
  console.log("🚀 Starting parent URL check...");

  const checker = new ParentLinkCheckerSequential({
    baseUrl: BASE_URL,
    inputFile: EXCEL_INPUT,
    outputDir: OUTPUT_DIR,
  });

  await checker.run();

  console.log("✅ Done! Checked all parent URLs sequentially.");
});
