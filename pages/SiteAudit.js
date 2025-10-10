import { chromium } from "playwright";

/**
 * SiteAudit class validates parent page URLs with retries, throttling, and progress logging.
 */
export class SiteAudit {
  /**
   * @param {Object} config - Configuration object
   * @param {number} workerId - Internal worker ID for logging
   * @param {string[]} urls - List of URLs assigned to this worker
   */
  constructor(config, workerId, urls) {
    this.config = config;
    this.workerId = workerId;
    this.urls = urls;
    this.results = [];
    this.broken = [];
    this.cache = new Map();
    this.startTime = Date.now();
    this.lastProgressLog = Date.now();
  }

  /** Main runner for this worker: launches browser, processes URLs sequentially.*/
  async run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (let i = 0; i < this.urls.length; i++) {
      const url = this.urls[i];
      await this.checkSlugStatus(page, url);
      // await this.throttle();
      if (Date.now() - this.lastProgressLog >= this.config.PROGRESS_INTERVAL_MS) {
        this.logProgress(i + 1);
        this.lastProgressLog = Date.now();
      }
    }

    await browser.close();
  }

  //Visits a single URL, validates HTTP status with retries
   async checkSlugStatus(page, url) {
    // Prepend ENV_BASE_URL if URL is relative
    const fullUrl = url.startsWith("http")
      ? url
      : `${this.config.ENV_BASE_URL.replace(/\/$/, "")}/${url.replace(/^\/+/, "")}`;

    let attempt = 0;
    let success = false;
    let finalStatus = null;

    while (attempt <= this.config.RETRY_ATTEMPTS && !success) {
      attempt++;
      try {
        // Skip if cached
        if (this.cache.has(fullUrl)) {
          finalStatus = this.cache.get(fullUrl);
          success = finalStatus < 400;
          break;
        }

        // Go to initial page
        let response = await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: this.config.REQUEST_TIMEOUT_MS });

        // Handle interstitial / Continue button
        const continueBtn = page.getByRole("button", { name: "Continue" });
        if (await continueBtn.isVisible().catch(() => false)) {
          // Wait for navigation after clicking Continue
          response = await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
            continueBtn.click(),
          ]).then(([resp]) => resp);
        }

        // Wait a moment to let page settle
        await page.waitForTimeout(1000);

        // Final status
        finalStatus = response?.status() || 0;
        success = response && response.ok();

        // Cache it
        this.cache.set(fullUrl, finalStatus);
      } catch (err) {
        finalStatus = "ERROR";
        success = false;
      }
    }

    const record = {
      workerId: this.workerId,
      url: fullUrl,
      status: success && finalStatus < 400 ? "ok" : "failed",
      httpStatus: finalStatus,
      error: success ? null : `Failed after ${attempt} attempt(s)`,
    };

    // Store results
    this.results.push(record);
    if (record.status === "failed") this.broken.push(record);

    // Log
    this.log(record);
  }


  /**
   * Throttle requests between URLs.
   */
  async throttle() {
    return new Promise(resolve => setTimeout(resolve, this.config.THROTTLE_DELAY_MS));
  }

  /**
   * Logs a single URL validation result.
   */
  log(record) {
    const msg = `[Worker ${this.workerId}] ${record.status === "ok" ? "✅" : "❌"} ${record.httpStatus} → ${record.url}`;
    console.log(msg);
  }

  /**
   * Logs periodic progress.
   */
  logProgress(processedCount) {
    console.log(
      `[Progress] ${processedCount} / ${this.urls.length} URLs validated | Worker: ${this.workerId} | Elapsed: ${Math.floor((Date.now() - this.startTime) / 60000)}m`
    );
  }
}
