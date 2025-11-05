import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(15 * 60 * 60 * 1000);

test("📌 Compare Breadcrumbs between Live and Local", async () => {
  // ================= CONFIG =================
  const liveBase = "http://geneseo-drupal.ddev.site:33000";
  const localBase = "https://dev-suny-geneseo.pantheonsite.io";
  const excelInput = "basic_page.xlsx";
  const liveOutput = "live_breadcrumbs.xlsx";
  const localOutput = "local_breadcrumbs.xlsx";
  const finalOutput = "breadcrumb_comparison.xlsx";

  console.log(`\n📥 Loading URLs from: ${excelInput}`);
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);
  const extractedUrls = await objectFactory.utility.loadUrlswithCPT(excelInput);
  await tempBrowser.close();

 console.log(`📄 Total URLs to process: ${extractedUrls.length}\n`);

  // ================= STEP 2: LIVE SITE =================
  console.log("🌐 Collecting breadcrumbs from LIVE site...");
  const liveResults = await collectBreadcrumbs("LIVE", liveBase, extractedUrls);
  saveToExcel(liveResults, liveOutput);
  console.log("✅ Saved:", liveOutput);

  // ================= STEP 3: LOCAL SITE =================
  console.log("🖥️ Collecting breadcrumbs from LOCAL site...");
  const localResults = await collectBreadcrumbs("LOCAL", localBase, extractedUrls);
  saveToExcel(localResults, localOutput);
  console.log("✅ Saved:", localOutput);

  // ================= STEP 4: COMPARISON =================
  console.log("⚔️ Comparing Live vs Local...");
  // const comparisonResults = compareBreadcrumbFiles(liveResults, localResults);
  // saveToExcel(comparisonResults, finalOutput);
  // console.log(`✅ Comparison complete! Saved to ${finalOutput}\n`);
const comparisonResults = compareDiffFromExcel(liveOutput, localOutput, excelInput);
 saveToExcel(comparisonResults, finalOutput);
console.log(`✅ Comparison complete! Saved to ${finalOutput}`);
});


// 📌 Helper: Collect Breadcrumbs for a given base URL
async function collectBreadcrumbs(envName, baseUrl, urls) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let processed = 0;

  for (const { cpt, slug } of urls) {
    const { liveUrl } = buildUrls(slug, baseUrl, baseUrl);
    let finalUrl = liveUrl;
    let isRedirected = false;

    try {
      const response = await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      finalUrl = response.url();
      isRedirected = finalUrl !== liveUrl;

      const breadcrumb = await getBreadcrumb(page, finalUrl);
      results.push({
        CPT: cpt,
        originalUrl: liveUrl,
        finalUrl,
        isRedirected,
        breadcrumb,
        status: "OK"
      });
    } catch (err) {
      results.push({
        CPT: cpt,
        originalUrl: liveUrl,
        finalUrl: "—",
        isRedirected,
        breadcrumb: "—",
        status: `Error: ${err.message}`
      });
    }

    processed++;
    if (processed % 10 === 0) console.log(`⏳ [${envName}] ${processed}/${urls.length} done`);
  }

  console.log(`✅ [${envName}] Finished ${processed}/${urls.length}`);
  await browser.close();
  return results;
}


// 📘 Save JSON to Excel
function saveToExcel(data, filename) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, filename);
}


// 📘 Compare Live vs Local Breadcrumbs
function compareBreadcrumbFiles(liveResults, localResults) {
  const results = [];

  // 🧠 Normalize and dedupe both sides
  const uniqueLive = dedupeBySlug(liveResults);
  const uniqueLocal = dedupeBySlug(localResults);

  for (const live of uniqueLive) {
    const liveSlug = extractSlug(live.originalUrl);
    const local = uniqueLocal.find(l => extractSlug(l.originalUrl) === liveSlug);

    if (!local) {
      results.push({
        CPT: live.CPT,
        slug: liveSlug,
        liveBreadcrumb: live.breadcrumb || "—",
        localBreadcrumb: "—",
        status: "⚠️ Missing in Local",
        differences: "Not found in local file"
      });
      continue;
    }

    const liveBreadcrumb = live.breadcrumb || "—";
    const localBreadcrumb = local.breadcrumb || "—";
    const diffs = diffBreadcrumbs(liveBreadcrumb, localBreadcrumb);

    results.push({
      CPT: live.CPT,
      slug: liveSlug,
      liveBreadcrumb,
      localBreadcrumb,
      status: diffs.length === 0 ? "✅ Match" : "❌ Mismatch",
      differences: diffs.length
        ? diffs.map(d => `Pos ${d.position}: ${d.live} vs ${d.local}`).join(" | ")
        : "—"
    });
  }

  // 🧭 detect local-only pages
  for (const local of uniqueLocal) {
    const localSlug = extractSlug(local.originalUrl);
    if (!uniqueLive.find(l => extractSlug(l.originalUrl) === localSlug)) {
      results.push({
        CPT: local.CPT,
        slug: localSlug,
        liveBreadcrumb: "—",
        localBreadcrumb: local.breadcrumb || "—",
        status: "⚠️ Missing in Live",
        differences: "Not found in live file"
      });
    }
  }

  // ✅ sort alphabetically for readability
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}


// 📘 Helpers
function dedupeBySlug(list) {
  const seen = new Set();
  return list.filter(item => {
    const slug = extractSlug(item.originalUrl);
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

function normalizeUrl(url = "") {
  return url.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
}

function extractSlug(url = "") {
  try {
    const u = new URL(url);
    let slug = u.pathname || "/";
    slug = slug.replace(/^\/test/, ""); // ✅ strip /test prefix for local
    slug = slug.replace(/\/+$/, "");   // ✅ remove trailing slashes
    return slug || "/";
  } catch {
    return url;
  }
}


// 📘 Build URLs
function buildUrls(slug, liveBase, localBase) {
  if (typeof slug !== "string") slug = String(slug || "");
  const cleanSlug = slug.startsWith("/") ? slug : `/${slug}`;
  return {
    liveUrl: `${liveBase}${cleanSlug}`,
    localUrl: `${localBase}${cleanSlug}`
  };
}


// 📘 Extract Breadcrumbs from Page
async function getBreadcrumb(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  let breadcrumbParts = [];

  const breadcrumbNav =
    (await page.getByLabel('breadcrumb').count())
      ? page.getByLabel('breadcrumb')
      : (await page.getByLabel('Breadcrumbs').count())
        ? page.getByLabel('Breadcrumbs')
        : null;

  if (breadcrumbNav) {
    const linkTexts = await breadcrumbNav.getByRole('link').allInnerTexts();
    breadcrumbParts.push(...linkTexts.map(t => t.trim()).filter(Boolean));

    const lastTextElements = await breadcrumbNav.locator(":scope *:not(a)").allInnerTexts();
    const cleanTexts = lastTextElements
      .map(t => t.trim())
      .filter(t => t && !breadcrumbParts.includes(t));

    if (cleanTexts.length > 0) {
      breadcrumbParts.push(cleanTexts[cleanTexts.length - 1]);
    }
  }

  if (breadcrumbParts.length === 0) {
    const selectors = [
      "#ast-breadcrumbs-yoast",
      "ol.breadcrumb",
      "nav[aria-label='breadcrumb']",
      ".breadcrumb"
    ];

    for (const sel of selectors) {
      if (await page.locator(sel).count() > 0) {
        const parts = await page.$$eval(
          `${sel} a, ${sel} li, ${sel} span`,
          elements =>
            elements
              .map(el => el.textContent.trim())
              .filter(text => text && !/^»|\/$/.test(text))
        );
        if (parts.length > 0) {
          breadcrumbParts = parts;
          break;
        }
      }
    }
  }

  if (breadcrumbParts.length === 0) {
    throw new Error("Breadcrumb not found");
  }

  return breadcrumbParts.join(" > ");
}

function compareDiffFromExcel(liveFile, localFile) {
  const liveWb = XLSX.readFile(liveFile);
  const localWb = XLSX.readFile(localFile);

  const liveData = XLSX.utils.sheet_to_json(liveWb.Sheets[liveWb.SheetNames[0]]);
  const localData = XLSX.utils.sheet_to_json(localWb.Sheets[localWb.SheetNames[0]]);

  const results = [];

  const maxLen = Math.max(liveData.length, localData.length);

  for (let i = 0; i < maxLen; i++) {
    const liveRow = liveData[i] || {};
    const localRow = localData[i] || {};

    const cpt = liveRow.CPT || localRow.CPT || "";
    const liveUrl = liveRow.finalUrl || liveRow.originalUrl || liveRow.url || "—";
    const devUrl = localRow.finalUrl || localRow.originalUrl || localRow.url || "—";
    const liveBreadcrumb = liveRow.breadcrumb || "—";
    const localBreadcrumb = localRow.breadcrumb || "—";

    const diffs = diffBreadcrumbs(liveBreadcrumb, localBreadcrumb);

    results.push({
      CPT: cpt,
      devUrl,
      liveUrl,
      liveBreadcrumb,
      localBreadcrumb,
      status:
        !liveRow.breadcrumb && !localRow.breadcrumb
          ? "⚠️ Missing Breadcrumbs"
          : diffs.length === 0
          ? "✅ Match"
          : "❌ Mismatch",
      differences:
        diffs.length > 0
          ? diffs.map(d => `Pos ${d.position}: ${d.live} vs ${d.local}`).join(" | ")
          : "—"
    });
  }

  return results;
}


// 📘 Breadcrumb Diff Logic
function diffBreadcrumbs(liveBreadcrumb, localBreadcrumb) {
  const normalize = str =>
    (str || "")
      .replace(/[/»>]/g, "|")
      .replace(/\s*\|\s*/g, "|")
      .trim()
      .toLowerCase();

  const liveParts = normalize(liveBreadcrumb).split("|");
  const localParts = normalize(localBreadcrumb).split("|");
  const diffs = [];
  const max = Math.max(liveParts.length, localParts.length);

  for (let i = 0; i < max; i++) {
    const live = liveParts[i] || "—";
    const local = localParts[i] || "—";
    if (live !== local) {
      diffs.push({
        position: i + 1,
        live,
        local,
        type:
          live === "—" ? "missing in live" :
          local === "—" ? "missing in local" :
          "text difference"
      });
    }
  }
  return diffs;
}
