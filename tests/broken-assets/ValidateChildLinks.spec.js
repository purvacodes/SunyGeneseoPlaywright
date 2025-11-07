import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";
import path from "path";

// ================= CONFIG =================
const baseUrl = "https://dev-suny-geneseo.pantheonsite.io";   // 🔧 Change your site base
const excelInput = "basic_page.xlsx";                         // 🔧 Input Excel (must have 'path' column)
const outputFile = "child_link_validation_results.xlsx";       // 🔧 Output Excel filename

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours (long runs)

test("🔗 Validate parent + child links (cache-free, sequential)", async () => {
  const objectFactory = createObjects();
  console.log(`📥 Loading paths from ${excelInput}...`);

  // Load Excel file using your existing loader
  const rows = objectFactory.utility.loadExcel(excelInput);
  console.log(`✅ Loaded ${rows.length} paths\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let processed = 0;

  for (const row of rows) {
    const pagePath = (row.path || "").trim();
    if (!pagePath) continue;

    // build parent URL
    const parentUrl = buildUrl(pagePath, baseUrl);
    const browserId = `B-${Date.now()}`;

    console.log(`🌐 Checking parent: ${parentUrl}`);

    // 1️⃣ Validate parent URL via HEAD/GET request (cache-free)
    const parentCheck = await checkUrl(parentUrl);
    results.push({
      browserId,
      originalUrl: parentUrl,
      finalUrl: parentUrl,
      childUrl: parentUrl,
      isParent: true,
      status: parentCheck.ok ? "ok" : "failed",
      httpStatus: parentCheck.status,
      error: parentCheck.error || "",
    });

    if (!parentCheck.ok) {
      console.log(`❌ Parent URL failed: ${parentUrl}`);
      continue;
    }

    // 2️⃣ Visit the parent page in Playwright
    let finalUrl = parentUrl;
    try {
      const response = await page.goto(parentUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      finalUrl = response?.url() || parentUrl;
    } catch (err) {
      console.log(`⚠️ Navigation error on ${parentUrl}: ${err.message}`);
      results.push({
        browserId,
        originalUrl: parentUrl,
        finalUrl: "—",
        childUrl: "—",
        isParent: false,
        status: "failed",
        httpStatus: "NAV_ERROR",
        error: err.message,
      });
      continue;
    }

    // 3️⃣ Re-check the final resolved URL
    const finalCheck = await checkUrl(finalUrl);
    if (!finalCheck.ok) {
      console.log(`⚠️ Final URL not valid: ${finalUrl}`);
      results.push({
        browserId,
        originalUrl: parentUrl,
        finalUrl,
        childUrl: finalUrl,
        isParent: false,
        status: "failed",
        httpStatus: finalCheck.status,
        error: finalCheck.error || "",
      });
      continue;
    }

    // 4️⃣ Extract all valid child links from page
    const childLinks = await extractLinks(page, baseUrl);
    console.log(`🔍 Found ${childLinks.length} child links on ${parentUrl}`);

    // 5️⃣ Sequentially validate each child link
    for (const childUrl of childLinks) {
      const check = await checkUrl(childUrl);
      results.push({
        browserId,
        originalUrl: parentUrl,
        finalUrl,
        childUrl,
        isParent: false,
        status: check.ok ? "ok" : "failed",
        httpStatus: check.status,
        error: check.error || "",
      });
    }

    processed++;
    console.log(`✅ Processed ${processed}/${rows.length} pages\n`);
  }

  await browser.close();
  saveToExcel(results, outputFile);
  console.log(`📦 Saved results to ${outputFile}`);
});


// ================= HELPERS =================

// 🔗 Build absolute URL safely
function buildUrl(pagePath, base) {
  if (!pagePath) return base;
  if (pagePath.startsWith("http")) return pagePath; // already absolute
  const clean = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
  return `${base}${clean}`;
}

// ⚙️ Perform HEAD/GET fetch (cache-free)
async function checkUrl(url) {
  const freshUrl = url.includes("?")
    ? `${url}&_t=${Date.now()}`
    : `${url}?_t=${Date.now()}`;

  const headers = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "User-Agent": `ChildLinksValidator/${Date.now()}`,
  };

  try {
    let res = await fetch(freshUrl, { method: "HEAD", headers });
    // fallback for servers that disallow HEAD
    if (res.status === 405 || res.status === 501) {
      res = await fetch(freshUrl, { method: "GET", headers });
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: "FETCH_ERROR", error: err.message };
  }
}

// 🧩 Extract and filter valid child links
async function extractLinks(page, baseUrl) {
  const links = await page.$$eval("a[href]", anchors =>
    anchors.map(a => a.href.trim()).filter(Boolean)
  );

  const unique = [...new Set(links)]
    .filter(u => u.startsWith("http")) // absolute links only
    .filter(u => !u.startsWith("mailto:"))
    .filter(u => !u.startsWith("tel:"))
    .filter(u => !u.includes("#"))
    .filter(u => !u.includes("javascript:void(0)"))
    .filter(u => !u.endsWith("/#"))
    .map(u => u.replace(/\?.*$/, "")); // remove query strings

  return unique;
}

// 💾 Save JSON data to Excel
function saveToExcel(data, filename) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Results");
  XLSX.writeFile(wb, filename);
}
