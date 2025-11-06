import { test } from "@playwright/test";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";
import * as XLSX from "xlsx";
import fs from "fs";

test.setTimeout(60 * 60 * 1000);

test("Compare WordPress users with Inventory Sheet2", async ({ page }) => {
  const objectFactory = createObjects(page);
  const finalFactory = objectFactory;

  console.log("🌐 Navigating to WordPress admin login...");
  await page.goto("https://dev-suny-geneseo.pantheonsite.io/wp-admin/users.php", {
    timeout: 60000,
    waitUntil: "domcontentloaded",
  });

  console.log("🔐 Logging in...");
  await page.getByRole("textbox", { name: "Username" }).fill(credentials.username || "amit.kaushal@infostride.com");
  await page.getByRole("textbox", { name: "Password" }).fill(credentials.password || "Login@123");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForSelector("#wpadminbar", { state: "visible" });
  console.log("✅ Logged in successfully.");

  console.log("📄 Scrolling through user table to load all users...");
  let lastCount = 0;
  let stableCount = 0;
  while (stableCount < 3) {
    const currentCount = await page.locator("table.users tbody tr").count();
    if (currentCount > lastCount) {
      console.log(`🔄 Loaded ${currentCount} rows so far...`);
      lastCount = currentCount;
      stableCount = 0;
    } else {
      stableCount++;
    }
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1500);
  }

  console.log(`✅ All rows loaded — total detected: ${lastCount}`);

  // 🧾 Extract user details from WordPress
  const allUsers = await page.$$eval("table.users tbody tr", (rows) =>
    rows.map((row) => ({
      Username: row.querySelector('td[data-colname="Username"] a')?.textContent.trim() || "",
      Name: row.querySelector('td[data-colname="Name"]')?.innerText.trim() || "",
      Email: row.querySelector('td[data-colname="Email"]')?.innerText.trim() || "",
      Role: row.querySelector('td[data-colname="Roles"]')?.innerText.trim() || "",
    }))
  );

  console.log(`🎯 Total users extracted: ${allUsers.length}`);

  // 💾 Save WordPress user list
  await finalFactory.utility.saveToExcel("UserDetails.xlsx", "UserDetails", allUsers, "Users");
  console.log("✅ Excel generated successfully: UserDetails.xlsx");

  // 🧩 Compare with Inventory.xlsx (Sheet2)
  const inventoryPath = "Inventory.xlsx";
  if (!fs.existsSync(inventoryPath)) {
    console.error("❌ Inventory.xlsx not found!");
    return;
  }

  console.log("📗 Reading Inventory Sheet2...");
  const invWorkbook = XLSX.readFile(inventoryPath);
  const invSheet = invWorkbook.Sheets["Sheet2"];
  const invUsers = XLSX.utils.sheet_to_json(invSheet);

  // 🧠 Build lookup maps
  const wpMap = new Map(allUsers.map((u) => [u.Username?.trim().toLowerCase(), u]));
  const invMap = new Map(invUsers.map((u) => [u.Username?.trim().toLowerCase(), u]));
  const comparisonResults = [];

  // 🧩 Normalization helpers
  function normalizeText(str) {
    return (str || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // Handles role differences between Inventory (;) and WordPress (,)
  function normalizeRoles(str) {
    return (str || "")
      .split(/[;,]/) // split by ; or ,
      .map((r) => normalizeText(r))
      .filter((r) => r.length > 0)
      .sort(); // order-independent
  }

  function isSimilarRole(a, b) {
    const aRoles = normalizeRoles(a);
    const bRoles = normalizeRoles(b);
    return JSON.stringify(aRoles) === JSON.stringify(bRoles);
  }

  console.log("🔍 Comparing users...");

  // 🔹 1️⃣ Inventory → WordPress (main comparison)
  for (const invUser of invUsers) {
    const key = invUser.Username?.trim().toLowerCase();
    const wpUser = wpMap.get(key);

    if (!wpUser) {
      comparisonResults.push({
        Username: invUser.Username,
        Status: "❌ Missing in WordPress",
        WP_Name: "",
        Inv_Name: invUser.Name || "",
        WP_Email: "",
        Inv_Email: invUser.Email || "",
        WP_Role: "",
        Inv_Role: invUser.Role || "",
      });
      continue;
    }

    const mismatches = [];
    if ((wpUser.Name || "").trim() !== (invUser.Name || "").trim()) mismatches.push("Name");
    if ((wpUser.Email || "").trim() !== (invUser.Email || "").trim()) mismatches.push("Email");
    if (!isSimilarRole(wpUser.Role, invUser.Role)) mismatches.push("Role");

    const status = mismatches.length === 0
      ? "✅ Match"
      : `⚠️ Mismatch in ${mismatches.join(", ")}`;

    comparisonResults.push({
      Username: invUser.Username,
      Status: status,
      WP_Name: wpUser.Name || "",
      Inv_Name: invUser.Name || "",
      WP_Email: wpUser.Email || "",
      Inv_Email: invUser.Email || "",
      WP_Role: wpUser.Role || "",
      Inv_Role: invUser.Role || "",
    });
  }

  // 🔹 2️⃣ WordPress → Inventory (detect extra users)
  for (const wpUser of allUsers) {
    const key = wpUser.Username?.trim().toLowerCase();
    if (!invMap.has(key)) {
      comparisonResults.push({
        Username: wpUser.Username,
        Status: "❌ Missing in Inventory",
        WP_Name: wpUser.Name || "",
        Inv_Name: "",
        WP_Email: wpUser.Email || "",
        Inv_Email: "",
        WP_Role: wpUser.Role || "",
        Inv_Role: "",
      });
    }
  }

  // 🧾 Save results with fixed column order
  const columns = [
    "Username",
    "Status",
    "WP_Name",
    "Inv_Name",
    "WP_Email",
    "Inv_Email",
    "WP_Role",
    "Inv_Role",
  ];

  const resultSheet = XLSX.utils.json_to_sheet(comparisonResults, { header: columns });
  const resultWB = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(resultWB, resultSheet, "Comparison");
  XLSX.writeFile(resultWB, "UserComparisonReport.xlsx");

  console.log("✅ Comparison report saved: UserComparisonReport.xlsx");
});
