import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

test("📊 Compare SEO tags between Live and Dev", async () => {
  const liveBase = "https://www.geneseo.edu/";
  const devBase = "https://dev-suny-geneseo.pantheonsite.io/";
  const excelInput = "Inventory.xlsx";
  const liveOutput = "live_seo.xlsx";
  const devOutput = "dev_seo.xlsx";
  const finalOutput = "seo_comparison.xlsx";

  console.log(`\n📥 Loading URLs from: ${excelInput}`);
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const finalFactory = createObjects(tempPage, tempBrowser);
  const extractedUrls = await finalFactory.utility.loadUrlswithCPT(excelInput);
  await tempBrowser.close();

  console.log(`📄 Total URLs to process: ${extractedUrls.length}\n`);

  // LIVE
  console.log("🌐 Collecting SEO data from LIVE site...");
  const liveResults = await collectSEO("LIVE", liveBase, extractedUrls);
  await finalFactory.utility.saveToExcel(liveOutput, "LiveSEO", liveResults, "comparison");

  // DEV
  console.log("🖥️ Collecting SEO data from DEV site...");
  const devResults = await collectSEO("DEV", devBase, extractedUrls);
  await finalFactory.utility.saveToExcel(devOutput, "DevSEO", devResults, "comparison");

  // COMPARE
  console.log("⚔️ Comparing Live vs Dev...");
  const comparisonResults = compareSEO(liveResults, devResults);
  await finalFactory.utility.saveToExcel(finalOutput, "SEOComparison", comparisonResults, "comparison");

  console.log(`✅ Comparison complete! Saved to test-artifacts/comparison/${finalOutput}\n`);
});


// ========================================================
// 📘 Collect SEO Data
// ========================================================
async function collectSEO(envName, baseUrl, urls) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let count = 0;

  for (const { cpt, slug } of urls) {
    const cleanSlug = slug.startsWith("/") ? slug : `/${slug}`;
    const fullUrl = `${baseUrl.replace(/\/+$/, "")}${cleanSlug}`;
    let seo = {};
    let status = "OK";

    try {
      const response = await page.goto(fullUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      if (!response || !response.ok()) status = `HTTP ${response?.status() || "Error"}`;
      seo = await extractSEO(page);
    } catch (err) {
      status = `Error: ${err.message}`;
    }

    results.push({
      CPT: cpt,
      slug: cleanSlug,
      url: fullUrl,
      status,
      ...seo,
    });

    count++;
    if (count % 10 === 0) console.log(`⏳ [${envName}] ${count}/${urls.length} processed`);
  }

  console.log(`✅ [${envName}] Finished ${count}/${urls.length}`);
  await browser.close();
  return results;
}


// ========================================================
// 📘 Extract SEO tags (meta name + property + title)
// ========================================================
async function extractSEO(page) {
  return await page.evaluate(() => {
    const data = {};
    data.title = document.title || "";

    const metas = Array.from(document.querySelectorAll("meta"));
    metas.forEach(meta => {
      const name = meta.getAttribute("name");
      const property = meta.getAttribute("property");
      const content = meta.getAttribute("content") || "";
      if (name) data[`name:${name}`.toLowerCase()] = content;
      if (property) data[`property:${property}`.toLowerCase()] = content;
    });

    return data;
  });
}


// ========================================================
// 📘 Compare SEO between Live & Dev
// ========================================================
function compareSEO(liveData, devData) {
  const excluded = [
    "name:viewport",
    "name:robots",
    "name:generator",
    "name:mobileoptimized",
    "name:handheldfriendly",
    "property:article:modified_time",
    "property:og:image",
    "property:og:image:width",
    "property:og:image:height",
    "property:og:image:type",
  ];

  const results = [];

  for (const liveRow of liveData) {
    const { CPT, slug, url } = liveRow;
    const devRow = devData.find(d => d.slug === slug);

    if (!devRow) {
      results.push({
        CPT,
        slug,
        url,
        tag: "—",
        liveValue: "—",
        devValue: "—",
        status: "⚠️ Missing page in Dev"
      });
      continue;
    }

    const liveKeys = Object.keys(liveRow).filter(
      k =>
        (k.startsWith("name:") || k.startsWith("property:") || k === "title") &&
        !excluded.includes(k.toLowerCase())
    );

    for (const key of liveKeys) {
      const liveVal = (liveRow[key] || "").trim();
      const devVal = (devRow[key] || "").trim();
      let status = "✅ Match";

      if (!(key in devRow)) {
        status = "❌ Missing in Dev (key)";
      } else if (!devVal) {
        status = "❌ Missing in Dev (value)";
      } else if (liveVal.toLowerCase() !== devVal.toLowerCase()) {
        status = "❌ Value mismatch";
      }

      results.push({
        CPT,
        slug,
        tag: key,
        liveValue: liveVal || "—",
        devValue: devVal || "—",
        status,
      });
    }
  }

  return results;
}
