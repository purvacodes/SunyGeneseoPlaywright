// 🔥 tests/compare-breadcrumbs.test.js
import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(15 * 60 * 60 * 1000);

test("📌 Compare Breadcrumbs between Live and Local with Clean Logs", async () => {
  // ================= CONFIG =================
  const liveBase = "https://www.geneseo.edu";
  const localBase = "http://localhost/test";
  const excelInput = "basic_page.xlsx";
  const liveOutput = "live_breadcrumbs.xlsx";
  const localOutput = "local_breadcrumbs.xlsx";
  const finalOutput = "breadcrumb_comparison.xlsx";

  console.log(`\n📥 Loading data from: ${excelInput}`);
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const objectFactory = createObjects(tempPage, tempBrowser);
  const extractedUrls = await objectFactory.utility.loadExcel(excelInput);
  await tempBrowser.close();

  console.log(`📄 Total URLs to process: ${extractedUrls.length}\n`);

  // ================= STEP 2: LIVE SITE =================
  console.log("🌐 Collecting breadcrumbs from LIVE site...");
  const liveResults = await collectBreadcrumbs("LIVE", liveBase, extractedUrls);
  saveToExcel(liveResults, liveOutput);
  console.log("");

  // // ================= STEP 3: LOCAL SITE =================
  // console.log("🖥️  Collecting breadcrumbs from LOCAL site...");
  // const localResults = await collectBreadcrumbs("LOCAL", localBase, extractedUrls);
  // saveToExcel(localResults, localOutput);
  // console.log("");

  // ================= STEP 4: COMPARISON =================
  // console.log("⚔️ Comparison completed. Results saved to breadcrumb_comparison.xlsx\n");
  // const comparisonResults = compareBreadcrumbFiles(liveResults, localResults);
  // saveToExcel(comparisonResults, finalOutput);
});

// 📌 Helper: Collect Breadcrumbs for a given base URL
async function collectBreadcrumbs(envName, baseUrl, urls) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let processed = 0;

  // ⏱️ Progress log every 10 minutes
  const progressTimer = setInterval(() => {
    console.log(`⏳ [${envName}] Progress: ${processed}/${urls.length}`);
  }, 10 * 60 * 1000); // 10 min

  for (const urlObj of urls) {
    const slug = urlObj.url || urlObj;
    const fullUrl = buildUrls(slug, baseUrl, baseUrl).liveUrl;

    try {
      //console.log(`Navigating to: ${fullUrl}`);
      const breadcrumb = await getBreadcrumb(page, fullUrl);
      results.push({ url: slug, breadcrumb, status: "OK" });
     // console.log(`Success: ${breadcrumb}`);
    } catch (err) {
      results.push({ url: slug, breadcrumb: "Error", status: err.message });
      //console.log(`Failed: ${err.message}`);
    }

    processed++;
  }

  // 🧹 Clear progress timer after all URLs are processed
  clearInterval(progressTimer);
  console.log(`✅ [${envName}] Finished ${processed}/${urls.length}`);

  await browser.close();
  return results;
}

// 📌 Helper: Save JSON to Excel
function saveToExcel(data, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Breadcrumbs");
  XLSX.writeFile(wb, filename);
}

// 📌 Helper: Compare Live vs Local Breadcrumbs
function compareBreadcrumbFiles(liveResults, localResults) {
  const results = [];

  for (const live of liveResults) {
    const local = localResults.find(l => l.url === live.url);
    if (!local) continue;

    const liveBreadcrumb = live.breadcrumb || "";
    const localBreadcrumb = local.breadcrumb || "";

    const diffs = diffBreadcrumbs(liveBreadcrumb, localBreadcrumb);

    results.push({
      url: live.url,
      liveBreadcrumb,
      localBreadcrumb,
      status: diffs.length === 0 ? "Match ✅" : "Mismatch ❌",
      differences: diffs.map(d => `Pos ${d.position}: ${d.live} vs ${d.local}`).join(" | ")
    });
  }

  return results;
}


// 📌 Helper: Build URLs
function buildUrls(slug, liveBase, localBase) {
  if (/^https?:\/\//i.test(slug)) {
    const liveUrl = slug.includes(liveBase) ? slug : slug.replace(localBase, liveBase);
    const localUrl = slug.includes(localBase) ? slug : slug.replace(liveBase, localBase);
    return { liveUrl, localUrl };
  }
  const cleanSlug = slug.startsWith("/") ? slug : `/${slug}`;
  return {
    liveUrl: `${liveBase}${cleanSlug}`,
    localUrl: `${localBase}${cleanSlug}`
  };
}

// 📌 Helper: Get Breadcrumb Text (semantic + fallback)
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

// 📌 Helper: Diff Breadcrumbs
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
