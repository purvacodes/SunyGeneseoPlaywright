// tests/broken-assets/testMedia.spec.js
import { test } from '@playwright/test';
import { chromium } from 'playwright';
import { createObjects } from "../../pages/ObjectFactory.js";
import fetch from 'node-fetch'; // Required for HEAD checks

const BASE_URL = 'https://palegoldenrod-ant-677872.hostingersite.com/';
const STORAGE_FILE = './test-artifacts/session.json';

// Parallel configuration
const totalBrowsers = 3;        // number of browsers
const contextsPerBrowser = 2;   // contexts per browser
const tabsPerContext = 3;       // pages per context

test('🖼️ Parallel Media Validator', async () => {
  test.setTimeout(2 * 60 * 60 * 1000); // 2 hours

  const objectFactory = createObjects();
  const results = { validatedPages: [], allMedia: [], brokenMedia: [] };

  // --- Load URLs from Excel ---
  const rawUrls = await objectFactory.utility.loadExcel('basic_page.xlsx');
  const extractedUrls = rawUrls.map(url =>
    url.startsWith('http') ? url : BASE_URL + url.replace(/^\/+/, '')
  );

  // --- Split URLs among workers ---
  const totalWorkers = totalBrowsers * contextsPerBrowser * tabsPerContext;
  console.log(`🚀 Launching ${totalWorkers} workers for media validation`);
  const chunkArray = (arr, parts) => {
    const result = Array.from({ length: parts }, () => []);
    arr.forEach((item, index) => result[index % parts].push(item));
    return result;
  };
  const urlChunks = chunkArray(extractedUrls, totalWorkers);

  // --- Launch browsers ---
  const browsers = await Promise.all(
    Array.from({ length: totalBrowsers }, () =>
      chromium.launch({ headless: false })
    )
  );

  // Global media cache to avoid duplicate HEAD calls
  const mediaCache = new Map();

  // --- Run workers ---
  await Promise.all(
    browsers.map(async (browser, browserIdx) => {
      const contexts = await Promise.all(
        Array.from({ length: contextsPerBrowser }, async (_, ctxIdx) => {
          const context = await browser.newContext({ storageState: STORAGE_FILE });
          const pages = await Promise.all(
            Array.from({ length: tabsPerContext }, () => context.newPage())
          );

          const workerBaseId = `B${browserIdx + 1}-C${ctxIdx + 1}`;
          const pageJobs = pages.map(async (page, tabIdx) => {
            const workerId = `${workerBaseId}-T${tabIdx + 1}`;
            const urls = urlChunks.pop() || [];

            for (const url of urls) {
              try {
                const { allMedia, brokenMedia } = await checkMediaOnPage(page, url, workerId, mediaCache);
                results.allMedia.push(...allMedia);
                results.brokenMedia.push(...brokenMedia);
                results.validatedPages.push({
                  browserId: workerId,
                  originalUrl: url,
                  status: brokenMedia.length ? 'failed' : 'ok',
                  mediaCount: allMedia.length,
                  brokenCount: brokenMedia.length,
                });
              } catch (err) {
                results.validatedPages.push({
                  browserId: workerId,
                  originalUrl: url,
                  status: 'failed',
                  mediaCount: 0,
                  brokenCount: 0,
                  error: err.message,
                });
              }
            }

            await page.close();
          });

          await Promise.all(pageJobs);
          await context.close();
        })
      );

      await Promise.all(contexts);
      await browser.close();
    })
  );

  // --- Save Results ---
  await objectFactory.utility.saveToExcel('validated-media.xlsx', 'ValidatedMedia', results.allMedia, 'media-reports');
  await objectFactory.utility.saveToExcel('broken-media.xlsx', 'BrokenMedia', results.brokenMedia, 'media-reports');
  await objectFactory.utility.saveToExcel('media-pages.xlsx', 'PageSummary', results.validatedPages, 'media-reports');

  console.log('✅ Media validation complete.');
});


// --- Helper: Scan a single page for media ---
async function checkMediaOnPage(page, pageUrl, browserId, mediaCache) {
  const allMedia = [];
  const brokenMedia = [];

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // Handle "Continue" button if exists (common on Hostinger sites)
    const continueButton = page.getByRole('button', { name: 'Continue' });
    if (await continueButton.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
        continueButton.click(),
      ]);
    }

    await page.waitForLoadState('networkidle', { timeout: 60000 });

    // Scroll to load lazy media
    await autoScroll(page);

    const finalUrl = page.url();

    // Extract media sources
    const mediaSources = await page.evaluate(() => {
      const results = [];

      document.querySelectorAll('img[src]').forEach(el =>
        results.push({ type: 'image', src: el.getAttribute('src') })
      );
      document.querySelectorAll('video[src], video source[src]').forEach(el =>
        results.push({ type: 'video', src: el.getAttribute('src') })
      );

      const fileRegex = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp)(\?.*)?$/i;
      document.querySelectorAll('a[href], embed[src], iframe[src], object[data]').forEach(el => {
        let src = el.href || el.src || el.getAttribute('data');
        if (src && fileRegex.test(src)) {
          const match = src.match(fileRegex);
          const ext = match ? match[1].toLowerCase() : 'file';
          results.push({ type: ext, src });
        }
      });

      return results;
    });

    // Deduplicate
    const uniqueMedia = [
      ...new Map(mediaSources.map(m => [m.src, m])).values(),
    ];

    // Validate each media asset
    for (const media of uniqueMedia) {
      const fullUrl = new URL(media.src, finalUrl).href;
      const status = await checkMediaStatus(fullUrl, mediaCache);

      const record = {
        browserId,
        parentPage: finalUrl,
        fullMediaUrl: fullUrl,
        type: media.type,
        src: media.src,
        status: status.status,
      };
      allMedia.push(record);
      if (!status.ok) brokenMedia.push(record);
    }

    return { allMedia, brokenMedia, finalUrl };
  } catch (err) {
    console.warn(`⚠️ Error scanning ${pageUrl}: ${err.message}`);
    return { allMedia, brokenMedia, finalUrl: null };
  }
}


// --- Helper: Cached HEAD request ---
async function checkMediaStatus(url, cache) {
  if (cache.has(url)) return cache.get(url);

  try {
    const res = await fetch(url, { method: 'HEAD' });
    const result = { url, status: res.status, ok: res.ok };
    cache.set(url, result);
    return result;
  } catch (err) {
    const result = { url, status: 'FETCH_ERROR', ok: false, error: err.message };
    cache.set(url, result);
    return result;
  }
}


// --- Helper: Auto-scroll for lazy media ---
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight > 10000) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}