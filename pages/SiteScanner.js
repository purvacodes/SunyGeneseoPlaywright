import { credentials } from "../data/credentials.js";
import { contentPostTypesUrls } from "../data/contentPostTypesUrls.js";
import { error } from "console";

export class SiteScanner {
  constructor(utility) {
    this.env = credentials.env.drupal;
    this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
    this.utility = utility;

    if (!SiteScanner.mediaCache) {
      SiteScanner.mediaCache = new Map();
    }
    if (!SiteScanner.linkCache) {
      SiteScanner.linkCache = new Set();
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
        console.log(`Collected ${urls.length} URLs from: ${sitemapUrl}`);
      } catch (error) {
        console.error(`❌ Error while processing ${sitemapUrl}:`, error);
      }
    }

    await page.close();
    await this.utility.saveUrlsToExcel(allUrls, baseName);
  }

  // --- Worker loop for media scanning ---
 async runWorker(browser, batchSize, browserId, urlQueue, results) {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (urlQueue.length > 0) {
      const batch = urlQueue.splice(0, batchSize);

      for (const url of batch) {
        try {
          const { allMedia, brokenMedia, finalUrl } =
            await this.findBrokenMediaOnPage(page, url, browserId);

          results.allGlobalMedia.push(...allMedia);
          results.allBrokenMedia.push(...brokenMedia);

          results.validatedPages.push({
            browserId,
            originalUrl: url,
            finalUrl,
            status: "ok",
            mediaCount: allMedia.length,
            brokenCount: brokenMedia.length,
            error: null, // ✅ no error if success
          });
        } catch (err) {
          results.validatedPages.push({
            browserId,
            originalUrl: url,
            finalUrl: null,
            status: "failed",
            mediaCount: 0,
            brokenCount: 0,
            error: err.message || "Unknown error",
          });

          results.allBrokenMedia.push({
            browserId,
            parentPage: url,
            fullMediaUrl: url,
            type: "page",
            src: url,
            status: "failed",
          });

          console.warn(`⚠️ Error scanning ${url}: ${err.message}`);
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

  // --- Cached HEAD request for media ---
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

  // --- Scan one page for media ---
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

      const finalUrl = page.url();

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

      // ✅ Deduplicate media by src
      const uniqueMedia = [
        ...new Map(mediaSources.map(item => [item.src, item])).values(),
      ];

      const allMedia = [];
      const brokenMedia = [];

      for (const media of uniqueMedia) {
        const fullMediaUrl = this.resolveUrl(finalUrl, media.src);
        if (!fullMediaUrl) continue;

        const status = await this.checkMediaStatus(fullMediaUrl);

        const mediaItem = {
          browserId,
          parentPage: finalUrl,
          fullMediaUrl,
          type: media.type,
          src: media.src,
          status: status.status,
        };
        allMedia.push(mediaItem);
        if (!status.ok) brokenMedia.push(mediaItem);
      }

      return { allMedia, brokenMedia, finalUrl };
    } catch (err) {
      console.warn(`⚠️ Error scanning ${url}: ${err.message}`);
      return { allMedia: [], brokenMedia: [], finalUrl: null };
    }
  }

  // --- Sequential media checker ---
  async checkBrokenMedia(page, urls, browserId = 1) {
    const allMedia = [];
    const brokenMedia = [];
    const validatedUrls = [];

    for (const url of urls) {
      try {
        const { allMedia: pageMedia, brokenMedia: pageBroken, finalUrl } =
          await this.findBrokenMediaOnPage(page, url, browserId);

        allMedia.push(...pageMedia);
        brokenMedia.push(...pageBroken);

        validatedUrls.push({
          browserId,
          originalUrl: url,
          finalUrl,
          status: "success",
          totalMedia: pageMedia.length,
          brokenMedia: pageBroken.length,
          error: null,
        });
      } catch (err) {
        console.error(`❌ Failed scanning ${url}: ${err.message}`);
        validatedUrls.push({
          browserId,
          originalUrl: url,
          finalUrl: null,
          status: "failed",
          totalMedia: 0,
          brokenMedia: 0,
          error: err.message || "Unknown error",
        });
      }
    }

    return { allMedia, brokenMedia, validatedUrls };
  }

  // --- Cached HEAD/GET request for links ---
  async checkLink(url) {
    if (SiteScanner.mediaCache.has(url)) {
      return SiteScanner.mediaCache.get(url);
    }

    try {
      let res = await fetch(url, { method: "HEAD" });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: "GET" });
      }
      const result = { url, status: res.status, ok: res.ok };
      SiteScanner.mediaCache.set(url, result);
      return result;
    } catch (err) {
      const result = { url, status: "FETCH_ERROR", ok: false, error: err.message };
      SiteScanner.mediaCache.set(url, result);
      return result;
    }
  }

  // --- Check page and its links ---
async checkPageAndLinks(page, pageUrl, browserId) {
  const records = [];

  try {
    // First, check parent page with HEAD/GET
    const initialStatus = await this.checkLink(pageUrl);

    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const finalUrl = page.url();

    const continueButton = page.getByRole("button", { name: "Continue" });
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
      await page.waitForLoadState("domcontentloaded");
    }
    await page.waitForLoadState("networkidle", { timeout: 60000 });

    const finalStatus = await this.checkLink(finalUrl);

    // Always record parent first
    records.push({
      browserId,
      originalUrl: pageUrl,
      finalUrl,
      isRedirected: finalUrl !== pageUrl,
      childUrl: finalUrl,
      isParent: true,
      status: finalStatus.ok ? "ok" : "failed",
      httpStatus: finalStatus.status,
      error: finalStatus.error || null,
    });

    // ✅ If parent itself failed, stop here — don't check child links
    if (!finalStatus.ok) {
      return records;
    }

    // Otherwise, collect child links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .filter(el => {
          const href = el.getAttribute("href") || "";
          return (
            !el.classList.contains("menu-link") &&
            !href.startsWith("mailto:") &&
            !href.startsWith("#") &&
            !href.startsWith("tel:")
          );
        })
        .map(el => el.href.trim())
        .filter(href => !!href);
    });

    const uniqueLinks = [...new Set(links)];

    for (const link of uniqueLinks) {
      if (SiteScanner.linkCache.has(link)) continue;
      SiteScanner.linkCache.add(link);

      const status = await this.checkLink(link);

      records.push({
        browserId,
        originalUrl: pageUrl,
        finalUrl,
        isRedirected: finalUrl !== pageUrl,
        childUrl: link,
        isParent: false,
        status: status.ok ? "ok" : "failed",
        httpStatus: status.status,
        error: status.error || null,
      });
    }
  } catch (err) {
    // If navigation itself throws, mark parent failed and stop
    records.push({
      browserId,
      originalUrl: pageUrl,
      finalUrl: null,
      isRedirected: null,
      childUrl: pageUrl,
      isParent: true,
      status: "failed",
      httpStatus: null,
      error: err.message,
    });
  }

  return records;
}

  // --- Worker loop for link checking ---
  async runLinkCheckerWorker(browser, batchSize, browserId, urlQueue, results) {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (urlQueue.length > 0) {
      const batch = urlQueue.splice(0, batchSize);

      for (const url of batch) {
        try {
          const records = await this.checkPageAndLinks(page, url, browserId);
          results.allValidated.push(...records);

          const brokenSubset = records.filter(r => r.status === "failed");
          results.broken.push(...brokenSubset);
        } catch (err) {
          results.allValidated.push({
            browserId,
            originalUrl: url,
            finalUrl: null,
            isRedirected: null,
            childUrl: url,
            isParent: true,
            status: "failed",
            httpStatus: null,
            error: err.message,
          });
        }
      }
    }

    await context.close();
  }
}
