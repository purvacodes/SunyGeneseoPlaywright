// tests/broken-assets/testUrls.spec.js
import { test } from '@playwright/test';
import { chromium } from 'playwright';
import fs from 'fs';
import { createObjects } from '../../pages/ObjectFactory.js';

const BASE_URL = 'https://palegoldenrod-ant-677872.hostingersite.com/';
const STORAGE_FILE = './test-artifacts/session.json'; // previously saved session

test('🔥 All-in-one link checker with saved session', async () => {
  test.setTimeout(2 * 60 * 60 * 1000); // 2 hours

  const objectFactory = createObjects();
  const results = { allValidated: [], broken: [] };

  // --- Launch browser and load saved session ---
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_FILE });

  console.log('✅ Session loaded, skipping login.');

  // --- Load URLs to scan ---
  const rawUrls = await objectFactory.utility.loadExcel('basic_page.xlsx');
  const extractedUrlsFromExcel = rawUrls.map(url => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return BASE_URL + url.replace(/^\/+/, '');
  });

  // --- Divide URLs into chunks for parallel tab processing ---
  const tabsCount = 5; // number of parallel tabs
  const chunkArray = (arr, parts) => {
    const result = Array.from({ length: parts }, () => []);
    arr.forEach((item, index) => result[index % parts].push(item));
    return result;
  };
  const urlChunks = chunkArray(extractedUrlsFromExcel, tabsCount);

  // --- Create multiple tabs (pages) ---
  const pages = await Promise.all(
    Array.from({ length: tabsCount }, () => context.newPage())
  );

  // --- Process chunks in parallel ---
  await Promise.all(
    pages.map(async (tab, tabIndex) => {
      const urls = urlChunks[tabIndex];
      const workerId = `TAB-${tabIndex + 1}`;

      for (const url of urls) {
        try {
          const result = await checkPageAndLinks(tab, url, workerId, context);
          results.allValidated.push(...result);
          results.broken.push(...result.filter(r => r.status === 'failed'));
        } catch (err) {
          results.allValidated.push({
            browserId: workerId,
            originalUrl: url,
            finalUrl: null,
            childUrl: url,
            isParent: true,
            status: 'failed',
            httpStatus: null,
            error: err.message,
          });
        }
      }

      await tab.close();
    })
  );

  // --- Save results ---
  objectFactory.utility.saveToExcel('validated-urls.xlsx', 'ValidatedUrls', results.allValidated, 'url-reports');
  objectFactory.utility.saveToExcel('broken-links.xlsx', 'BrokenLinks', results.broken, 'url-reports');

  console.log('✅ Scanning complete.');
  await context.close();
  await browser.close();
});


// --- Helper: check page and its links ---
async function checkPageAndLinks(page, pageUrl, browserId, context) {
  const records = [];

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 150_000 });
    const finalUrl = page.url();
    const finalStatus = await checkHttpStatus(finalUrl, context);
console.log(finalStatus);
    records.push({
      browserId,
      originalUrl: pageUrl,
      finalUrl,
      isRedirected: finalUrl !== pageUrl,
      childUrl: finalUrl,
      isParent: true,
      status: finalStatus.ok ? 'ok' : 'failed',
      httpStatus: finalStatus.status,
      error: finalStatus.error || null,
    });

    if (!finalStatus.ok) return records;

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(el => el.getAttribute('href'))
        .filter(href => href && !href.startsWith('mailto:') && !href.startsWith('#') && !href.startsWith('tel:'))
    );

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
        status: status.ok ? 'ok' : 'failed',
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
      status: 'failed',
      httpStatus: null,
      error: err.message,
    });
  }

  return records;
}

// --- Helper: check HTTP status using context request ---
async function checkHttpStatus(url, context) {
  try {
 const res = await context.request.get(url, { timeout: 60000 });
    return { url, status: res.status(), ok: res.ok() };
  } catch (err) {
    return { url, status: null, ok: false, error: err.message };
  }
}

