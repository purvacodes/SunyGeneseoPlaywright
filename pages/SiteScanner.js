import { credentials } from "../data/credentials.js";
import { contentPostTypesUrls } from "../data/contentPostTypesUrls.js";

export class SiteScanner {
  constructor(utility) {
    this.env = credentials.env.wordPress;
    this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
    this.utility = utility;

    if (!SiteScanner.mediaCache) {
      SiteScanner.mediaCache = new Map();
    }
    if (!SiteScanner.linkCache) {
      SiteScanner.linkCache = new Set();
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

  // --- Cached HEAD/GET request ---
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

  // --- Check page + links ---
  async checkPageAndLinks(page, pageUrl, browserId) {
    const records = [];

    try {
      // 1️⃣ Check initial URL
      const initialStatus = await this.checkLink(pageUrl);

      // 2️⃣ Navigate and capture final URL
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      const finalUrl = page.url();

      // 3️⃣ Handle Continue button
      const continueButton = page.getByRole("button", { name: "Continue" });
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
        await page.waitForLoadState("domcontentloaded");
      }
      await page.waitForLoadState("networkidle", { timeout: 60000 });

      // 4️⃣ Re-check final URL
      const finalStatus = await this.checkLink(finalUrl);

      // Parent page record
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

      // 5️⃣ Collect child links
      const links = await page.evaluate(() => { 
        return Array.from(document.querySelectorAll("a[href]"))
        .filter(el => { 
          const href = el.getAttribute("href") || ""; 
          return (!el.classList.contains("menu-link") 
          && !href.startsWith("mailto:")
          && !href.startsWith("#") 
          && !href.startsWith("tel:")); })
          .map(el => el.href.trim()).filter(href => !!href); });

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

  // --- Worker ---
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
