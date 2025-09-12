// siteScanner.js
import * as XLSX from "xlsx";
import fs from "fs";
import { contentPostTypesUrls } from '../data/contentPostTypesUrls.js';
import { credentials } from '../data/credentials.js';

export class SiteScanner {
  constructor(utility) {
    this.env = credentials.env.wordPress;
    this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
    this.utility = utility;
  }

  async collectUrlsToScan(browser, baseUrl, baseName, count) {
    const sitemapUrls = await this.utility.getUrlsfromSitemap(baseUrl, baseName, count);
    let allUrls = [];

    const page = await browser.newPage();

    for (const sitemapUrl of sitemapUrls) {
      try {
        await page.goto(sitemapUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const continueBtn = page.getByRole('button', { name: 'Continue' });
        if (await continueBtn.isVisible().catch(() => false)) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
            continueBtn.click(),
          ]);
        }
        await page.waitForTimeout(500);

        const urls = await page.locator('tbody tr td a').allTextContents();
        allUrls = allUrls.concat(urls);
        console.log(`Collected ${urls.length} URLs from: ${sitemapUrl}`);
      } catch (error) {
        console.error(`❌ Error while processing ${sitemapUrl}:`, error);
      }
    }

    await page.close();
    await this.utility.saveUrlsToExcel(allUrls, baseName);
  }

 async runWorker(browser, batchSize, browserId, urlQueue, results) {
  while (urlQueue.length > 0) {
    const batch = urlQueue.splice(0, batchSize);
    if (batch.length === 0) break;

    try {
      // 👉 pass batch directly (no more batching inside checkBrokenMedia)
      const { allMedia, brokenMedia, validatedUrls } =
        await this.checkBrokenMedia(browser, batch, browserId);

      results.allGlobalMedia.push(...allMedia);
      results.allBrokenMedia.push(...brokenMedia);
      results.allValidatedUrls.push(...validatedUrls);
    } catch (err) {
      for (const url of batch) {
        results.allValidatedUrls.push({
          browserId,
          url,
          status: "failed",
          totalMedia: 0,
          brokenMedia: 0,
          error: err.message || "Unknown error"
        });
      }
    }
  }
}

  // --- Resolve relative URLs ---
  resolveUrl(base, relative) {
    try {
      return new URL(relative, base).href;
    } catch {
      return null;
    }
  }

  // --- Check media status via HTTP HEAD ---
  async checkMediaStatus(mediaUrl) {
    try {
      const res = await fetch(mediaUrl, { method: "HEAD" });
      return { url: mediaUrl, status: res.status, ok: res.ok };
    } catch {
      return { url: mediaUrl, status: "FETCH_ERROR", ok: false };
    }
  }

  // --- Scan a single page for media ---
  async findBrokenMediaOnPage(browser, url, browserId) {
     const context = await browser.newContext();
  const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });

      const continueButton = page.getByRole("button", { name: "Continue" });
      if (await continueButton.count()) {
        await continueButton.click();
      }

      await page.waitForLoadState("networkidle", { timeout: 60000 });

      // Scroll to load lazy content
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let totalHeight = 0;
          const distance = 300;
          let lastScrollHeight = 0;
          let attempts = 0;

          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (scrollHeight === lastScrollHeight) {
              attempts++;
            } else {
              attempts = 0;
            }
            lastScrollHeight = scrollHeight;

            if (totalHeight >= scrollHeight || attempts > 5 || totalHeight > 20000) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });

      // Extract media elements
      const mediaSources = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll("img[src]").forEach(el =>
          results.push({ type: "image", src: el.getAttribute("src") })
        );
        document.querySelectorAll("video[src], video source[src]").forEach(el =>
          results.push({ type: "video", src: el.getAttribute("src") })
        );

        const fileRegex = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp)(\?.*)?$/i;
        document.querySelectorAll("a[href], embed[src], iframe[src], object[data]").forEach(el => {
          let src = el.href || el.src || el.getAttribute("data");
          if (src && fileRegex.test(src)) {
            const match = src.match(fileRegex);
            const ext = match ? match[1].toLowerCase() : "file";
            results.push({ type: ext, src });
          }
        });
        return results;
      });

      const uniqueMedia = [...new Map(mediaSources.map(item => [item.src, item])).values()];
      if (uniqueMedia.length === 0) {
        console.log(`ℹ️ No media to check on ${url}`);
        return { allMedia: [], brokenMedia: [] };
      }

      const allMedia = [];
      const brokenMedia = [];

      for (const media of uniqueMedia) {
        const fullUrl = this.resolveUrl(url, media.src);
        if (!fullUrl) continue;

        const status = await this.checkMediaStatus(fullUrl);

        const mediaItem = {
          browserId,
          parentPage: url,
          fullUrl: fullUrl,
          type: media.type,
          src: media.src,
          status: status.status,
        };

        allMedia.push(mediaItem);

        if (!status.ok) {
          brokenMedia.push(mediaItem);
        }
      }

      return { allMedia, brokenMedia };
    } catch (err) {
      console.warn(`⚠️ Error scanning ${url}: ${err.message}`);
      return { allMedia: [], brokenMedia: [] };
    } finally {
      await context.close();
    }
  }

  // --- Scan multiple URLs ---
  // simplified: no more batching here
async checkBrokenMedia(browser, urls, browserId = 1) {
  const allMedia = [];
  const brokenMedia = [];
  const validatedUrls = [];

  const results = await Promise.allSettled(
    urls.map(url => this.findBrokenMediaOnPage(browser, url, browserId))
  );

  results.forEach((res, idx) => {
    const url = urls[idx];
    if (res.status === "fulfilled") {
      const { allMedia: pageMedia, brokenMedia: pageBroken } = res.value;
      allMedia.push(...pageMedia);
      brokenMedia.push(...pageBroken);

      validatedUrls.push({
        browserId,
        url,
        status: "success",
        totalMedia: pageMedia.length,
        brokenMedia: pageBroken.length
      });
    } else {
      console.error(`❌ Failed scanning ${url}: ${res.reason?.message || res.reason}`);
      validatedUrls.push({
        browserId,
        url,
        status: "failed",
        totalMedia: 0,
        brokenMedia: 0,
        error: res.reason?.message || "Unknown error"
      });
    }
  });

  return {
    allMedia,
    brokenMedia,
    validatedUrls
  };
}

}
