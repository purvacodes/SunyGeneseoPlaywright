import { credentials } from "../data/credentials.js";
import { contentPostTypesUrls } from "../data/contentPostTypesUrls.js";

export class SiteScanner {
  constructor(utility) {
    this.env = credentials.env.wordPress;
    this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
    this.utility = utility;

    // ✅ Cache to avoid duplicate HEAD checks
    if (!SiteScanner.mediaCache) {
      SiteScanner.mediaCache = new Map();
    }
  }

  // --- Collect URLs from sitemap and save to Excel ---
  async collectUrlsToScan(browser, baseUrl, baseName, count) {
    const sitemapUrls = await this.utility.getUrlsfromSitemap(baseUrl, baseName, count);
    let allUrls = [];

    const page = await browser.newPage();

    for (const sitemapUrl of sitemapUrls) {
      try {
        await page.goto(sitemapUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

        const continueBtn = page.getByRole("button", { name: "Continue" });
        if (await continueBtn.isVisible().catch(() => false)) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
            continueBtn.click(),
          ]);
        }
        await page.waitForTimeout(500);

        const urls = await page.locator("tbody tr td a").allTextContents();
        allUrls = allUrls.concat(urls);
        console.log(`📥 Collected ${urls.length} URLs from: ${sitemapUrl}`);
      } catch (error) {
        console.error(`❌ Error while processing ${sitemapUrl}:`, error);
      }
    }

    await page.close();
    await this.utility.saveUrlsToExcel(allUrls, baseName);
  }

  // --- Worker loop ---
  async runWorker(browser, batchSize, browserId, urlQueue, results) {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (urlQueue.length > 0) {
      const batch = urlQueue.splice(0, batchSize);

      for (const url of batch) {
        try {
          const { allMedia, brokenMedia } = await this.findBrokenMediaOnPage(page, url, browserId);

          results.allGlobalMedia.push(...allMedia);
          results.allBrokenMedia.push(...brokenMedia);
          results.allValidatedUrls.push({
            browserId,
            url,
            status: "ok",
            mediaCount: allMedia.length,
            brokenCount: brokenMedia.length,
          });
        } catch (err) {
          console.warn(`⚠️ Error scanning ${url}: ${err.message}`);
          results.allBrokenMedia.push({ browserId, url, error: err.message });
          results.allValidatedUrls.push({
            browserId,
            url,
            status: "failed",
            error: err.message,
          });
        }
      }
    }

    await context.close();
  }

  // --- Resolve relative URLs ---
  resolveUrl(base, relative) {
    try {
      return new URL(relative, base).href;
    } catch {
      return null;
    }
  }

  // --- Cached HEAD request ---
  async checkMediaStatus(mediaUrl) {
    if (SiteScanner.mediaCache.has(mediaUrl)) {
      return SiteScanner.mediaCache.get(mediaUrl);
    }

    try {
      const res = await fetch(mediaUrl, { method: "HEAD" });
      const result = { url: mediaUrl, status: res.status, ok: res.ok };
      SiteScanner.mediaCache.set(mediaUrl, result);
      return result;
    } catch {
      const result = { url: mediaUrl, status: "FETCH_ERROR", ok: false };
      SiteScanner.mediaCache.set(mediaUrl, result);
      return result;
    }
  }

  // --- Scan one page ---
  async findBrokenMediaOnPage(page, url, browserId) {
    try {
      await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });

      const continueButton = page.getByRole("button", { name: "Continue" });
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
        await page.waitForLoadState("domcontentloaded");
      }

      await page.waitForLoadState("networkidle", { timeout: 60000 });

      // ✅ Optimized scroll
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let totalHeight = 0;
          const distance = 400;
          let lastScrollHeight = 0;
          let idleCycles = 0;

          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (scrollHeight === lastScrollHeight) {
              idleCycles++;
            } else {
              idleCycles = 0;
            }
            lastScrollHeight = scrollHeight;

            if (totalHeight >= 10000 || idleCycles > 2) {
              clearInterval(timer);
              resolve();
            }
          }, 150);
        });
      });

      // Extract media
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
      const allMedia = [];
      const brokenMedia = [];

      for (const media of uniqueMedia) {
        const fullUrl = this.resolveUrl(url, media.src);
        if (!fullUrl) continue;

        const status = await this.checkMediaStatus(fullUrl);

        const mediaItem = {
          browserId,
          parentPage: url,
          fullUrl,
          type: media.type,
          src: media.src,
          status: status.status,
        };

        allMedia.push(mediaItem);
        if (!status.ok) brokenMedia.push(mediaItem);
      }

      return { allMedia, brokenMedia };
    } catch (err) {
      console.warn(`⚠️ Error scanning ${url}: ${err.message}`);
      return { allMedia: [], brokenMedia: [] };
    }
  }

  // --- Helper: scan multiple URLs with one page (sequential) ---
  async checkBrokenMedia(page, urls, browserId = 1) {
    const allMedia = [];
    const brokenMedia = [];
    const validatedUrls = [];

    for (const url of urls) {
      try {
        const { allMedia: pageMedia, brokenMedia: pageBroken } =
          await this.findBrokenMediaOnPage(page, url, browserId);

        allMedia.push(...pageMedia);
        brokenMedia.push(...pageBroken);

        validatedUrls.push({
          browserId,
          url,
          status: "success",
          totalMedia: pageMedia.length,
          brokenMedia: pageBroken.length,
        });
      } catch (err) {
        console.error(`❌ Failed scanning ${url}: ${err.message}`);
        validatedUrls.push({
          browserId,
          url,
          status: "failed",
          totalMedia: 0,
          brokenMedia: 0,
          error: err.message || "Unknown error",
        });
      }
    }

    return { allMedia, brokenMedia, validatedUrls };
  }
}
