import { credentials } from "../data/credentials.js";
import { contentPostTypesUrls } from "../data/contentPostTypesUrls.js";

export class SiteScanner {
  constructor(utility) {
    this.env = credentials.env.drupal;
    this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
    this.utility = utility;
  }
  
  // --- Extract all meta tags dynamically ---
  async extractMetadata(page, url) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 });

      return await page.evaluate(() => {
        const metas = {};
        document.querySelectorAll("meta").forEach(el => {
          let key =
            el.getAttribute("name") ||
            el.getAttribute("property") ||
            el.getAttribute("http-equiv") ||
            null;
          if (key) metas[key] = el.getAttribute("content") || "";
        });

        // ✅ Optionally add title + canonical
        const titleEl = document.querySelector("title");
        if (titleEl) metas["title"] = titleEl.innerText.trim();

        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) metas["canonical"] = canonical.getAttribute("href");

        return metas;
      });
    } catch (err) {
      console.warn(`⚠️ Failed extracting metadata for ${url}: ${err.message}`);
      return {};
    }
  }

  // --- Worker loop for metadata scanning ---
  async runMetadataWorker(browser, batchSize, workerId, urlQueue, results) {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (urlQueue.length > 0) {
      const batch = urlQueue.splice(0, batchSize);

      for (const { url, type } of batch) {
        try {
          const metadata = await this.extractMetadata(page, url);
          results.all.push({
            workerId,
            url,
            type,
            metadata,
            status: "ok",
            error: null,
          });
        } catch (err) {
          results.all.push({
            workerId,
            url,
            type,
            metadata: {},
            status: "failed",
            error: err.message || "Unknown error",
          });
        }
      }
    }

    await context.close();
  }

  // --- Compare live vs dev metadata ---
  compareMetadata(liveResults, devResults) {
    const diffs = [];

    for (let i = 0; i < liveResults.length; i++) {
      const live = liveResults[i];
      const dev = devResults[i];
      const diffReport = { url_live: live.url, url_dev: dev.url, differences: [] };

      const liveMeta = live.metadata;
      const devMeta = dev.metadata;

      // Compare live → dev
      for (const key in liveMeta) {
        if (!(key in devMeta)) {
          diffReport.differences.push(`❌ Missing in Dev: ${key}`);
        } else if (liveMeta[key] !== devMeta[key]) {
          diffReport.differences.push(
            `⚠️ Value mismatch for ${key}: Live="${liveMeta[key]}" | Dev="${devMeta[key]}"`
          );
        }
      }

      // Extra in dev
      for (const key in devMeta) {
        if (!(key in liveMeta)) {
          diffReport.differences.push(`❌ Extra in Dev: ${key}`);
        }
      }

      if (diffReport.differences.length > 0) diffs.push(diffReport);
    }

    return diffs;
  }
}