import { test, expect } from "@playwright/test";
import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";

test.setTimeout(60 * 60 * 1000);

test("Scrape Drupal Group Nodes and Content Types", async ({ page }) => {
  const objectFactory = createObjects(page);

  // ---- STEP 1: Load RoleMenuCompare.xlsx ----
  const workbook = XLSX.readFile("RoleMenuCompare.xlsx");
  const sheet = workbook.Sheets["Comparison_Results"];
  const extracted = XLSX.utils.sheet_to_json(sheet);

  // ---- STEP 2: Extract Group Name and ID ----
  const groups = extracted
    .filter((r) => r["Drupal Group ID"] && r["Drupal Group ID"] !== "-")
    .map((r) => ({
      id: r["Drupal Group ID"],
      name: r["Drupal Group"],
    }));

  console.log(`✅ Found ${groups.length} groups to scrape`);

  // ---- STEP 3: Login to Drupal ----
  await page.goto(credentials.drupal.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Username" }).fill(credentials.drupal.username);
  await page.getByRole("textbox", { name: "Password" }).fill(credentials.drupal.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForSelector("#toolbar-bar", { state: "visible" });

  const scrapedData = [];

  // ---- STEP 4: Loop through all groups ----
  for (const group of groups) {
    const url = `http://geneseo-drupal.ddev.site/group/${group.id}/nodes`;
    console.log(`🔍 Visiting: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.map((tr) => {
        const titleLink = tr.querySelector(".views-field.views-field-title a");
        const typeCell = tr.querySelector(".views-field.views-field-type");

        const link = titleLink ? titleLink.getAttribute("href").trim() : "";
        const contentType = typeCell ? typeCell.textContent.trim() : "";

        return { link, contentType };
      })
    );

    if (rows.length === 0) {
      scrapedData.push({
        "Drupal Group ID": group.id,
        "Drupal Group": group.name,
        URL: "No content found",
        "Content Type": "-",
      });
      continue;
    }

    // Store results
    for (const row of rows) {
      scrapedData.push({
        "Drupal Group ID": group.id,
        "Drupal Group": group.name,
        URL: row.link,
        "Content Type": row.contentType,
      });
    }

    console.log(`📦 Extracted ${rows.length} items from group ${group.name} (${group.id})`);
  }

  // ---- STEP 5: Save results to Excel ----
  const outWorkbook = XLSX.utils.book_new();
  const outSheet = XLSX.utils.json_to_sheet(scrapedData, {
    header: ["Drupal Group ID", "Drupal Group", "URL", "Content Type"],
  });

  // Auto column width
  const colWidths = Object.keys(scrapedData[0]).map((key) => ({
    wch: Math.max(
      key.length,
      ...scrapedData.map((r) => (r[key] ? r[key].toString().length : 0))
    ) + 2,
  }));
  outSheet["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(outWorkbook, outSheet, "Drupal_Group_Content");
  XLSX.writeFile(outWorkbook, "DrupalGroupContent.xlsx");

  console.log("📘 Data saved to DrupalGroupContent.xlsx");
});
