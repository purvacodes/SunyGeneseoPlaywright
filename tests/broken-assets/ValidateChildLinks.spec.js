// 🔥 tests/ValidateLinksStandalone.test.js
import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";
import path from "path";

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
// 🔧 FULL LINK VALIDATOR CLASS (combined in same file)
// =============================================================
class LinkValidator {
  constructor({ baseUrl, inputFile, outputDir, batchSize, maxBrowsers, contextsPerBrowser }) {
    this.baseUrl = baseUrl;
    this.inputFile = inputFile;
    this.outputDir = outputDir;
    this.batchSize = batchSize;
    this.maxBrowsers = maxBrowsers;
    this.contextsPerBrowser = contextsPerBrowser;

    this.results = { allValidated: [], broken: [] };
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
    // ✅ Group results by parent URL (CPT + parent URL)
    const groupedResults = this.results.allValidated.reduce((acc, r) => {
      const key = r.originalUrl; // use parent URL as key
      if (!acc[key]) acc[key] = { parent: null, children: [] };

      if (r.isParent) {
        acc[key].parent = r;
      } else {
        acc[key].children.push(r);
      }

      return acc;
    }, {});

    // Flatten grouped results: parent first, then children
    const sortedFlattened = [];
    Object.values(groupedResults).forEach(group => {
      if (group.parent) sortedFlattened.push(group.parent);
      sortedFlattened.push(...group.children);
    });

    // Save to Excel
    await finalFactory.utility.saveToExcel(
  "validatedChildLinks.xlsx",
  "ValidatedChildLinks",
  sortedFlattened.map(r => ({
    CPT: r.CPT || "",
    originalUrl: r.originalUrl || "",
    finalUrl: r.finalUrl || "", // Here, only redirected URLs should appear in `finalUrl`
    isRedirected: r.isRedirected || false,
    childUrl: r.childUrl || "",
    isParent: r.isParent,
    status: r.status || "",
    httpStatus: r.httpStatus || "",
    error: r.error || "",
  })),
  this.outputDir
);




    console.log("✅ All done! Results saved in url-reports/");
  }

 async processUrls(workerId, page, urls) {
  for (const row of urls) {
    const { cpt, slug } = row;
    const parentUrl = this.buildUrl(slug);

    // ================= PARENT CHECK (using goto) =================
    let parentResponse;
    try {
      parentResponse = await page.goto(parentUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (err) {
      console.log(`[${workerId}] ❌ Parent navigation error → ${parentUrl} (${err.message})`);
      this.results.broken.push({
        workerId,
        CPT: cpt,
        originalUrl: parentUrl,
        finalUrl: parentUrl,
        isParent: true,
        status: "failed",
        httpStatus: "NAV_ERROR",
        error: err.message,
      });
      continue;
    }

    if (!parentResponse) {
      console.log(`[${workerId}] ❌ No response for parent ${parentUrl}`);
      this.results.broken.push({
        workerId,
        CPT: cpt,
        originalUrl: parentUrl,
        finalUrl: parentUrl,
        isParent: true,
        status: "failed",
        httpStatus: "NO_RESPONSE",
        error: "No response object from Playwright",
      });
      continue;
    }

    const parentStatus = parentResponse.status();
    const finalParentUrl = parentResponse.url();
    const isRedirected = finalParentUrl !== parentUrl;

    this.globalProgress.completed++;

    if (parentStatus >= 400) {
      console.log(`[${workerId}] ❌ Parent failed → ${parentUrl} (${parentStatus})`);
      this.results.broken.push({
        workerId,
        CPT: cpt,
        originalUrl: parentUrl,
        finalUrl: finalParentUrl,
        isParent: true,
        isRedirected,
        status: "failed",
        httpStatus: parentStatus,
        error: "Parent page returned error status",
      });
      continue;
    }

    console.log(`[${workerId}] ✅ Parent OK → ${parentUrl} (${parentStatus})`);
    this.results.allValidated.push({
      workerId,
      CPT: cpt,
      originalUrl: parentUrl,
      finalUrl: isRedirected ? finalParentUrl : parentUrl, // Only set redirected URL if redirected
      isRedirected,
      isParent: true,
      status: "ok",
      httpStatus: parentStatus,
    });

    // ================= CHILD LINKS =================
    const childLinks = await this.extractLinks(page);
    console.log(`[${workerId}] 🔗 Found ${childLinks.length} child links on ${parentUrl}`);

    if (childLinks.length === 0) continue;

    for (const childUrl of childLinks) {
      try {
        const childResponse = await page.goto(childUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        if (!childResponse) {
          this.results.broken.push({
            workerId,
            CPT: cpt,
            originalUrl: parentUrl,
            finalUrl: parentUrl,
            childUrl,
            isParent: false,
            status: "failed",
            httpStatus: "NO_RESPONSE",
            error: "No response object for child link",
          });
          continue;
        }

        const childStatus = childResponse.status();
        const childFinalUrl = childResponse.url();
        const isChildRedirected = childFinalUrl !== childUrl;

        const statusStr = childStatus < 400 ? "ok" : "failed";
        const list = childStatus < 400 ? this.results.allValidated : this.results.broken;

        console.log(`[${workerId}] → Child: ${childUrl} → ${statusStr} (${childStatus})`);

        list.push({
          workerId,
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl: isChildRedirected ? childFinalUrl : childUrl, // Only set redirected URL if redirected
          isRedirected: isChildRedirected,
          childUrl,
          isParent: false,
          status: statusStr,
          httpStatus: childStatus,
        });
      } catch (err) {
        console.log(`[${workerId}] 🚨 Error visiting child ${childUrl}: ${err.message}`);
        this.results.broken.push({
          workerId,
          CPT: cpt,
          originalUrl: parentUrl,
          finalUrl: parentUrl,
          childUrl,
          isParent: false,
          status: "failed",
          httpStatus: "NAV_ERROR",
          error: err.message,
        });
      }
    }

    // ✅ Go back to parent page before next child batch
    await page.goto(parentUrl, { waitUntil: "domcontentloaded" });
  }
}



  buildUrl(slug) {
    const cleanSlug = slug.replace(/^\//, "");
    return `${this.baseUrl}/${cleanSlug}`;
  }

  async checkUrl(url) {
    const freshUrl = url.includes("?") ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
    const headers = { "Cache-Control": "no-cache", "User-Agent": `LinkValidator/${Date.now()}` };
    try {
      let res = await fetch(freshUrl, { method: "HEAD", headers });
      if (res.status === 405 || res.status === 501)
        res = await fetch(freshUrl, { method: "GET", headers });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: "FETCH_ERROR", error: err.message };
    }
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
// 🧪 PLAYWRIGHT TEST (uses class above)
// =============================================================
test("Validate parent + child links using single-file LinkValidator", async () => {
  console.log("🚀 Starting Link Validation...");

  const validator = new LinkValidator({
    baseUrl: BASE_URL,
    inputFile: EXCEL_INPUT,
    outputDir: OUTPUT_DIR,
    batchSize: BATCH_SIZE,
    maxBrowsers: MAX_BROWSERS,
    contextsPerBrowser: CONTEXTS_PER_BROWSER,
  });

  await validator.run();

  console.log("✅ Done! All parent + child links validated and Excel saved.");
});
