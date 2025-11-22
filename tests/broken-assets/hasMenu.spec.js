import { test } from "@playwright/test";
import { chromium } from "playwright";
import XLSX from "xlsx";
import fs from "fs";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(6 * 60 * 60 * 1000);

/* ======================================================================  
   NEW MINIMAL TEST  
   LOAD EXCEL → NAVIGATE → CHECK MENU STATUS → COMPARE → SAVE EXCEL  
====================================================================== */
test("🆕 Minimal Menu Validator & Comparator", async ({ }) => {

  const excelInput = "basic_page.xlsx";
  const excelOutput = "MenuValidationComparison.xlsx";

  const liveBase = "https://www.geneseo.edu";
  const devBase  = "https://dev-suny-geneseo.pantheonsite.io";
  const finalFactory = createObjects();

  // 1️⃣ LOAD URLS FROM EXCEL
  const urls = await finalFactory.utility.loadUrlswithCPT(excelInput);
  console.log(`📄 Loaded ${urls.length} URLs from Excel`);

    const browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"]   // opens browser window maximized
    });
  
    const context = await browser.newContext({
      viewport: null,
      deviceScaleFactor: undefined,             // forces context to use full window size
      bypassCache: true
    });
    const page = await context.newPage();

  const results = [];

  // 2️⃣ LOOP THROUGH ALL URLS
  for (const row of urls) {

    const clean = row.slug.startsWith("/") ? row.slug : "/" + row.slug;

    // LIVE URL
    const liveUrl = liveBase + clean;
    await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout:60000});
    const liveStatus = await checkLiveMenu(page);

    // DEV URL
    const devUrl = devBase + clean;
    await page.goto(devUrl, { waitUntil: "domcontentloaded" });
    const devStatus = await checkDevMenu(page);

    // 3️⃣ ADD TO RESULTS
    results.push({
      slug: clean,
      liveStatus,
      devStatus,
      comparison: compareMenuStatus(liveStatus, devStatus)
    });
  }

  // 4️⃣ EXPORT TO EXCEL
  exportResults(results, excelOutput);
  console.log(`📊 Excel saved: ${excelOutput}`);
  await browser.close();
});


/* ======================================================================
   👉 EXCEL LOADER (Simple)
====================================================================== */
function loadExcelUrls(filename) {
  const wb = XLSX.readFile(filename);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  return rows.map(r => ({
    slug: r.slug || r.URL || ""
  }));
}


/* ======================================================================
   👉 LIVE MENU CHECKER (SIMPLE)
====================================================================== */
async function checkLiveMenu(page) {
  const h2 = page.locator("div.list-group-item h2");
  if (await h2.count() > 0)
    return "VALID MENU";

  return "NO MENU";
}


/* ======================================================================
   👉 DEV MENU CHECKER — using ONLY hasDevMenu() logic
====================================================================== */
async function checkDevMenu(page) {
  const timeout = 9000; // 9 seconds

  // helper to wait for locator but with timeout
  async function waitForText(locator, description, timeout=5000) {
    try {
      const el = page.locator(locator);
      await el.first().waitFor({ state: "attached", timeout }); // waits for element to attach
      const txt = (await el.first().innerText().catch(() => "")).trim();
      if (txt) return txt;
      return null;
    } catch (err) {
      return `TIMEOUT waiting for ${description}`;
    }
  }

  // 1️⃣ VALID MENU — real menu header exists
  let result = await waitForText("h2.subsite-menu-header", "VALID MENU header");
  if (result && !result.startsWith("TIMEOUT")) return "VALID MENU";

  // 2️⃣ “Select Menu”
  result = await waitForText("p:has-text('Select Menu')", "'Select Menu' paragraph");
  if (result && !result.startsWith("TIMEOUT")) return result;

  // 3️⃣ “Menu not found” inside .subsiteNav
  result = await waitForText(".subsiteNav:has-text('Menu not found')", "'Menu not found' text");
  if (result && !result.startsWith("TIMEOUT")) return result;

  // 4️⃣ <p> inside .subsiteNav
  result = await waitForText(".subsiteNav p", "paragraph inside .subsiteNav");
  if (result && !result.startsWith("TIMEOUT")) return result;

  // 5️⃣ direct text inside .subsiteNav
  result = await waitForText(".subsiteNav", "direct text inside .subsiteNav");
  if (result && !result.startsWith("TIMEOUT")) return result;

  // 6️⃣ top-level UAGB container under entry-content.clear
  result = await waitForText("div.entry-content.clear > div.wp-block-uagb-container", "top-level UAGB container");
  if (result && !result.startsWith("TIMEOUT")) return result;

  // 7️⃣ fallback: any UAGB <p>
  result = await waitForText("div.wp-block-uagb-container p", "any UAGB paragraph");
  if (result && !result.startsWith("TIMEOUT")) return result;

  // 8️⃣ if all time out or empty
  return result?.startsWith("TIMEOUT") ? result : "NO MENU";
}





/* ======================================================================
   👉 COMPARE LIVE VS DEV (Simple)
====================================================================== */
function compareMenuStatus(liveStatus, devStatus) {
  if (liveStatus === devStatus)
    return "MATCHED";

  if (liveStatus === "VALID MENU" && devStatus !== "VALID MENU")
    return "DEV MISSING";

  if (devStatus === "VALID MENU" && liveStatus !== "VALID MENU")
    return "LIVE MISSING";

  return "MISMATCH";
}


/* ======================================================================
   👉 EXPORT TO EXCEL
====================================================================== */
function exportResults(rows, outFile) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "MenuCompare");
  XLSX.writeFile(wb, outFile);
}
