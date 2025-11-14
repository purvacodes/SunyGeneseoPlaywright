import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";

const finalFactory = createObjects();

// ================= CONFIG =================
const BASE_URL = "https://www.geneseo.edu";
const EXCEL_INPUT = "Inventory.xlsx";
const OUTPUT_DIR = "url-reports";

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

class LinkExtractorSequential {
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

    console.log(`📄 Total URLs loaded: ${urlQueue.length}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ cacheEnabled: false });
    const page = await context.newPage();

    let completed = 0;

    for (const row of urlQueue) {
      const { cpt, slug } = row;
      const parentUrl = this.buildUrl(slug);

      try {
        let response;

        try {
          response = await page.goto(parentUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        } catch (err) {
          // ✅ Handle navigation interruptions gracefully
          if (
            err.message.includes("Navigation to") &&
            err.message.includes("interrupted")
          ) {
            console.warn(`⚠️ Navigation interrupted, retrying once: ${parentUrl}`);
            // Wait a bit and retry once
            await page.waitForTimeout(3000);
            response = await page.goto(parentUrl, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
          } else {
            throw err; // rethrow other errors
          }
        }

        if (!response) throw new Error("No response from server");

        const httpStatus = response.status();
        const finalUrl = page.url();
        const isRedirected = finalUrl !== parentUrl;
        const status = httpStatus < 400 ? "ok" : "failed";

        console.log(
          `${status === "ok" ? "✅" : "❌"} Parent: ${parentUrl} → ${finalUrl} (${httpStatus})`
        );

        // Record parent
        this.results.push({
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl,
          isRedirected,
          isParent: true,
          status,
          httpStatus,
        });

        if (status === "ok") {
          const links = await this.extractLinks(page);
          console.log(`🔗 Found ${links.length} child links on ${finalUrl}`);

          for (const childUrl of links) {
            this.results.push({
              CPT: cpt,
              originalUrl: parentUrl,
              finalUrl,
              isRedirected,
              isParent: false,
              status: "extracted",
              httpStatus,
              childUrl,
            });
          }
        }
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
      }


      completed++;
      console.log(`📊 Progress: ${completed}/${urlQueue.length}`);
    }

    await browser.close();

    // ✅ Save results
    await finalFactory.utility.saveToExcel(
      "extractedParentAndChildLinks.xlsx",
      "ParentChildLinks",
      this.results,
      this.outputDir
    );

    console.log("✅ All done! Results saved in url-reports/");
  }

  buildUrl(slug) {
    const cleanSlug = slug.replace(/^\//, "");
    return `${this.baseUrl}/${cleanSlug}`;
  }

  async extractLinks(page) {
    const links = await page.$$eval("a[href]", anchors =>
      anchors
        .filter(
          el =>
            el.href &&
            !el.href.startsWith("mailto:") &&
            !el.href.startsWith("#") &&
            !el.href.startsWith("tel:") &&
            !el.classList?.contains?.("menu-link")
        )
        .map(el => el.href.trim())
    );
    return [...new Set(links)].map(u => u.replace(/\?.*$/, ""));
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
test("Extract parent + child links (Sequential + Stable)", async () => {
  console.log("🚀 Starting sequential link extraction...");

  const extractor = new LinkExtractorSequential({
    baseUrl: BASE_URL,
    inputFile: EXCEL_INPUT,
    outputDir: OUTPUT_DIR,
  });

  await extractor.run();

  console.log("✅ Done! Extracted all URLs sequentially.");
});
