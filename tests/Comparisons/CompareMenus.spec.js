import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";
import fs from "fs";
import XLSX from "xlsx";

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

test("📊 Scrape & Compare Menus from LIVE and DEV + Export Excel", async () => {
  const liveBase = "https://www.geneseo.edu/";
  const devBase = "https://dev-suny-geneseo.pantheonsite.io/";
  const excelInput = "basic_page.xlsx";
  const liveOutput = "live_menu.json";
  const devOutput = "dev_menu.json";
  const excelOutput = "MenuComparison.xlsx";

  const finalFactory = createObjects();
  const extractedUrls = await finalFactory.utility.loadUrlswithCPT(excelInput);

  console.log(`📄 Total URLs: ${extractedUrls.length}`);

  // -------- LIVE SCRAPE --------
  console.log("🌍 Scraping LIVE site...");
  const liveResults = await collectMenus("LIVE", liveBase, extractedUrls);
  fs.writeFileSync(liveOutput, JSON.stringify(liveResults, null, 2));

  // -------- DEV SCRAPE --------
  console.log("🖥️ Scraping DEV site...");
  const devResults = await collectMenus("DEV", devBase, extractedUrls);
  fs.writeFileSync(devOutput, JSON.stringify(devResults, null, 2));

  console.log("✅ JSON saved!");

  // -------- COMPARE --------
  console.log("🔍 Comparing LIVE vs DEV...");
  const diffs = compareAll(liveResults, devResults);

  // -------- EXCEL EXPORT --------
  exportToExcel(diffs, excelOutput);
  console.log(`📊 Excel saved: ${excelOutput}`);
});


// ========================================================
// 📘 Compare Function (with hierarchy + order)
// ========================================================
function compareAll(live, dev) {
  const diffs = [];

  for (let i = 0; i < live.length; i++) {
    const livePage = live[i];
    const devPage = dev.find(p => p.slug === livePage.slug);

    if (!devPage) {
      diffs.push({ Type: "Missing Page", LIVE: livePage.url, DEV: "", Details: "Not found in DEV" });
      continue;
    }

    const pageDiffs = compareMenus(livePage.menu, devPage.menu, livePage.slug);
    diffs.push(...pageDiffs);
  }

  return diffs;
}

function compareMenus(liveArr, devArr, path = "") {
  const diffs = [];
  const len = Math.max(liveArr.length, devArr.length);

  for (let i = 0; i < len; i++) {
    const liveItem = liveArr[i];
    const devItem = devArr[i];
    const currentPath = path + " > " + (liveItem?.menutext || liveItem?.submenutext || devItem?.menutext || devItem?.submenutext || `Item${i}`);

    if (!liveItem) {
      diffs.push({ Type: "Missing in LIVE", LIVE: "", DEV: devItem.menutext || devItem.submenutext, Details: currentPath });
      continue;
    }
    if (!devItem) {
      diffs.push({ Type: "Missing in DEV", LIVE: liveItem.menutext || liveItem.submenutext, DEV: "", Details: currentPath });
      continue;
    }

    if ((liveItem.menutext || liveItem.submenutext) !== (devItem.menutext || devItem.submenutext)) {
      diffs.push({
        Type: "Text Mismatch",
        LIVE: liveItem.menutext || liveItem.submenutext,
        DEV: devItem.menutext || devItem.submenutext,
        Details: currentPath
      });
    }

    if ((liveItem.menuhref || liveItem.submenuhref) !== (devItem.menuhref || devItem.submenuhref)) {
      diffs.push({
        Type: "Href Mismatch",
        LIVE: liveItem.menuhref || liveItem.submenuhref,
        DEV: devItem.menuhref || devItem.submenuhref,
        Details: currentPath
      });
    }

    if (liveItem.submenu && devItem.submenu)
      diffs.push(...compareMenus(liveItem.submenu, devItem.submenu, currentPath));
    else if (liveItem.submenu && !devItem.submenu)
      diffs.push({ Type: "Missing Submenu in DEV", LIVE: currentPath, DEV: "", Details: currentPath });
    else if (!liveItem.submenu && devItem.submenu)
      diffs.push({ Type: "Missing Submenu in LIVE", LIVE: "", DEV: currentPath, Details: currentPath });
  }

  return diffs;
}


// ========================================================
// 🧩 Excel Export
// ========================================================
function exportToExcel(diffs, output) {
  const worksheet = XLSX.utils.json_to_sheet(diffs);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Menu Comparison");
  XLSX.writeFile(workbook, output);
}


// ========================================================
// 🧠 Scraping Engine
// ========================================================
async function collectMenus(envName, baseUrl, urls) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let count = 0;

  for (const { cpt, slug } of urls) {
    const cleanSlug = slug.startsWith("/") ? slug : `/${slug}`;
    const fullUrl = `${baseUrl.replace(/\/+$/, "")}${cleanSlug}`;
    let status = "OK";
    let menuData = [];

    try {
      await safeGoto(page, fullUrl);
      await page.waitForLoadState("domcontentloaded");
      await closeCookiePopup(page);

      if (envName === "DEV")
        menuData = await scrapeDevMenu(page, baseUrl);
      else
        menuData = await scrapeLiveMenuRecursive(page, baseUrl, fullUrl);

      results.push({ CPT: cpt, slug: cleanSlug, url: fullUrl, menu: menuData, status });
    } catch (err) {
      status = `Error: ${err.message}`;
      results.push({ CPT: cpt, slug: cleanSlug, url: fullUrl, menu: [], status });
    }

    count++;
    if (count % 5 === 0) console.log(`⏳ [${envName}] Processed ${count}/${urls.length}`);
  }

  await browser.close();
  return results;
}


// ========================================================
// 🧭 DEV MENU SCRAPER (handles multiple dropdowns)
// ========================================================
async function scrapeDevMenu(page, baseUrl) {
  console.log("🖥️ Scraping DEV site...");
  const menuData = [];
  const visitedSubmenuHrefs = new Set();

  const headers = page.locator("h2.subsite-menu-header");
  const headerCount = await headers.count();
  console.log(`Found ${headerCount} headers`);

  for (let i = 0; i < headerCount; i++) {
    const headerText = await headers.nth(i).innerText().catch(() => "—");
    console.log(`Header: ${headerText}`);

    const items = page.locator("li.menu-item a.menu-link.subsite-menu-item");
    const itemCount = await items.count();
    console.log(`Found ${itemCount} top-level menu items under this header`);

    for (let j = 0; j < itemCount; j++) {
      const item = items.nth(j);

      // Skip items that are already in a submenu
      const isInsideSubmenu = await item.locator("xpath=ancestor::ul[contains(@class,'sub-menu')]").count() > 0;
      if (isInsideSubmenu) continue;

      const menutext = await item.locator("span.link-text").innerText().catch(() => "—");
      let menuhref = await item.getAttribute("href");
      if (menuhref?.startsWith("/")) menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      console.log(`Top menu: ${menutext} -> ${menuhref}`);

      const parentLi = item.locator("..").locator("..");
      const arrow = parentLi.locator("span.dropdown-arrow");
      const submenu = [];

      // Check if the dropdown exists
      const arrowCount = await arrow.count();
      if (arrowCount > 0) {
        console.log(`Dropdown found for ${menutext} (${arrowCount} arrow(s))`);

        for (let a = 0; a < arrowCount; a++) {
          const thisArrow = arrow.nth(a);
          if (await thisArrow.isVisible()) {
            await thisArrow.scrollIntoViewIfNeeded();
            await thisArrow.click({ force: true });
            await page.waitForTimeout(300);

            const subLinks = parentLi.locator("ul.sub-menu li.submenu-item a.menu-link.subsite-menu-item");
            const subCount = await subLinks.count();
            console.log(`Found ${subCount} submenu item(s) under ${menutext}`);

            for (let k = 0; k < subCount; k++) {
              const subLink = subLinks.nth(k);
              const submenutext = await subLink.locator("span.link-text").innerText().catch(() => "—");
              let submenuhref = await subLink.getAttribute("href");
              if (submenuhref?.startsWith("/")) submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;

              console.log(`  Submenu: ${submenutext} -> ${submenuhref}`);

              submenu.push({
                submenutext,
                submenuhref,
                type: "submenu",
                submenu: []
              });

              visitedSubmenuHrefs.add(submenuhref); // track submenu hrefs
            }
          }
        }
      }

      menuData.push({
        menutext,
        menuhref,
        type: "mainmenu",
        submenu
      });
    }
  }

  // Remove top-level menu items that are actually submenus
  const filteredMenu = menuData.filter(item => !visitedSubmenuHrefs.has(item.menuhref));
  console.log(`✅ DEV menu scraped: ${filteredMenu.length} top-level items`);
  return filteredMenu;
}


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
    await safeGoto(page, fullUrl, { timeout: 90000 });
    await closeCookiePopup(page);
    await page.waitForTimeout(800);

    // Get all top-level menu links
    const menuItems = page.locator("li.nav-item.list-group-item > a.nav-link");
    const count = await menuItems.count();
    console.log(`🔹 Found ${count} top-level menu items.`);

    const toggleQueue = [];

    // Pass 1: Collect all menu links + detect toggles
    for (let i = 0; i < count; i++) {
      const item = menuItems.nth(i);
      const menutext = (await item.innerText().catch(() => "—")).trim();
      let menuhref = await item.getAttribute("href");
      if (!menuhref) continue;
      if (menuhref.startsWith("/")) menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      const parentLi = item.locator("..");
      const isDropdown = await item.evaluate(el => el.classList.contains("dropdown-toggle"));
      const hasExpanded = await parentLi.locator(".group-menu-expanded").count() > 0;

      const entry = { menutext, menuhref, type: "mainmenu", submenu: [] };

      if (hasExpanded) {
        // scrape immediately if already expanded
        const subLinks = parentLi.locator(".group-menu-expanded li > a");
        const subCount = await subLinks.count();
        console.log(`📂 "${menutext}" already expanded with ${subCount} submenu items.`);
        for (let j = 0; j < subCount; j++) {
          const subLink = subLinks.nth(j);
          const submenutext = (await subLink.innerText().catch(() => "—")).trim();
          let submenuhref = await subLink.getAttribute("href");
          if (!submenuhref) continue;
          if (submenuhref.startsWith("/")) submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;
          entry.submenu.push({ submenutext, submenuhref, type: "submenu" });
          allSubmenuHrefs.add(submenuhref);
        }
      } else if (isDropdown) {
        // store for later visit
        toggleQueue.push({ menutext, menuhref });
      }

      result.push(entry);
    }

    console.log(`📦 LIVE toggleQueue (${toggleQueue.length}): ${JSON.stringify(toggleQueue, null, 2)}`);

    // Pass 2: visit each toggle page
    for (const toggle of toggleQueue) {
      try {
        console.log(`   ↳ Navigating to toggle page: ${toggle.menuhref}`);
        await safeGoto(page, toggle.menuhref, { timeout: 90000 });
        await closeCookiePopup(page);
        await page.waitForTimeout(1200);

        // Find expanded section (on navigated page)
        const expandedSection = page.locator(".group-menu-expanded li > a");
        const subCount = await expandedSection.count();
        console.log(`      🔸 Found ${subCount} submenu links under "${toggle.menutext}"`);

        const submenuArr = [];
        for (let k = 0; k < subCount; k++) {
          const subLink = expandedSection.nth(k);
          const submenutext = (await subLink.innerText().catch(() => "—")).trim();
          let submenuhref = await subLink.getAttribute("href");
          if (!submenuhref) continue;
          if (submenuhref.startsWith("/")) submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;
          submenuArr.push({ submenutext, submenuhref, type: "submenu" });
          allSubmenuHrefs.add(submenuhref);
        }

        const parent = result.find(m => m.menutext === toggle.menutext);
        if (parent) {
          parent.submenu = submenuArr;
          console.log(`      ✅ Attached ${submenuArr.length} submenu items to "${toggle.menutext}"`);
        }
      } catch (err) {
        console.warn(`❌ Error expanding "${toggle.menutext}": ${err.message}`);
      }
    }

    // Remove submenu links that appeared as main menu items
    const filteredResult = result.filter(item => !allSubmenuHrefs.has(item.menuhref));

    console.log(`\n✅ LIVE scraping complete for: ${fullUrl}`);
    console.log(`📊 Final menu count: ${filteredResult.length}`);
    return filteredResult;

  } catch (err) {
    console.warn(`❌ Error scraping ${fullUrl}: ${err.message}`);
    return result;
  }
}



// ========================================================
// 🧱 Utilities
// ========================================================
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
      await el.click({ force: true }).catch(() => {});
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
