import { credentials } from "../data/credentials.js";
import { contentPostTypesUrls } from "../data/contentPostTypesUrls.js";

export class SiteScanner {
  constructor(utility, opts = {}) {
    this.utility = utility;
    this.env = this.env = credentials.env.local.endsWith('/') ? credentials.env.local : credentials.env.local + '/';
    this.postTypeBasePath = contentPostTypesUrls?.wordPress?.postTypeBasePath || "";

    // caches shared across instances
    if (!SiteScanner.mediaCache) SiteScanner.mediaCache = new Map();
    if (!SiteScanner.linkCache) SiteScanner.linkCache = new Set();

    // options / defaults
    this.retryCount = opts.retryCount ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 1500;
    this.throttleMinMs = opts.throttleMinMs ?? 800; // minimum delay between URL operations
    this.throttleMaxMs = opts.throttleMaxMs ?? 1400; // maximum delay
    this.progressIntervalMs = opts.progressIntervalMs ?? 5 * 60 * 1000; // 5 minutes default
    this.progressTimer = null;

    // optional headers (if you want to include auth headers from saved session)
    this.requestHeaders = opts.requestHeaders ?? null;
  }

  // ---------- Utilities ----------
resolveUrl(base, relative) {
  if (!relative) return null;

  // already absolute
  if (/^https?:\/\//i.test(relative)) return relative;

  // ensure base ends with "/"
  const cleanBase = base.endsWith("/") ? base : base + "/";

  // if slug starts with "/", append safely
  if (relative.startsWith("/")) {
    const baseUrl = new URL(cleanBase);
    // ensure we don’t lose subpath like "/sunny/"
    const final = `${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, "")}${relative}`;
    return final;
  }

  // fallback to standard URL resolution
  try {
    return new URL(relative, cleanBase).href;
  } catch {
    return cleanBase + relative;
  }
}


  // small randomized throttle delay
  async throttledDelay() {
    const ms = this.throttleMinMs + Math.floor(Math.random() * (this.throttleMaxMs - this.throttleMinMs + 1));
    return new Promise((r) => setTimeout(r, ms));
  }

  // generic retry wrapper
  async retry(fn, retries = this.retryCount, delayMs = this.retryDelayMs) {
    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        console.warn(`⏳ Retry ${attempt}/${retries} failed: ${err.message}`);
        if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  // Start a periodic progress reporter. globalProgress should be an object: { total, completed }
  startProgressReporter(globalProgress, intervalMs = this.progressIntervalMs) {
    this.stopProgressReporter();
    if (!globalProgress || typeof globalProgress.completed !== "number" || typeof globalProgress.total !== "number") {
      console.warn("startProgressReporter: invalid globalProgress object");
      return;
    }
    this.progressTimer = setInterval(() => {
      console.log(`⏱️ [${new Date().toLocaleTimeString()}] Progress: ${globalProgress.completed}/${globalProgress.total} URLs validated`);
    }, intervalMs);
  }

  stopProgressReporter() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  // ---------- Sitemap URL collection (original) ----------
  async collectUrlsToScan(browser, baseUrl, baseName, count) {
    const sitemapUrls = await this.utility.getUrlsfromSitemap(baseUrl, baseName, count);
    let allUrls = [];
    const page = await browser.newPage();

    for (const sitemapUrl of sitemapUrls) {
      try {
        await page.goto(sitemapUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

        const continueBtn = page.getByRole("button", { name: "Continue" });
        if (await continueBtn.isVisible().catch(() => false)) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }),
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

  // ---------- Worker loop for media validation (parallelized like runLinkCheckerWorker) ----------
  async runMediaCheckerWorker(browser, batchSize, browserId, urlQueue, results, globalProgress = null) {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (urlQueue.length > 0) {
      const batch = urlQueue.splice(0, batchSize);

      for (const rawUrl of batch) {
        const url = this.resolveUrl(this.env, rawUrl);
        if (!url) {
          console.warn(`🚫 [${browserId}] Skipping invalid media URL: ${rawUrl}`);
          continue;
        }
        try {
          const { allMedia, brokenMedia, finalUrl } = await this.findBrokenMediaOnPage(page, url, browserId);

          results.allGlobalMedia.push(...allMedia);
          results.allBrokenMedia.push(...brokenMedia);

          results.validatedPages.push({
            browserId,
            originalUrl: url,
            finalUrl,
            status: "ok",
            mediaCount: allMedia.length,
            brokenCount: brokenMedia.length,
            error: null,
          });

          console.log(`✅ [${browserId}] Media OK - ${url} (media: ${allMedia.length}, broken: ${brokenMedia.length})`);
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

          console.warn(`⚠️ [${browserId}] Error scanning ${url}: ${err.message}`);
        }

        // update progress
        if (globalProgress) {
          globalProgress.completed = (globalProgress.completed || 0) + 1;
          if (globalProgress.completed % 5 === 0) {
            console.log(`📊 [${browserId}] Progress short: ${globalProgress.completed}/${globalProgress.total}`);
          }
        }

        // throttle between page scans
        await this.throttledDelay();
      }
    }

    await context.close();
  }

  // ---------- Media helper: cached HEAD with fallback and retry ----------
  async checkMediaStatus(mediaUrl) {
    if (SiteScanner.mediaCache.has(mediaUrl)) {
      return SiteScanner.mediaCache.get(mediaUrl);
    }

    const doHead = async () => {
      const options = { method: "HEAD", headers: this.requestHeaders || undefined };
      let res = await fetch(mediaUrl, options);
      // fallback if HEAD not allowed
      if (res.status === 405 || res.status === 501) res = await fetch(mediaUrl, { method: "GET", headers: this.requestHeaders || undefined });
      return { url: mediaUrl, status: res.status, ok: res.ok };
    };

    try {
      const result = await this.retry(doHead, this.retryCount, this.retryDelayMs);
      SiteScanner.mediaCache.set(mediaUrl, result);
      return result;
    } catch (err) {
      const result = { url: mediaUrl, status: "FETCH_ERROR", ok: false, error: err.message };
      SiteScanner.mediaCache.set(mediaUrl, result);
      return result;
    }
  }

  // ---------- Scan one page for media ----------
  async findBrokenMediaOnPage(page, url, browserId) {
    try {
      await page.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });

      const continueButton = page.getByRole("button", { name: "Continue" });
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
        await page.waitForLoadState("domcontentloaded");
      }

      // allow network activity a bit; fail safe (catch) so it doesn't block forever
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => { });

      // ✅ Scroll for lazy-loaded media
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

      // extract media sources
      const mediaSources = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll("img[src]").forEach((el) =>
          results.push({ type: "image", src: el.getAttribute("src") })
        );
        document.querySelectorAll("video[src], video source[src]").forEach((el) =>
          results.push({ type: "video", src: el.getAttribute("src") })
        );

        const fileRegex = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp)(\?.*)?$/i;
        document.querySelectorAll("a[href], embed[src], iframe[src], object[data]").forEach((el) => {
          let src = el.href || el.src || el.getAttribute("data");
          if (src && fileRegex.test(src)) {
            const match = src.match(fileRegex);
            const ext = match ? match[1].toLowerCase() : "file";
            results.push({ type: ext, src });
          }
        });

        return results;
      });

      const uniqueMedia = [...new Map(mediaSources.map((item) => [item.src, item])).values()];

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
          ok: status.ok,
          error: status.error || null,
        };
        allMedia.push(mediaItem);
        if (!status.ok) brokenMedia.push(mediaItem);

        // throttle between media checks
        await this.throttledDelay();
      }

      return { allMedia, brokenMedia, finalUrl };
    } catch (err) {
      console.warn(`⚠️ [${browserId}] Error scanning ${url}: ${err.message}`);
      return { allMedia: [], brokenMedia: [], finalUrl: null };
    }
  }

  // ---------- Sequential media checker (original) ----------
  async checkBrokenMedia(page, urls, browserId = 1) {
    const allMedia = [];
    const brokenMedia = [];
    const validatedUrls = [];

    for (const url of urls) {
      try {
        const { allMedia: pageMedia, brokenMedia: pageBroken, finalUrl } = await this.findBrokenMediaOnPage(page, url, browserId);

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
        console.error(`❌ [${browserId}] Failed scanning ${url}: ${err.message}`);
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

      // small throttle between pages
      await this.throttledDelay();
    }

    return { allMedia, brokenMedia, validatedUrls };
  }

  // ---------- Cached HEAD/GET request for links (original checkLink) ----------
  async checkLink(url) {
    if (SiteScanner.mediaCache.has(url)) {
      return SiteScanner.mediaCache.get(url);
    }

    const doFetch = async () => {
      const options = { method: "HEAD", headers: this.requestHeaders || undefined };
      let res = await fetch(url, options);
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: "GET", headers: this.requestHeaders || undefined });
      }
      return { url, status: res.status, ok: res.ok };
    };

    try {
      const result = await this.retry(doFetch, this.retryCount, this.retryDelayMs);
      SiteScanner.mediaCache.set(url, result);
      return result;
    } catch (err) {
      const result = { url, status: "FETCH_ERROR", ok: false, error: err.message };
      SiteScanner.mediaCache.set(url, result);
      return result;
    }
  }

  // ---------- Check page and its links (original) ----------
  async checkPageAndLinks(page, pageUrl, browserId) {
    const records = [];
    try {
      // check parent with HEAD/GET first
      const initialStatus = await this.checkLink(pageUrl);

      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 150_000 });
      const finalUrl = page.url();

      const continueButton = page.getByRole("button", { name: "Continue" });
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
        await page.waitForLoadState("domcontentloaded");
      }
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => { });

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

      // stop here if parent failed
      if (!finalStatus.ok) {
        return records;
      }

      // collect child links
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .filter((el) => {
            const href = el.getAttribute("href") || "";
            return !el.classList.contains("menu-link") && !href.startsWith("mailto:") && !href.startsWith("#") && !href.startsWith("tel:");
          })
          .map((el) => el.href.trim())
          .filter(Boolean)
      );

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

        // throttle between link checks to be gentle
        await this.throttledDelay();
      }
    } catch (err) {
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

  // ---------- Check parent page (original) ----------
  async checkParentPage(page, pageUrl, browserId) {
    const records = [];
    const targetUrl = this.resolveUrl(this.env, pageUrl);
    try {

      const status = await this.checkLink(targetUrl);

      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 150_000 });
      const finalUrl = page.url();

      records.push({
        browserId,
        originalUrl: targetUrl,
        finalUrl,
        isRedirected: finalUrl !== targetUrl,
        childUrl: finalUrl,
        isParent: true,
        status: status.ok ? "ok" : "failed",
        httpStatus: status.status,
        error: status.error || null,
      });

      return records;
    } catch (err) {
      records.push({
        browserId,
        originalUrl: targetUrl,
        finalUrl: null,
        isRedirected: null,
        childUrl: pageUrl,
        isParent: true,
        status: "failed",
        httpStatus: null,
        error: err.message || null,
      });
      return records;
    }
  }

  // ---------- Worker loop for link checking (enhanced) ----------
  async runLinkCheckerWorker(browser, batchSize, browserId, urlQueue, results, globalProgress = null) {
    const context = await browser.newContext();
    const page = await context.newPage();


    while (urlQueue.length > 0) {
      const batch = urlQueue.splice(0, batchSize);
      // console.log(`🔍 [${browserId}] picked up ${batch.length} URLs:`, batch);

      for (const url of batch) {
        try {

          const fullUrl = this.resolveUrl(this.env, url);
          const records = await this.checkParentPage(page, fullUrl, browserId);
         // const records = await this.checkPageAndLinks(page, fullUrl, browserId);
          console.log(`[${browserId}] Completed: ${fullUrl} → ${records[0]?.httpStatus ?? "N/A"}`);

          // push results
          results.allValidated.push(...records);
          const brokenSubset = records.filter((r) => r.status === "failed");
          results.broken.push(...brokenSubset);

        } catch (err) {
          console.warn(`⚠️ [${browserId}] Error processing ${fullUrl}: ${err.message}`);
          results.allValidated.push({
            browserId,
            originalUrl: pageUrl,
            finalUrl: fullUrl,
            isRedirected: null,
            childUrl: fullUrl,
            isParent: true,
            status: "failed",
            httpStatus: null,
            error: err.message,
          });
        }

        // update global progress if provided
        if (globalProgress) {
          globalProgress.completed = (globalProgress.completed || 0) + 1;
          // also print short progress every 5 URLs
          if (globalProgress.completed % 5 === 0) {
            console.log(`📊 [${browserId}] Progress short: ${globalProgress.completed}/${globalProgress.total}`);
          }
        }

        // throttling between URLs (gentle random pause)
        await this.throttledDelay();
      }
    }


    await context.close();
  }

}