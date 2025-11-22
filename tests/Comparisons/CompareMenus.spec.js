import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";
import fs from "fs";
import XLSX from "xlsx";

test.setTimeout(24 * 60 * 60 * 1000);

test("📊 Scrape & Compare Menus from LIVE and DEV + Export Excel", async () => {
  visited.clear();
  const liveBase = "https://www.geneseo.edu/";
  const devBase = "https://dev-suny-geneseo.pantheonsite.io/";
  const excelInput = "basic_page.xlsx";
  const liveOutput = "live_menu.json";
  const devOutput = "dev_menu.json";
  const excelOutput = "MenuComparison.xlsx";

  const finalFactory = createObjects();
  const extractedUrls = await finalFactory.utility.loadUrlswithCPT(excelInput);

  console.log(`📄 Total URLs: ${extractedUrls.length}`);

  //-------- LIVE SCRAPE (kept intact but commented here as in your original)
  //  console.log("🌍 Scraping LIVE site...");
  // const liveResults = await collectMenus("LIVE", liveBase, extractedUrls);
  // fs.writeFileSync(liveOutput, JSON.stringify(liveResults, null, 2));

  // -------- DEV SCRAPE (kept intact but commented here as in your original)
  //console.log("🖥️ Scraping DEV site...");
  //const devResults = await collectMenus("DEV", devBase, extractedUrls);
  //fs.writeFileSync(devOutput, JSON.stringify(devResults, null, 2));


  //console.log("✅ JSON saved!");

  // -------- COMPARE --------
  console.log("📥 Reloading JSON files for comparison...");

  const liveJson = JSON.parse(fs.readFileSync(liveOutput, "utf8"));
  const devJson = JSON.parse(fs.readFileSync(devOutput, "utf8"));

  console.log("🔍 Comparing LIVE vs DEV using JSON files...");

  const diffs = compareAll_JSON(liveJson, devJson);

  // // -------- EXCEL EXPORT --------
  exportToExcel(diffs, excelOutput);
  console.log(`📊 Excel saved: ${excelOutput}`);
});


// ============================================================================
//  GLOBAL HELPERS (clean & minimal)
// ============================================================================
function norm(text) {
  return (text || "").toString().trim().toLowerCase();
}

function textOrEmpty(v) {
  return typeof v === "string" ? v : (v?.toString?.() || "");
}

function getPath(href) {
  if (!href) return "";
  try {
    const url = new URL(href);
    return (url.pathname || "").replace(/\/+$/, "");
  } catch {
    return href
      .replace(/https?:\/\/[^/]+/i, "")
      .replace(/\?.*$/, "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
  }
}

// Safe accessor for children across different shapes
function getChildren(node) {
  return node?.submenu || node?.submenuItems || node?.children || [];
}


// ============================================================================
//  TOP-LEVEL COMPARE (iterates pages and produces diffs)
// ============================================================================


function summaryRow(slug, liveVal, devVal, status) {
  return {
    WhichMenu: slug,
    WhichItem: "summary",
    LiveValue: liveVal || "",
    DevValue: devVal || "",
    Status: status
  };
}

function determineSummary(itemDiffs) {
  if (!itemDiffs || itemDiffs.length === 0)
    return "MENU MATCHED COMPLETELY";  // No diffs, so menus are completely matched

  const missingLive = itemDiffs.some(d => (d.Status || "").includes("Missing in LIVE"));
  const missingDev = itemDiffs.some(d => (d.Status || "").includes("Missing in DEV"));
  const orderMismatch = itemDiffs.some(d => (d.Status || "").includes("Order Mismatch"));
  const hierarchyMismatch = itemDiffs.some(d =>
    ["submenuhref", "submenutext"].includes(d.WhichItem) &&
    !["Href Match", "Text Match"].includes(d.Status)
  );
  const textMismatch = itemDiffs.some(d => d.Status === "Text Mismatch");
  const hrefMismatch = itemDiffs.some(d => d.Status === "Href Mismatch");

  // Check for missing items
  if (missingLive && !missingDev) return "Items MISSING IN LIVE";  // Items missing in LIVE but not in DEV
  if (missingDev && !missingLive) return "Items MISSING IN DEV";  // Items missing in DEV but not in LIVE
  if (missingLive && missingDev) return "MENU MISMATCH";  // Items missing in both LIVE and DEV

  // Check for order mismatch
  if (orderMismatch) return "Menu matched but order mismatch";  // Order mismatch detected

  // Check for hierarchy mismatch (non-matching submenus or structure)
  if (hierarchyMismatch) return "Menu matched but hierarchy mismatch";  // Hierarchy mismatch detected

  // Check for any other mismatches (text or href mismatches)
  if (textMismatch || hrefMismatch) return "MENU ITEMS MISMATCH";  // Non-matching items detected (text or href)

  // If no issues found, menus are matched completely
  return "MENU MATCHED COMPLETELY";
}


// ============================================================================
//  FULL, ORDER-TOLERANT, TWO-WAY MENU COMPARISON
//  - Compares mainmenu items by normalized text (so DEV→LIVE and LIVE→DEV are both checked)
//  - Compares headers, hrefs, and submenus recursively
// ============================================================================
function normalizeMenuStructure(menu = []) {
  return menu.map(item => ({
    ...item,
    submenu: Array.isArray(item.submenu)
      ? normalizeMenuStructure(item.submenu)
      : []
  }));
}
function compareAll_JSON(livePages = [], devPages = []) {
  const diffs = [];
  const devIndex = new Map(devPages.map(p => [p.slug, p]));

  for (const livePage of livePages) {
    const slug = livePage.slug;
    const devPage = devIndex.get(slug);

    // PAGE missing in DEV
    if (!devPage) {
      diffs.push(summaryRow(slug, "FOUND", "NOT FOUND", "Menu Missing in DEV"));
      continue;
    }

    const liveHas = Array.isArray(livePage.menu) && livePage.menu.length > 0;
    const devHas = Array.isArray(devPage.menu) && devPage.menu.length > 0;

    if (liveHas && !devHas) {
      diffs.push(summaryRow(slug, "FOUND", "NOT FOUND", "Menu Missing in DEV"));
      continue;
    }

    if (!liveHas && devHas) {
      diffs.push(summaryRow(slug, "NOT FOUND", "FOUND", "Menu Missing in LIVE"));
      continue;
    }

    // Menu invalid
    if (devPage.menuStatus === "INVALID MENU") {
      diffs.push(summaryRow(slug, "FOUND", "INVALID", "Invalid Menu on DEV"));
      continue;
    }

    if (livePage.menuStatus === "INVALID MENU") {
      diffs.push(summaryRow(slug, "INVALID", "FOUND", "Invalid Menu on LIVE"));
      continue;
    }

    const liveMenuNorm = normalizeMenuStructure(livePage.menu || []);
    const devMenuNorm = normalizeMenuStructure(devPage.menu || []);

    const itemDiffs = compareMenuItems_FULL(liveMenuNorm, devMenuNorm, slug);
    diffs.push(...itemDiffs);

    // Summary row
    const summaryStatus = determineSummary(itemDiffs);
    diffs.push({
      WhichMenu: slug,
      WhichItem: "summary",
      LiveValue: "",
      DevValue: "",
      Status: summaryStatus
    });
  }

  return diffs;
}

function compareMenuItems_FULL(liveMenu = [], devMenu = [], slug = "") {
  const diffs = [];

  // find headers
  const L_headers = liveMenu.filter(x => x.type === "header") || [];
  const D_headers = devMenu.filter(x => x.type === "header") || [];

  for (let i = 0; i < Math.max(L_headers.length, D_headers.length); i++) {
    const Lh = L_headers[i];
    const Dh = D_headers[i];
    diffs.push({
      WhichMenu: slug,
      WhichItem: "header",
      LiveValue: Lh?.menutext || "",
      DevValue: Dh?.menutext || "",
      Status: (Lh?.menutext || "") === (Dh?.menutext || "") ? "Text Match" : "Text Mismatch"
    });
  }

  // collect main menus only
  const L_main = (liveMenu.filter(x => x.type === "mainmenu") || []);
  const D_main = (devMenu.filter(x => x.type === "mainmenu") || []);

  // Check order (optional)
  const Lorder = L_main.map(m => norm(m.menutext));
  const Dorder = D_main.map(m => norm(m.menutext));
  if (JSON.stringify(Lorder) !== JSON.stringify(Dorder)) {
    diffs.push({
      WhichMenu: slug,
      WhichItem: "menu-order",
      LiveValue: Lorder.join(" | "),
      DevValue: Dorder.join(" | "),
      Status: "Order Mismatch"
    });
  }

  // Map by normalized text so we can compare sets (two-way)
  const Lmap = new Map(L_main.map(m => [norm(m.menutext || ""), m]));
  const Dmap = new Map(D_main.map(m => [norm(m.menutext || ""), m]));

  const allKeys = new Set([...Lmap.keys(), ...Dmap.keys()]);

  for (const key of allKeys) {
    const L = Lmap.get(key);
    const D = Dmap.get(key);

    // Helper function to push submenu or mainmenu missing messages
    function pushMissingItem(menuType, itemType, liveVal, devVal, status) {
      diffs.push({
        WhichMenu: slug,
        WhichItem: itemType,
        LiveValue: liveVal || "",
        DevValue: devVal || "",
        Status: status
      });
    }

    // Missing items (two-way)
    if (L && !D) {
      // For missing in DEV
      // Push menutext and menuhref
      pushMissingItem("mainmenu", "menutext", L.menutext, "", "Missing in DEV");
      pushMissingItem("mainmenu", "menuhref", L.menuhref || "", "", "Missing in DEV");

      // Push submenu items as submenu
      (L.submenu || []).forEach(sub => {
        pushMissingItem("submenu", "submenutext", sub.submenutext, "", "Missing in DEV");
        pushMissingItem("submenu", "submenuhref", sub.submenuhref || "", "", "Missing in DEV");
      });
      continue;
    }

    if (!L && D) {
      // For missing in LIVE
      // Push menutext and menuhref
      pushMissingItem("mainmenu", "menutext", "", D.menutext, "Missing in LIVE");
      pushMissingItem("mainmenu", "menuhref", "", D.menuhref || "", "Missing in LIVE");

      // Push submenu items as submenu
      (D.submenu || []).forEach(sub => {
        pushMissingItem("submenu", "submenutext", "", sub.submenutext, "Missing in LIVE");
        pushMissingItem("submenu", "submenuhref", "", sub.submenuhref || "", "Missing in LIVE");
      });
      continue;
    }

    // Both exist → compare text / href
    const Ltext = L?.menutext || "";
    const Dtext = D?.menutext || "";
    diffs.push({
      WhichMenu: slug,
      WhichItem: "menutext",
      LiveValue: Ltext,
      DevValue: Dtext,
      Status: Ltext === Dtext ? "Text Match" : "Text Mismatch"
    });

    const Lhref = L?.menuhref || "";
    const Dhref = D?.menuhref || "";
    diffs.push({
      WhichMenu: slug,
      WhichItem: "menuhref",
      LiveValue: Lhref,
      DevValue: Dhref,
      Status: getPath(Lhref) === getPath(Dhref) ? "Href Match" : "Href Mismatch"
    });

    // Compare submenus recursively (two-way)
    diffs.push(...compareSubMenus_FULL(L.submenu || [], D.submenu || [], slug, Ltext));
  }

  return diffs;
}

// Submenu comparator: two-way by normalized submenutext
function compareSubMenus_FULL(Lsub = [], Dsub = [], slug = "", parentMenu = "") {
  const diffs = [];

  const Lmap = new Map((Lsub || []).map(s => [norm(s.submenutext || s.menutext || ""), s]));
  const Dmap = new Map((Dsub || []).map(s => [norm(s.submenutext || s.menutext || ""), s]));

  const keys = new Set([...Lmap.keys(), ...Dmap.keys()]);

  for (const k of keys) {
    const LS = Lmap.get(k);
    const DS = Dmap.get(k);

    if (LS && !DS) {
      diffs.push({
        WhichMenu: slug,
        WhichItem: "submenutext",
        LiveValue: LS.submenutext || LS.menutext || "",
        DevValue: "",
        Status: `Missing in DEV`
      });
      diffs.push({
        WhichMenu: slug,
        WhichItem: "submenuhref",
        LiveValue: LS.submenuhref || LS.menuhref || "",
        DevValue: "",
        Status: `Missing in DEV`
      });
      continue;
    }

    if (!LS && DS) {
      diffs.push({
        WhichMenu: slug,
        WhichItem: "submenutext",
        LiveValue: "",
        DevValue: DS.submenutext || DS.menutext || "",
        Status: `Missing in LIVE`
      });
      diffs.push({
        WhichMenu: slug,
        WhichItem: "submenuhref",
        LiveValue: "",
        DevValue: DS.submenuhref || DS.menuhref || "",
        Status: `Missing in LIVE`
      });
      continue;
    }

    // Both exist
    const Lt = LS?.submenutext || LS?.menutext || "";
    const Dt = DS?.submenutext || DS?.menutext || "";
    diffs.push({
      WhichMenu: slug,
      WhichItem: "submenutext",
      LiveValue: Lt,
      DevValue: Dt,
      Status: Lt === Dt ? "Text Match" : "Text Mismatch"
    });

    const Lh = LS?.submenuhref || LS?.menuhref || "";
    const Dh = DS?.submenuhref || DS?.menuhref || "";
    diffs.push({
      WhichMenu: slug,
      WhichItem: "submenuhref",
      LiveValue: Lh,
      DevValue: Dh,
      Status: getPath(Lh) === getPath(Dh) ? "Href Match" : "Href Mismatch"
    });

    // If nested deeper, support 1 more nested level: normalized recursive call if children exist
    const Lnext = getChildren(LS) || [];
    const Dnext = getChildren(DS) || [];
    if ((Lnext.length || Dnext.length)) {
      // Recurse but use parent descriptor
      diffs.push(...compareSubMenus_FULL(Lnext, Dnext, slug, `${parentMenu} > ${Lt || Dt}`));
    }
  }

  return diffs;
}


// ============================================================================
//  EXCEL EXPORT (simple & stable - preserves your columns)
// ============================================================================
function exportToExcel(diffs, output) {
  const rows = diffs.map(r => ({
    WhichMenu: r.WhichMenu || r.whichMenu || "",
    WhichItem: r.WhichItem || r.Type || "",
    LiveValue: r.LiveValue ?? r.LIVE ?? "",
    DevValue: r.DevValue ?? r.DEV ?? "",
    Status: r.Status || r.Details || "No Status"
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ["WhichMenu", "WhichItem", "LiveValue", "DevValue", "Status"]
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Menu Comparison");

  XLSX.writeFile(workbook, output);
  console.log(`📊 Excel exported: ${output}`);
}



// ============================================================================
//  SCRAPING ENGINE & SCRAPERS (kept intact — only minimal cleanup to helpers)
//  I intentionally left your scrapers functionally the same as requested.
//  If you later want I can further DRY them without changing behavior.
// ============================================================================

async function collectMenus(envName, baseUrl, urls) {
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
  let count = 0;

  for (const { cpt, slug } of urls) {
    const cleanSlug = slug.startsWith("/") ? slug : `/${slug}`;
    const fullUrl = `${baseUrl.replace(/\/+$/, "")}${cleanSlug}`;
    let status = "OK";
    let menuData = [];
    let menuStatus = "UNKNOWN";

    try {
      await safeGoto(page, fullUrl);
      await page.waitForLoadState("domcontentloaded");
      await closeCookiePopup(page);

      if (envName === "LIVE") {
        const ok = await hasLiveMenu(page);
        if (!ok) {
          console.log("❌ LIVE: No menu — skipping scrape");
          menuStatus = "NO MENU";
          menuData = [];
        } else {
          console.log("✅ LIVE: Menu found — scraping...");
          menuStatus = "VALID MENU";
          menuData = await scrapeLiveMenuRecursive(page, baseUrl, fullUrl);
        }
      }

      if (envName === "DEV") {
        const isDevMenuValid = await hasDevMenu(page);  // Using the updated hasDevMenu logic

        if (isDevMenuValid) {
          menuStatus = "VALID MENU";
          menuData = await scrapeDevMenu(page, baseUrl);
        } else {
          menuStatus = "INVALID MENU";  // If the menu is invalid on DEV
          menuData = [];
        }
      }

      results.push({
        CPT: cpt,
        slug: cleanSlug,
        url: fullUrl,
        menuStatus,  // Updated to reflect the new status
        menu: menuData,
        status
      });

    } catch (err) {
      status = `Error: ${err.message}`;
      results.push({
        CPT: cpt,
        slug: cleanSlug,
        url: fullUrl,
        menuStatus: "ERROR",
        menu: [],
        status
      });
    }

    count++;
    if (count % 5 === 0) console.log(`⏳ [${envName}] Processed ${count}/${urls.length}`);
  }

  await browser.close();
  return results;
}


// ---------------- DEV SCRAPER (kept as you had it)
async function scrapeDevMenu(page, baseUrl) {
  console.log(`\n🖥️ Scraping DEV: ${page.url()}`);

  const menuData = [];
  const visitedSubmenuHrefs = new Set();

  // Scroll to the bottom to ensure all dynamic content is loaded
  await scrollToBottom(page);

  // Get the global heading (if any)
  const devGlobalHeading = await page.locator("div.menu-header h2.subsite-menu-header span").innerText().catch(() => "");
  const devGlobalHeadingTrim = devGlobalHeading ? devGlobalHeading.trim() : "";

  if (devGlobalHeadingTrim) {
    menuData.push({
      menutext: devGlobalHeadingTrim,
      menuhref: "",
      type: "header",
      submenu: []
    });
    console.log(`📌 DEV Heading Found: ${devGlobalHeadingTrim}`);
  }

  // Find all menu headers
  const headers = page.locator("h2.subsite-menu-header");
  const headerCount = await headers.count().catch(() => 0);

  console.log(`🔹 Found ${headerCount} menu headers (subsite-menu-header).`);

  for (let i = 0; i < headerCount; i++) {
    const headerEl = headers.nth(i);
    const headerTextRaw = await headerEl.innerText().catch(() => "—");
    const headerText = headerTextRaw ? headerTextRaw.trim() : "—";
    console.log(`📂 Header: ${headerText}`);

    // Skip global heading if it matches
    if (devGlobalHeadingTrim && headerText === devGlobalHeadingTrim) {
      console.log(`   ↳ Skipping header because it duplicates the global heading: ${headerText}`);
    } else {
      const last = menuData.length ? menuData[menuData.length - 1] : null;
      if (!(last && last.type === "header" && last.menutext === headerText)) {
        menuData.push({ menutext: headerText, menuhref: "", type: "header", submenu: [] });
      } else {
        console.log(`   ↳ Skipped consecutive duplicate header: ${headerText}`);
      }
    }

    // Get all top-level menu items
    let items = headerEl.locator("xpath=following-sibling::ul[1]//li[contains(@class,'menu-item')]//a[contains(@class,'menu-link')]");
    let itemCount = await items.count().catch(() => 0);

    if (itemCount === 0) {
      items = page.locator("li.menu-item a.menu-link.subsite-menu-item");
      itemCount = await items.count().catch(() => 0);
    }

    console.log(`   🔸 Found ${itemCount} top-level menu items under this header.`);

    for (let j = 0; j < itemCount; j++) {
      const item = items.nth(j);
      const parentLi = item.locator("..").locator("..");

      // Check if the item is inside a submenu
      const isInsideSubmenu = (await item.locator("xpath=ancestor::ul[contains(@class,'sub-menu')]").count()) > 0;
      if (isInsideSubmenu) continue;

      const menutext = await item.locator("span.link-text").innerText().catch(() => "—");
      let menuhref = await item.getAttribute("href");
      if (menuhref?.startsWith("/"))
        menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      const menutextTrim = menutext ? menutext.trim() : "—";
      console.log(`   🔹 Menu: ${menutextTrim}  →  ${menuhref}`);

      // Check if the menu item has a dropdown (arrow)
      const arrow = parentLi.locator("span.dropdown-arrow");
      const arrowCount = await arrow.count().catch(() => 0);

      const submenu = [];

      if (arrowCount > 0) {
        console.log(`      📦 Dropdown detected (${arrowCount} arrow(s)) for "${menutextTrim}"`);
        for (let a = 0; a < arrowCount; a++) {
          const thisArrow = arrow.nth(a);

          const arrowLi = await thisArrow.evaluateHandle(el => el.closest("li"));
          const isDirectArrow = await parentLi.evaluate((li, arrowLi) => li === arrowLi, arrowLi);

          if (!isDirectArrow) continue;

          if (await thisArrow.isVisible()) {
            // Open the dropdown menu
            await scrollToElement(page, thisArrow);
            await thisArrow.click({ force: true });
            await page.waitForTimeout(300);

            const subLinks = parentLi.locator("> ul.sub-menu li.submenu-item a.menu-link.subsite-menu-item");
            const subCount = await subLinks.count().catch(() => 0);

            console.log(`         🔸 Found ${subCount} submenu items under "${menutextTrim}"`);

            for (let k = 0; k < subCount; k++) {
              const subLink = subLinks.nth(k);
              const submenutext = await subLink.locator("span.link-text").innerText().catch(() => "—");
              let submenuhref = await subLink.getAttribute("href");

              if (submenuhref?.startsWith("/"))
                submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;

              const submenutextTrim = submenutext ? submenutext.trim() : "—";

              console.log(`            ↳ Submenu: ${submenutextTrim}  →  ${submenuhref}`);

              submenu.push({
                submenutext: submenutextTrim,
                submenuhref,
                type: "submenu",
                submenu: []
              });

              visitedSubmenuHrefs.add(submenuhref);
            }
          }
        }
      }

      // Avoid duplicate menu items
      const lastMenu = menuData.length ? menuData[menuData.length - 1] : null;
      if (!(lastMenu && lastMenu.menutext === menutextTrim && lastMenu.menuhref === menuhref && lastMenu.type === "mainmenu")) {
        menuData.push({ menutext: menutextTrim, menuhref, type: "mainmenu", submenu });
      } else {
        console.log(`   ↳ Skipped consecutive duplicate menu item: ${menutextTrim}`);
      }
    }
  }

  // Fallback if no headers were found
  if (menuData.length === 0) {
    console.log("⚠️ No headers found on DEV page; trying fallback top-level selector.");
    const fallbackItems = page.locator("li.menu-item > a");
    const fallbackCount = await fallbackItems.count().catch(() => 0);
    for (let i = 0; i < fallbackCount; i++) {
      const item = fallbackItems.nth(i);
      const menutext = await item.innerText().catch(() => "—");
      let menuhref = await item.getAttribute("href");
      if (menuhref?.startsWith("/"))
        menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;
      menuData.push({ menutext, menuhref, type: "mainmenu", submenu: [] });
    }
  }

  console.log(`\n✅ DEV scraping complete.`);

  return menuData;
}

// Helper function to scroll to the bottom of the page
async function scrollToBottom(page) {
  let lastHeight;
  while (true) {
    // Get current scroll height
    const newHeight = await page.evaluate('document.body.scrollHeight');

    if (newHeight === lastHeight) break;

    // Scroll to the bottom of the page
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');

    // Wait for new content to load
    await page.waitForTimeout(1000);

    lastHeight = newHeight;
  }
}

// Scroll to an element using manual scrolling
async function scrollToElement(page, elementLocator) {
  const elementHandle = await elementLocator.elementHandle();
  await page.evaluate(el => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, elementHandle);
  await page.waitForTimeout(300); // Wait for the element to come into view
}



// ---------------- LIVE SCRAPER (kept as you had it)
const visited = new Set();
async function scrapeLiveMenuRecursive(page, baseUrl, fullUrl) {
  console.log(`\n🌍 Scraping LIVE: ${fullUrl}`);
  const result = [];
  const allSubmenuHrefs = new Set();

  if (visited.has(fullUrl)) {
    console.log(`↩️ Already visited: ${fullUrl}`);
    return result;
  }
  visited.add(fullUrl);

  try {
    await closeCookiePopup(page);
    await page.waitForTimeout(800);

    const liveHeading = await page.locator("div.list-group-item h2").innerText().catch(() => "");
    if (liveHeading) {
      result.push({ menutext: liveHeading.trim(), menuhref: "", type: "header", submenu: [] });
      console.log(`📌 LIVE Heading Found: ${liveHeading}`);
    }

    const menuItems = page.locator("li.nav-item.list-group-item > a.nav-link:not(.sub-menu-link)");
    const count = await menuItems.count().catch(() => 0);
    console.log(`🔹 Found ${count} top-level menu items.`);

    const toggleQueue = [];

    for (let i = 0; i < count; i++) {
      const item = menuItems.nth(i);
      const menutext = (await item.innerText().catch(() => "—")).trim();
      let menuhref = await item.getAttribute("href");
      if (!menuhref) continue;
      if (menuhref.startsWith("/")) {
        menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;
      }

      const parentLi = item.locator("..");
      const isDropdown = await item.evaluate(el => el.classList.contains("dropdown-toggle")).catch(() => false);
      const hasExpanded = (await parentLi.locator(".group-menu-expanded").count().catch(() => 0)) > 0;
      const isInsideSubmenu = await item.evaluate(el => !!el.closest(".sub-menu")).catch(() => false);

      if (isInsideSubmenu) {
        console.log(`⏭️ Skipped submenu item (wrongly detected as main): ${menutext}`);
        continue;
      }

      const entry = { menutext, menuhref, type: "mainmenu", submenu: [] };

      if (hasExpanded) {
        const subLinks = parentLi.locator(".group-menu-expanded li > a");
        const subCount = await subLinks.count().catch(() => 0);
        console.log(`📂 "${menutext}" already expanded with ${subCount} submenu items.`);

        for (let j = 0; j < subCount; j++) {
          const subLink = subLinks.nth(j);
          const submenutext = (await subLink.innerText().catch(() => "—")).trim();
          let submenuhref = await subLink.getAttribute("href");
          if (!submenuhref) continue;
          if (submenuhref.startsWith("/")) {
            submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;
          }
          entry.submenu.push({ submenutext, submenuhref, type: "submenu" });
          allSubmenuHrefs.add(submenuhref);
        }
      } else if (isDropdown) {
        toggleQueue.push({ menutext, menuhref });
      }

      result.push(entry);
    }

    console.log(`📦 LIVE toggleQueue (${toggleQueue.length}):`);
    console.log(toggleQueue);

    for (const toggle of toggleQueue) {
      try {
        console.log(`↳ Navigating to toggle page: ${toggle.menuhref}`);
        await safeGoto(page, toggle.menuhref, { timeout: 90000 });
        await closeCookiePopup(page);
        await page.waitForTimeout(1200);

        const expandedSection = page.locator(".group-menu-expanded li > a");
        const subCount = await expandedSection.count().catch(() => 0);
        console.log(`🔸 Found ${subCount} submenu links under "${toggle.menutext}"`);

        const submenuArr = [];
        for (let k = 0; k < subCount; k++) {
          const subLink = expandedSection.nth(k);
          const submenutext = (await subLink.innerText().catch(() => "—")).trim();
          let submenuhref = await subLink.getAttribute("href");
          if (!submenuhref) continue;
          if (submenuhref.startsWith("/")) {
            submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;
          }
          submenuArr.push({ submenutext, submenuhref, type: "submenu" });
          allSubmenuHrefs.add(submenuhref);
        }

        const parent = result.find(m => m.menutext === toggle.menutext);
        if (parent) {
          parent.submenu = submenuArr;
          console.log(`✅ Attached ${submenuArr.length} submenu items to "${toggle.menutext}"`);
        }
      } catch (err) {
        console.warn(`❌ Error expanding "${toggle.menutext}": ${err.message}`);
      }
    }

    const filteredResult = result.filter(item => !allSubmenuHrefs.has(item.menuhref));

    console.log(`\n✅ LIVE scraping complete for: ${fullUrl}`);
    console.log(`📊 Final menu count: ${filteredResult.length}`);

    return filteredResult;

  } catch (err) {
    console.warn(`❌ Error scraping ${fullUrl}: ${err.message}`);
    return result;
  }
}


// ============================================================================
//  UTILITIES (kept behaviour same as your original)
// ============================================================================
async function closeCookiePopup(page) {
  const selectors = [
    "#cookiescript_close",
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept')",
    "button:has-text('Got it')",
    ".cookie-consent-accept",
  ];
  for (const sel of selectors) {
    const el = page.locator(sel);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ force: true }).catch(() => { });
      await page.waitForTimeout(500);
      break;
    }
  }
}

async function safeGoto(page, url, { timeout = 90000, retries = 2 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      await page.waitForLoadState("domcontentloaded");
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await page.waitForTimeout(3000);
    }
  }
}

async function hasLiveMenu(page) {
  const current = page.url();
  console.log(`🌐 [LIVE] Checking menu on: ${current}`);

  const count = await page.locator("div.list-group-item h2").count().catch(() => 0);

  if (count > 0) {
    console.log(`✅ LIVE: VALID MENU → ${current}`);
    return true;
  }

  console.log(`❌ LIVE: NO MENU → ${current}`);
  return false;
}

async function hasDevMenu(page) {
  const current = page.url();
  console.log(`🌐 [DEV] Checking menu on: ${current}`);

  // 1. Check heading-based menu first
  const menuHeading = await page.locator("h2.subsite-menu-header").count();
  if (menuHeading > 0) {
    console.log(`✅ DEV: Menu heading found → Menu is valid`);
    return true;
  }

  // 2. Check if subsiteNav exists
  const subsiteNav = await page.locator(".subsiteNav").count();
  if (subsiteNav === 0) {
    console.log(`❌ DEV: Heading or subsiteNav not found → Menu not found`);
    return false;
  }

  // 3. Try to read <p> text (SAFE version — never hangs)
  let pText = null;
  try {
    pText = await page
      .locator("div.wp-block-group.subsiteNav p")
      .first()
      .textContent({ timeout: 500 });
  } catch {}

  if (pText && pText.trim().length > 0) {
    console.log(`❌ DEV: Invalid menu message (from <p>) → "${pText.trim()}"`);
    return false;
  }

  console.log("ℹ️ DEV: No <p> tag found or no message, checking direct div text…");

  // 4. Try to read direct text from subsiteNav div (SAFE version)
  let directText = null;
  try {
    directText = await page
      .locator("div.wp-block-group.subsiteNav")
      .first()
      .innerText({ timeout: 500 });
  } catch {}

  if (directText && directText.trim().length > 0) {
    console.log(`❌ DEV: Invalid menu message (from div text) → "${directText.trim()}"`);
    return false;
  }

  // 5. If BOTH are empty → menu is valid
  console.log(`✅ DEV: subsiteNav found & no invalid message → Menu is valid`);
  return true;
}
