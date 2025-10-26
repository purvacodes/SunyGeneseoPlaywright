import fs from "fs";
import * as XLSX from "xlsx";
import { test, chromium, firefox, webkit } from "@playwright/test";

// ====== CONFIG ======
const inputExcel = "basic_page.xlsx";       // Input with slugs
const generatedExcel = "generatedUrls.xlsx"; // Output with URLs
const browserChoice = "chromium";           // chromium | firefox | webkit
const startIndex = 1;                       // Starting row (1-based)
const endIndex = 10;                        // Ending row (inclusive)

// ============================================
// 🔹 Main Test
// ============================================
test.setTimeout(15 * 60 * 60 * 1000); // 6 hours
test("Generate and Open Live + Dev URLs in one browser (alternate tabs)", async () => {

  // ===== STEP 1: Generate Excel with URLs =====
  console.log("📘 Step 1: Generating URLs Excel...");

  if (!fs.existsSync(inputExcel)) {
    throw new Error(`❌ Input Excel not found: ${inputExcel}`);
  }

  const workbook = XLSX.readFile(inputExcel);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (!rawData.length) throw new Error("❌ Excel file is empty.");

  // Extract slugs (ignore headers)
  const hasHeader = typeof rawData[0][0] === "string" && rawData[0][0].includes("/");
  const rows = hasHeader ? rawData : rawData.slice(1);
  const slugs = rows.map(r => (r[0] || "").toString().trim()).filter(Boolean);

  if (!slugs.length) throw new Error("❌ No valid slugs found.");

  const outputData = slugs.map(slug => {
    const cleanSlug = slug.replace(/^\/+/, "");
    return {
      "Production URL": `https://www.geneseo.edu/${cleanSlug}`,
      "Localhost URL": `http://localhost/sunny/${cleanSlug}`
    };
  });

  const newWorkbook = XLSX.utils.book_new();
  const newWorksheet = XLSX.utils.json_to_sheet(outputData);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "URLs");
  XLSX.writeFile(newWorkbook, generatedExcel);

  console.log(`✅ Step 1 Done: Created ${generatedExcel}`);

  // ===== STEP 2: Open URLs in Browser Tabs =====
  console.log("🌐 Step 2: Opening alternate Live + Dev tabs...");

  const generatedWb = XLSX.readFile(generatedExcel);
  const ws = generatedWb.Sheets[generatedWb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws);

  const start = Math.max(0, startIndex - 1);
  const end = Math.min(data.length, endIndex);
  const selectedData = data.slice(start, end);

  if (!selectedData.length) {
    throw new Error(`❌ No URLs found in range ${startIndex}-${endIndex}`);
  }

  console.log(`✅ Range selected: ${startIndex}-${endIndex} (${selectedData.length} rows)`);
  console.log(`✅ Opening in browser: ${browserChoice}`);

  // Choose browser
  const browserType =
    browserChoice === "firefox"
      ? firefox
      : browserChoice === "webkit"
      ? webkit
      : chromium;

  const browser = await browserType.launch({ headless: false });
  const context = await browser.newContext();

  // Alternate open: Live -> Dev -> Live -> Dev
  for (const row of selectedData) {
    const liveURL = row["Production URL"];
    const devURL = row["Localhost URL"];

    if (liveURL) {
      const livePage = await context.newPage();
      await livePage.goto(liveURL);
      console.log(`🌎 Opened Live: ${liveURL}`);
    }

    if (devURL) {
      const devPage = await context.newPage();
      await devPage.goto(devURL);
      console.log(`💻 Opened Dev: ${devURL}`);
    }
  }

  console.log("✅ All Live + Dev tabs opened alternately in same browser.");
  console.log("🕒 Browser will stay open until manually closed.");
});
