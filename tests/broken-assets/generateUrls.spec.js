import fs from 'fs';
import * as XLSX from 'xlsx';
import { test } from "@playwright/test";

test("Generate URLs from Excel (no column name dependency)", async () => {
  // Read the Excel file
  const workbook = XLSX.readFile("basic_page.xlsx");
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read all rows, including headerless sheets
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (!rawData.length) {
    throw new Error("❌ Excel is empty.");
  }

  // If the first row looks like a header, skip it
  // You can tweak this logic if you always want to include the first row
  const hasHeader = typeof rawData[0][0] === "string" && rawData[0][0].includes("/");
  const rows = hasHeader ? rawData : rawData.slice(1);

  // Extract slugs from the first column of each row
  const slugs = rows.map(r => (r[0] || "").toString().trim()).filter(Boolean);

  if (!slugs.length) {
    throw new Error("❌ No slugs found in the Excel file.");
  }

  // Generate URLs
  const outputData = slugs.map(slug => {
    const cleanSlug = slug.replace(/^\/+/, ""); // remove leading slashes
    return {
      "Production URL": `https://www.geneseo.edu/${cleanSlug}`,
      "Localhost URL": `http://localhost/sunny/${cleanSlug}`
    };
  });

  // Create a new Excel file
  const newWorkbook = XLSX.utils.book_new();
  const newWorksheet = XLSX.utils.json_to_sheet(outputData);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "URLs");

  const outputFile = "generatedUrls.xlsx";
  XLSX.writeFile(newWorkbook, outputFile);

  console.log(`✅ URLs generated successfully: ${outputFile}`);
});
