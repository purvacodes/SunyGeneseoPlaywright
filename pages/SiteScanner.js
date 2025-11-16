import { credentials } from "../data/credentials.js";
import { contentPostTypesUrls } from "../data/contentPostTypesUrls.js";

export class SiteScanner {
  constructor(utility, opts = {}) {
    this.utility = utility;
    this.env = this.env = credentials.env.live.endsWith('/') ? credentials.env.live : credentials.env.live + '/';
    this.postTypeBasePath = contentPostTypesUrls?.wordPress?.postTypeBasePath || "";

    // caches shared across instances
    //if (!SiteScanner.mediaCache) SiteScanner.mediaCache = new Map();
    // if (!SiteScanner.linkCache) SiteScanner.linkCache = new Set();

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

    const doHead = async () => {
      const options = { method: "HEAD", headers: this.requestHeaders || undefined };
      let res = await fetch(mediaUrl, options);
      // fallback if HEAD not allowed
      if (res.status === 405 || res.status === 501) res = await fetch(mediaUrl, { method: "GET", headers: this.requestHeaders || undefined });
      return { url: mediaUrl, status: res.status, ok: res.ok };
    };

    try {
      const result = await this.retry(doHead, this.retryCount, this.retryDelayMs);
    
      return result;
    } catch (err) {
      const result = { url: mediaUrl, status: "FETCH_ERROR", ok: false, error: err.message };
      return result;
    }
  }

  // ---------- Scan one page for media ----------
// ---------- Scan one page for media (optimized) ----------
async findBrokenMediaOnPage(page, url, browserId) {
  try {
    await page.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });

    // Handle "Continue" button if present
    const continueButton = page.getByRole("button", { name: "Continue" });
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
      await page.waitForLoadState("domcontentloaded");
    }

    // Allow network activity a bit; fail-safe so it doesn't block forever
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => { });

    // ✅ Scroll for lazy-loaded media (optimized)
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      let lastHeight = 0;
      let sameHeightCount = 0;
      const maxIdle = 3;      // fewer idle loops
      const scrollStep = 1000; // scroll bigger step
      while (sameHeightCount < maxIdle) {
        window.scrollBy(0, scrollStep);
        await delay(250);      // shorter delay
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
          sameHeightCount++;
        } else {
          sameHeightCount = 0;
          lastHeight = newHeight;
        }
      }
      await delay(1000);       // final wait for media to load
    });

    const finalUrl = page.url();

    // Extract media sources
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

    // ---------- Batched media checks ----------
    const batchSize = 5; // check 5 media at a time
    for (let i = 0; i < uniqueMedia.length; i += batchSize) {
      const batch = uniqueMedia.slice(i, i + batchSize);

      const results = await Promise.all(batch.map(async (media) => {
        const fullMediaUrl = this.resolveUrl(finalUrl, media.src);
        if (!fullMediaUrl) return null;
        const status = await this.checkMediaStatus(fullMediaUrl);
        return { media, status, fullMediaUrl };
      }));

      results.forEach((res) => {
        if (!res) return;
        const { media, status, fullMediaUrl } = res;
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
      });

      await this.throttledDelay(); // keep small delay between batches
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
  // 🧩 Add cache-busting query parameter
  const freshUrl = url.includes("?") ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;

  const doFetch = async () => {
    const headers = {
      ...(this.requestHeaders || {}),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'User-Agent': `FreshValidator/${Date.now()}`,
    };

    let res = await fetch(freshUrl, { method: "HEAD", headers });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(freshUrl, { method: "GET", headers });
    }

    return { url: freshUrl, status: res.status, ok: res.ok };
  };

  try {
    return await this.retry(doFetch, this.retryCount, this.retryDelayMs);
  } catch (err) {
    return { url: freshUrl, status: "FETCH_ERROR", ok: false, error: err.message };
  }
}


  // ---------- Check page and its links (original) ----------
async checkPageAndLinks(page, pageUrl, browserId) {
  const records = [];

  // Resolve full URL
  const fullPageUrl = this.resolveUrl(this.env, pageUrl);

  try {
    // 1️⃣ Check parent URL with HEAD/GET first
    let initialStatus = { ok: false, status: null, error: null };
    try {
      initialStatus = await this.checkLink(fullPageUrl);
    } catch (err) {
      console.warn(`[${browserId}] HEAD/GET check failed for ${fullPageUrl}: ${err.message}`);
    }

    // 2️⃣ Try to navigate
    let finalUrl = null;
    try {
      await page.goto(fullPageUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });
      finalUrl = page.url();
    } catch (navErr) {
      console.error(`❌ [${browserId}] Failed to navigate to ${fullPageUrl}: ${navErr.message}`);
      records.push({
        browserId,
        originalUrl: fullPageUrl,
        finalUrl: null,
        isRedirected: null,
        childUrl: fullPageUrl,
        isParent: true,
        status: "failed",
        httpStatus: initialStatus.status,
        error: navErr.message,
      });
      return records; // Stop processing this page
    }

    // 3️⃣ Handle "Continue" buttons or interstitials
    try {
      const continueButton = page.getByRole("button", { name: "Continue" });
      if (await continueButton.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {}),
          continueButton.click(),
        ]);
        finalUrl = page.url();
      }
    } catch {
      // optional: silently ignore if no interstitial
    }

    // 4️⃣ Check final URL status
    let finalStatus = { ok: false, status: null, error: null };
    try {
      finalStatus = await this.checkLink(finalUrl);
    } catch (err) {
      console.warn(`[${browserId}] HEAD/GET check failed for final URL ${finalUrl}: ${err.message}`);
    }

    // 5️⃣ Record parent
    const parentOk = finalStatus.ok;
    records.push({
      browserId,
      originalUrl: fullPageUrl,
      finalUrl,
      isRedirected: finalUrl !== fullPageUrl,
      childUrl: finalUrl,
      isParent: true,
      status: parentOk ? "ok" : "failed",
      httpStatus: finalStatus.status,
      error: parentOk ? null : finalStatus.error || "Failed to load final URL",
    });

    if (!parentOk) return records; // Stop if parent failed

    // 6️⃣ Collect child links safely
    let uniqueLinks = [];
    try {
      uniqueLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a[href]"))
          .filter(el =>
              el.href &&
              !el.href.startsWith("mailto:") &&
              !el.href.startsWith("#") &&
              !el.href.startsWith("tel:") &&
              !el.classList?.contains?.("menu-link")
          )
          .map(el => new URL(el.href, window.location.origin).href.trim());
      });
      uniqueLinks = [...new Set(uniqueLinks)]; // remove duplicates
    } catch (evalErr) {
      console.warn(`[${browserId}] Failed to extract child links from ${finalUrl}: ${evalErr.message}`);
    }

    // 7️⃣ Check each child link
    for (const link of uniqueLinks) {
      // if (SiteScanner.linkCache.has(link)) continue;
      // SiteScanner.linkCache.add(link);

      let status = { ok: false, status: null, error: null };
      try {
        status = await this.checkLink(link);
      } catch (linkErr) {
        console.warn(`[${browserId}] Failed HEAD/GET for ${link}: ${linkErr.message}`);
      }

      records.push({
        browserId,
        originalUrl: fullPageUrl,
        finalUrl,
        isRedirected: finalUrl !== fullPageUrl,
        childUrl: link,
        isParent: false,
        status: status.ok ? "ok" : "failed",
        httpStatus: status.status,
        error: status.ok ? null : status.error || "Failed to load child link",
      });

      await this.throttledDelay();
    }
  } catch (err) {
    // Catch-all for unexpected errors
    console.error(`⚠️ [${browserId}] Unexpected error for ${fullPageUrl}: ${err.message}`);
    records.push({
      browserId,
      originalUrl: fullPageUrl,
      finalUrl: null,
      isRedirected: null,
      childUrl: fullPageUrl,
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
  // async runLinkCheckerWorker(browser, batchSize, browserId, urlQueue, results, globalProgress = null) {
  //   const context = await browser.newContext();
  //   const page = await context.newPage();


  //   while (urlQueue.length > 0) {
  //     const batch = urlQueue.splice(0, batchSize);
  //     // console.log(`🔍 [${browserId}] picked up ${batch.length} URLs:`, batch);

  //     for (const url of batch) {
  //       try {

  //         const fullUrl = this.resolveUrl(this.env, url);
  //         const records = await this.checkParentPage(page, fullUrl, browserId);
  //         // const records = await this.checkPageAndLinks(page, fullUrl, browserId);
  //         console.log(`[${browserId}] Completed: ${fullUrl} → ${records[0]?.httpStatus ?? "N/A"}`);

  //         // push results
  //         results.allValidated.push(...records);
  //         const brokenSubset = records.filter((r) => r.status === "failed");
  //         results.broken.push(...brokenSubset);

  //       } catch (err) {
  //         console.warn(`⚠️ [${browserId}] Error processing ${fullUrl}: ${err.message}`);
  //         results.allValidated.push({
  //           browserId,
  //           originalUrl: pageUrl,
  //           finalUrl: fullUrl,
  //           isRedirected: null,
  //           childUrl: fullUrl,
  //           isParent: true,
  //           status: "failed",
  //           httpStatus: null,
  //           error: err.message,
  //         });
  //       }

  //       // update global progress if provided
  //       if (globalProgress) {
  //         globalProgress.completed = (globalProgress.completed || 0) + 1;
  //         // also print short progress every 5 URLs
  //         if (globalProgress.completed % 5 === 0) {
  //           console.log(`📊 [${browserId}] Progress short: ${globalProgress.completed}/${globalProgress.total}`);
  //         }
  //       }

  //       // throttling between URLs (gentle random pause)
  //       await this.throttledDelay();
  //     }
  //   }


  //   await context.close();
  // }

async runLinkCheckerWorker(browser, batchSize, workerId, urlQueue, results, globalProgress = null) {
const context = await browser.newContext({
    bypassCSP: true,
    ignoreHTTPSErrors: true,
  });

  // 🧠 Disable caching for every request
  await context.route('**/*', route => {
    const headers = {
      ...route.request().headers(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
    route.continue({ headers });
  });

  const page = await context.newPage();

  while (urlQueue.length > 0) {
    const batch = urlQueue.splice(0, batchSize);

    for (const urlObj of batch) {
      let cpt = "";
      let fullUrl = "";

      try {
        if (typeof urlObj === "object") {
          cpt = urlObj.cpt || "";
          const originalUrl = urlObj.originalUrl || "";
          fullUrl = this.resolveUrl(this.env, originalUrl);
        } else {
          fullUrl = this.resolveUrl(this.env, urlObj);
        }

        // 🔎 Perform the check
        const records = await this.checkParentPage(page, fullUrl, workerId);

        // Attach CPT to all returned records
        records.forEach((r) => (r.cpt = cpt));

        // Save results
        results.allValidated.push(...records);
        const brokenSubset = records.filter((r) => r.status === "failed");
        results.broken.push(...brokenSubset);

        // 🟢 Log progress with status + httpStatus
        const primary = records[0] || {};
        const statusText = primary.status || "unknown";
        const httpText = primary.httpStatus || "N/A";
        console.log(
          `[${workerId}] Completed: ${cpt || "N/A"} → ${fullUrl} → ${statusText} (${httpText})`
        );

      } catch (err) {
        console.warn(`⚠️ [${workerId}] Error processing ${fullUrl || "Unknown"}: ${err.message}`);

        const errorRecord = {
          browserId: workerId,
          cpt: cpt || "",
          originalUrl: fullUrl || "",
          finalUrl: fullUrl || "",
          isRedirected: null,
          childUrl: fullUrl || "",
          isParent: true,
          status: "failed",
          httpStatus: null,
          error: err.message,
        };

        results.allValidated.push(errorRecord);
        results.broken.push(errorRecord);
      }

      // Update progress
      if (globalProgress) {
        globalProgress.completed = (globalProgress.completed || 0) + 1;
        if (globalProgress.completed % 5 === 0) {
          console.log(
            `📊 [${workerId}] Progress short: ${globalProgress.completed}/${globalProgress.total}`
          );
        }
      }

      await this.throttledDelay();
    }
  }

  await context.close();
}



}