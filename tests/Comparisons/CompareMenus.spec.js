import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";
import fs from "fs";

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

test("📊 Scrape & Compare Menus from LIVE and DEV", async () => {
  const liveBase = "https://www.geneseo.edu/";
  const devBase = "https://dev-suny-geneseo.pantheonsite.io/";
  const excelInput = "basic_page.xlsx";
  const liveOutput = "live_menu.json";
  const devOutput = "dev_menu.json";

  console.log(`\n📥 Loading URLs from: ${excelInput}`);
  const finalFactory = createObjects();
  const extractedUrls = await finalFactory.utility.loadUrlswithCPT(excelInput);

  console.log(`📄 Total URLs to process: ${extractedUrls.length}\n`);

  console.log("🌐 Collecting menu data from LIVE site...");
  const liveResults = await collectMenus("LIVE", liveBase, extractedUrls);

  console.log("🖥️ Collecting menu data from DEV site...");
  const devResults = await collectMenus("DEV", devBase, extractedUrls);

  fs.writeFileSync(liveOutput, JSON.stringify(liveResults, null, 2));
  fs.writeFileSync(devOutput, JSON.stringify(devResults, null, 2));
  console.log("📂 JSON files saved!");

  // ================= Compare JSON =================
  console.log("\n🔎 Comparing LIVE vs DEV menu JSON...");
  const liveMenu = JSON.parse(fs.readFileSync(liveOutput));
  const devMenu = JSON.parse(fs.readFileSync(devOutput));

  const diffs = compareMenus(liveMenu, devMenu);
  if (diffs.length === 0) {
    console.log("✅ Menus match perfectly!");
  } else {
    console.log("❌ Differences found:");
    diffs.forEach(d => console.log(d));
  }
});

// ========================================================
// 📘 JSON Comparison (recursive, includes order)
// ========================================================
function compareMenus(liveArr, devArr, path = "") {
  const diffs = [];
  const len = Math.max(liveArr.length, devArr.length);

  for (let i = 0; i < len; i++) {
    const liveItem = liveArr[i];
    const devItem = devArr[i];
    const currentPath = path
      ? `${path} > ${liveItem?.menutext || devItem?.menutext || `Item${i}`}`
      : liveItem?.menutext || devItem?.menutext || `Item${i}`;

    if (!liveItem) {
      diffs.push(`Missing in LIVE: ${currentPath}`);
      continue;
    }
    if (!devItem) {
      diffs.push(`Missing in DEV: ${currentPath}`);
      continue;
    }

    // Compare menu text
    if ((liveItem.menutext || liveItem.submenutext) !== (devItem.menutext || devItem.submenutext)) {
      diffs.push(
        `Text mismatch at ${currentPath}: LIVE="${liveItem.menutext || liveItem.submenutext}" DEV="${devItem.menutext || devItem.submenutext}"`
      );
    }

    // Compare href
    if ((liveItem.menuhref || liveItem.submenuhref) !== (devItem.menuhref || devItem.submenuhref)) {
      diffs.push(
        `Href mismatch at ${currentPath}: LIVE="${liveItem.menuhref || liveItem.submenuhref}" DEV="${devItem.menuhref || devItem.submenuhref}"`
      );
    }

    // Recursively compare submenus
    if (liveItem.submenu && devItem.submenu) {
      diffs.push(...compareMenus(liveItem.submenu, devItem.submenu, currentPath));
    } else if (liveItem.submenu && !devItem.submenu) {
      diffs.push(`Missing submenu in DEV at ${currentPath}`);
    } else if (!liveItem.submenu && devItem.submenu) {
      diffs.push(`Missing submenu in LIVE at ${currentPath}`);
    }
  }

  return diffs;
}

// ========================================================
// 📘 Scraping Functions
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
      await safeGoto(page, fullUrl, { timeout: 90000, retries: 3 });
      await page.waitForLoadState("domcontentloaded");
      await closeCookiePopup(page);

      if (envName === "DEV") {
        menuData = await scrapeDevMenu(page, baseUrl);
      } else {
        menuData = await scrapeLiveMenuRecursive(page, baseUrl, fullUrl);
      }

      results.push({ CPT: cpt, slug: cleanSlug, url: fullUrl, menu: menuData, status });
    } catch (err) {
      status = `Error: ${err.message}`;
      results.push({ CPT: cpt, slug: cleanSlug, url: fullUrl, menu: [], status });
    }

    count++;
    if (count % 10 === 0) console.log(`⏳ [${envName}] ${count}/${urls.length} processed`);
  }

  console.log(`✅ [${envName}] Finished ${count}/${urls.length}`);
  await browser.close();
  return results;
}

// ------------------- DEV Menu Scraper -------------------
async function scrapeDevMenu(page, baseUrl) {
  const menuData = [];
  const visitedSubmenuHrefs = new Set();

  const headers = page.locator("h2.subsite-menu-header");
  const headerCount = await headers.count();

  for (let i = 0; i < headerCount; i++) {
    const headerText = await headers.nth(i).innerText().catch(() => "—");

    const items = page.locator("li.menu-item a.menu-link.subsite-menu-item");
    const itemCount = await items.count();

    for (let j = 0; j < itemCount; j++) {
      const item = items.nth(j);

      // Skip items that are inside a submenu
      const isInsideSubmenu = await item.locator("xpath=ancestor::ul[contains(@class,'sub-menu')]").count() > 0;
      if (isInsideSubmenu) continue;

      const menutext = await item.locator("span.link-text").innerText().catch(() => "—");
      let menuhref = await item.getAttribute("href");
      if (menuhref?.startsWith("/")) menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      const parentLi = item.locator("..").locator("..");
      const arrow = parentLi.locator("span.dropdown-arrow");
      const submenu = [];

      // Only if dropdown exists
      if (await arrow.isVisible()) {
        await arrow.scrollIntoViewIfNeeded();
        await arrow.click({ force: true });
        await page.waitForTimeout(300);

        const subLinks = parentLi.locator("ul.sub-menu li.submenu-item a.menu-link.subsite-menu-item");
        const subCount = await subLinks.count();

        for (let k = 0; k < subCount; k++) {
          const subLink = subLinks.nth(k);
          const submenutext = await subLink.locator("span.link-text").innerText().catch(() => "—");
          let submenuhref = await subLink.getAttribute("href");
          if (submenuhref?.startsWith("/")) submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;

          submenu.push({
            submenutext,
            submenuhref,
            type: "submenu",
            submenu: []
          });

          visitedSubmenuHrefs.add(submenuhref); // track submenu hrefs
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

  // Remove any top-level menu items that are actually submenus
  const filteredMenu = menuData.filter(item => !visitedSubmenuHrefs.has(item.menuhref));
  return filteredMenu;
}


// ------------------- LIVE Menu Scraper -------------------
const visited = new Set();

async function scrapeLiveMenuRecursive(page, baseUrl, fullUrl) {
  const result = [];
  const allSubmenuHrefs = new Set();
  if (visited.has(fullUrl)) return result;
  visited.add(fullUrl);

  await safeGoto(page, fullUrl, { timeout: 90000 });
  await closeCookiePopup(page);
  await page.waitForTimeout(800);

  const menuItems = page.locator("li.nav-item.list-group-item > a.nav-link");
  const count = await menuItems.count();
  const toggleQueue = [];

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
      const subLinks = parentLi.locator(".group-menu-expanded li > a");
      const subCount = await subLinks.count();
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
      toggleQueue.push({ menutext, menuhref });
    }

    result.push(entry);
  }

  // Visit collapsed dropdowns
  for (const toggle of toggleQueue) {
    try {
      await safeGoto(page, toggle.menuhref, { timeout: 90000 });
      await closeCookiePopup(page);
      await page.waitForTimeout(1000);

      const expanded = page.locator(".group-menu-expanded li > a");
      const subCount = await expanded.count();
      const submenuArr = [];
      for (let k = 0; k < subCount; k++) {
        const subLink = expanded.nth(k);
        const submenutext = (await subLink.innerText().catch(() => "—")).trim();
        let submenuhref = await subLink.getAttribute("href");
        if (!submenuhref) continue;
        if (submenuhref.startsWith("/")) submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;
        submenuArr.push({ submenutext, submenuhref, type: "submenu" });
        allSubmenuHrefs.add(submenuhref);
      }

      const parent = result.find(m => m.menutext === toggle.menutext);
      if (parent) parent.submenu = submenuArr;
      await safeGoto(page, fullUrl, { timeout: 90000 });
      await closeCookiePopup(page);
      await page.waitForTimeout(800);
    } catch {}
  }

  return result.filter(item => !allSubmenuHrefs.has(item.menuhref));
}

// ------------------- Cookie Popup -------------------
async function closeCookiePopup(page) {
  const selectors = [
    "#cookiescript_close",
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept')",
    "button:has-text('Got it')",
    ".cookie-consent-accept",
    "[aria-label*='cookie'][role='button']",
  ];
  for (const sel of selectors) {
    const el = page.locator(sel);
    if (await el.isVisible().catch(() => false)) {
      try {
        await el.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(1000);
        break;
      } catch {}
    }
  }
}

// ------------------- Safe Goto -------------------
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
