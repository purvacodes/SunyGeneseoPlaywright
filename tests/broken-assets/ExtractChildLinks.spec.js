import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";

const finalFactory = createObjects();

// ================= CONFIG =================
const BASE_URL = "https://dev-suny-geneseo.pantheonsite.io";
const EXCEL_INPUT = "basic_page.xlsx";
const OUTPUT_DIR = "url-reports";
const BATCH_SIZE = 2;
const MAX_BROWSERS = 2;
const CONTEXTS_PER_BROWSER = 2;

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

// =============================================================
// 🔎 LINK EXTRACTOR WITH STATUS + FINAL URL
// =============================================================
class LinkExtractorWithStatus {
  constructor({ baseUrl, inputFile, outputDir, batchSize, maxBrowsers, contextsPerBrowser }) {
    this.baseUrl = baseUrl;
    this.inputFile = inputFile;
    this.outputDir = outputDir;
    this.batchSize = batchSize;
    this.maxBrowsers = maxBrowsers;
    this.contextsPerBrowser = contextsPerBrowser;

    this.results = [];
    this.globalProgress = { total: 0, completed: 0 };
  }

  async run() {
    const rows = this.loadExcel(this.inputFile);
    this.globalProgress.total = rows.length;

    const urlQueue = rows
      .filter(r => r.CPT && r.Slug)
      .map(r => ({ cpt: r.CPT.trim(), slug: r.Slug.trim() }));

    console.log(`📄 Total URLs loaded: ${urlQueue.length}`);

    let workerCount = 0;
    const allBrowserTasks = [];

    const progressTimer = setInterval(() => {
      console.log(`📊 Progress: ${this.globalProgress.completed}/${this.globalProgress.total} URLs done`);
    }, 5 * 60 * 1000);

    for (let bIndex = 0; bIndex < this.maxBrowsers; bIndex++) {
      const browser = await chromium.launch({ headless: true });
      const browserTasks = [];

      for (let cIndex = 0; cIndex < this.contextsPerBrowser; cIndex++) {
        if (workerCount >= urlQueue.length) break;

        const workerId = `B${bIndex + 1}-W${cIndex + 1}`;
        const context = await browser.newContext({ cacheEnabled: false });
        const page = await context.newPage();

        const batch = urlQueue.slice(workerCount, workerCount + this.batchSize);
        const task = this.processUrls(workerId, page, batch);
        browserTasks.push(task);

        workerCount += this.batchSize;
      }

      allBrowserTasks.push(Promise.all(browserTasks).then(() => browser.close()));
      if (workerCount >= urlQueue.length) break;
    }

    await Promise.all(allBrowserTasks);
    clearInterval(progressTimer);

    // ✅ Save results
    await finalFactory.utility.saveToExcel(
      "extractedParentAndChildLinks.xlsx",
      "ParentChildLinks",
      this.results.map(r => ({
        CPT: r.CPT,
        originalUrl: r.originalUrl,
        finalUrl: r.finalUrl,
        isRedirected: r.isRedirected,
        status: r.status,
        httpStatus: r.httpStatus,
        error: r.error || "",
        childUrl: r.childUrl || "",
        isParent: r.isParent,
      })),
      this.outputDir
    );

    console.log("✅ All done! Results saved in url-reports/");
  }

  async processUrls(workerId, page, urls) {
    for (const row of urls) {
      const { cpt, slug } = row;
      const parentUrl = this.buildUrl(slug);

      let response;
      try {
        response = await page.goto(parentUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (err) {
        console.log(`[${workerId}] ❌ Navigation error for ${parentUrl}: ${err.message}`);
        this.results.push({
          workerId,
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl: parentUrl,
          isRedirected: false,
          isParent: true,
          status: "failed",
          httpStatus: "NAV_ERROR",
          error: err.message,
        });
        continue;
      }

      if (!response) {
        console.log(`[${workerId}] ❌ No response for ${parentUrl}`);
        this.results.push({
          workerId,
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl: parentUrl,
          isRedirected: false,
          isParent: true,
          status: "failed",
          httpStatus: "NO_RESPONSE",
          error: "No response from server",
        });
        continue;
      }

      const httpStatus = response.status();
      const finalUrl = response.url();
      const isRedirected = finalUrl !== parentUrl;
      const status = httpStatus < 400 ? "ok" : "failed";

      console.log(
        `[${workerId}] ${status === "ok" ? "✅" : "❌"} Parent: ${parentUrl} → ${finalUrl} (${httpStatus})`
      );

      // Record parent
      this.results.push({
        workerId,
        CPT: cpt,
        originalUrl: parentUrl,
        finalUrl,
        isRedirected,
        isParent: true,
        status,
        httpStatus,
      });

      // Only extract links if parent page loaded successfully
      if (status === "ok") {
        const links = await this.extractLinks(page);
        console.log(`[${workerId}] 🔗 Found ${links.length} child links on ${finalUrl}`);

        for (const childUrl of links) {
          this.results.push({
            workerId,
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

      this.globalProgress.completed++;
    }
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
test("Extract parent + child links with status and redirects", async () => {
  console.log("🚀 Starting enhanced link extraction...");

  const extractor = new LinkExtractorWithStatus({
    baseUrl: BASE_URL,
    inputFile: EXCEL_INPUT,
    outputDir: OUTPUT_DIR,
    batchSize: BATCH_SIZE,
    maxBrowsers: MAX_BROWSERS,
    contextsPerBrowser: CONTEXTS_PER_BROWSER,
  });

  await extractor.run();

  console.log("✅ Done! Extracted parent + child links with status info.");
});
