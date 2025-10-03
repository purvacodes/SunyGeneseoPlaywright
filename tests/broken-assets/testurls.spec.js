import { test } from "@playwright/test";
import { chromium } from "playwright";
import fs from "fs";
import { credentials } from "../../data/credentials.js";
import { createObjects } from "../../pages/ObjectFactory.js";

const BASE_URL = "https://palegoldenrod-ant-677872.hostingersite.com/";

test.setTimeout(2 * 60 * 60 * 1000); // 2 hours

test("🔥 All-in-one link checker with login & parallelization (single browser, multiple tabs)", async () => {
  const objectFactory = createObjects();
  const results = {
    allValidated: [],
    broken: []
  };

  // --- Step 1: Login once and save session ---
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(credentials.hostinger.url, { timeout: 100000, waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Username' }).fill(credentials.hostinger.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(credentials.hostinger.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('#wpadminbar', { state: 'visible', timeout: 30000 });

  console.log("✅ Logged in and saved session.");

  // --- Step 2: Load URLs to scan and prepend BASE_URL ---
  const rawUrls = await objectFactory.utility.loadExcel("basic_page.xlsx");
  const extractedUrlsFromExcel = rawUrls.map(url => {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    const cleanedPath = url.replace(/^\/+/, "");
    return BASE_URL + cleanedPath;
  });

  // --- Step 3: Divide URLs into chunks for parallel tab processing ---
  const tabsCount = 5; // Change this to control parallel tabs
  const chunkArray = (arr, parts) => {
    const result = Array.from({ length: parts }, () => []);
    arr.forEach((item, index) => {
      result[index % parts].push(item);
    });
    return result;
  };
  const urlChunks = chunkArray(extractedUrlsFromExcel, tabsCount);

  // --- Step 4: Create multiple tabs (pages) and process chunks in parallel ---
  const pages = await Promise.all(
    Array.from({ length: tabsCount }, () => context.newPage())
  );

  await Promise.all(
    pages.map(async (tab, tabIndex) => {
      const urls = urlChunks[tabIndex];
      const workerId = `TAB-${tabIndex + 1}`;

      for (const url of urls) {
        try {
          const result = await checkPageAndLinks(tab, url, workerId, context);
          results.allValidated.push(...result);
          results.broken.push(...result.filter(r => r.status === "failed"));
        } catch (err) {
          results.allValidated.push({
            browserId: workerId,
            originalUrl: url,
            finalUrl: null,
            childUrl: url,
            isParent: true,
            status: "failed",
            httpStatus: null,
            error: err.message
          });
        }
      }

      await tab.close(); // Close each tab after processing
    })
  );

  // --- Step 5: Save results ---
  objectFactory.utility.saveToExcel("validated-urls.xlsx", "ValidatedUrls", results.allValidated, "url-reports");
  objectFactory.utility.saveToExcel("broken-links.xlsx", "BrokenLinks", results.broken, "url-reports");

  console.log("✅ Scanning complete. Results saved.");

  await context.close();
  await browser.close();
});


// --- Function: Check page and its links ---
async function checkPageAndLinks(page, pageUrl, browserId, context) {
  const records = [];

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 150000 });

    const finalUrl = page.url();
    const finalStatus = await checkHttpStatus(finalUrl, context);

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

    if (!finalStatus.ok) return records;

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map(el => el.getAttribute("href"))
        .filter(href =>
          href &&
          !href.startsWith("mailto:") &&
          !href.startsWith("#") &&
          !href.startsWith("tel:")
        );
    });

    const uniqueLinks = [...new Set(links)];

    for (const link of uniqueLinks) {
      const absolute = new URL(link, finalUrl).href;
      const status = await checkHttpStatus(absolute, context);

      records.push({
        browserId,
        originalUrl: pageUrl,
        finalUrl,
        isRedirected: finalUrl !== pageUrl,
        childUrl: absolute,
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
      error: err.message
    });
  }

  return records;
}


// --- Function: HTTP check with cookies from Playwright session ---
async function checkHttpStatus(url, context) {
  try {
    const cookies = await context.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

    let res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PlaywrightBot",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": cookieHeader
      }
    });

    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: "FETCH_ERROR", ok: false, error: err.message };
  }
}
