// tests/broken-assets/testUrls.spec.js
import { test } from '@playwright/test';
import { chromium } from 'playwright';
import { createObjects } from '../../pages/ObjectFactory.js';

const BASE_URL = 'https://palegoldenrod-ant-677872.hostingersite.com/';
const STORAGE_FILE = './test-artifacts/session.json';

// Parallel configuration
const totalBrowsers = 3;        // number of browsers
const contextsPerBrowser = 2;   // contexts per browser
const tabsPerContext = 3;       // pages per context

test('🔥 Efficient parallel parent page checker', async () => {
  test.setTimeout(2 * 60 * 60 * 1000); // 2 hours

  const objectFactory = createObjects();
  const results = { allValidated: [], broken: [] };

  // --- Load URLs from Excel ---
  const rawUrls = await objectFactory.utility.loadExcel('basic_page.xlsx');
  const extractedUrls = rawUrls.map(url => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return BASE_URL + url.replace(/^\/+/, '');
  });

  // --- Split URLs among workers ---
  const totalWorkers = totalBrowsers * contextsPerBrowser * tabsPerContext;
  console.log(`🚀 Launching ${totalWorkers} workers`);
  const chunkArray = (arr, parts) => {
    const result = Array.from({ length: parts }, () => []);
    arr.forEach((item, index) => result[index % parts].push(item));
    return result;
  };
  const urlChunks = chunkArray(extractedUrls, totalWorkers);

  // --- Launch browsers ---
  const browsers = await Promise.all(
    Array.from({ length: totalBrowsers }, () =>
      chromium.launch({ headless: false }) // headless is faster
    )
  );

  // --- Run workers in parallel ---
  await Promise.all(browsers.map(async (browser, browserIdx) => {
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
              const record = await checkParentPage(page, url, workerId);
              results.allValidated.push(record);
              if (record.status === 'failed') results.broken.push(record);
            } catch (err) {
              results.allValidated.push({
                browserId: workerId,
                originalUrl: url,
                finalUrl: null,
                isRedirected: null,
                childUrl: url,
                isParent: true,
                status: 'failed',
                httpStatus: null,
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
  }));

  // --- Save results ---
  await objectFactory.utility.saveToExcel('validated-urls.xlsx', 'ValidatedUrls', results.allValidated, 'url-reports');
  await objectFactory.utility.saveToExcel('broken-links.xlsx', 'BrokenLinks', results.broken, 'url-reports');

  console.log('✅ Scanning complete.');
});

// --- Helper: check a single parent page ---
async function checkParentPage(page, pageUrl, browserId) {
  try {
    const response = await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000 // 3 minutes for slow pages
    });

    const finalUrl = page.url();
    const status = response?.status() || null;

    return {
      browserId,
      originalUrl: pageUrl,
      finalUrl,
      isRedirected: finalUrl !== pageUrl,
      childUrl: finalUrl,
      isParent: true,
      status: status && status < 400 ? 'ok' : 'failed',
      httpStatus: status,
      error: status && status >= 400 ? `HTTP ${status}` : null,
    };
  } catch (err) {
    // Graceful handling for slow/unreachable pages
    return {
      browserId,
      originalUrl: pageUrl,
      finalUrl: page.url() || pageUrl,
      isRedirected: false,
      childUrl: pageUrl,
      isParent: true,
      status: 'failed',
      httpStatus: null,
      error: err.message,
    };
  }
}
