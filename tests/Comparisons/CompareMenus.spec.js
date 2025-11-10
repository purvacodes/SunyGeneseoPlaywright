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
});

// ========================================================
// 📘 Unified Scraper
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

// ========================================================
// 🧩 DEV SITE MENU SCRAPER
// ========================================================
async function scrapeDevMenu(page, baseUrl) {
  const menuData = [];
  const headers = page.locator("h2.subsite-menu-header");
  const headerCount = await headers.count();

  for (let i = 0; i < headerCount; i++) {
    const headerText = await headers.nth(i).innerText().catch(() => "—");

    const items = page.locator("li.menu-item a.menu-link.subsite-menu-item");
    const itemCount = await items.count();

    for (let j = 0; j < itemCount; j++) {
      const item = items.nth(j);

      // Check if this item is already inside a submenu
      const isInsideSubmenu = await item.locator("xpath=ancestor::ul[contains(@class,'sub-menu')]").count() > 0;
      if (isInsideSubmenu) continue; // Skip submenu items from being pushed as main menu

      const menutext = await item.locator("span.link-text").innerText().catch(() => "—");
      let menuhref = await item.getAttribute("href");
      if (menuhref?.startsWith("/")) menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      const parentLi = item.locator("..").locator("..");
      const arrow = parentLi.locator("span.dropdown-arrow");
      const submenu = [];

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

  return menuData;
}



// ========================================================
// 🧭 LIVE SITE MENU SCRAPER (No duplicate children in main menu)
// ========================================================
// ========================================================
// 🧭 LIVE SITE MENU SCRAPER (with type labels + no duplicates)
// ========================================================
const visited = new Set();

async function scrapeLiveMenuRecursive(page, baseUrl, fullUrl, depth = 0) {
  const result = [];
  if (visited.has(fullUrl)) {
    console.log(`${"  ".repeat(depth)}↩️ Already visited: ${fullUrl}`);
    return result;
  }
  visited.add(fullUrl);

  try {
    console.log(`${"  ".repeat(depth)}🌍 Navigating to: ${fullUrl}`);
    await safeGoto(page, fullUrl, { timeout: 90000 });
    await closeCookiePopup(page);

    // Check if .group-menu-expanded exists (submenu context)
    const hasExpanded = await page.locator(".group-menu-expanded").isVisible().catch(() => false);
    if (hasExpanded) {
      console.log(`${"  ".repeat(depth)}📑 Found expanded submenu section`);
      const submenuLinks = page.locator(".group-menu-expanded > li > a");
      const submenuCount = await submenuLinks.count();
      const submenus = [];

      for (let i = 0; i < submenuCount; i++) {
        const link = submenuLinks.nth(i);
        const submenutext = (await link.innerText().catch(() => "—")).trim();
        let submenuhref = await link.getAttribute("href");
        if (!submenuhref) continue;
        if (submenuhref.startsWith("/")) submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;

        submenus.push({
          submenutext,
          submenuhref,
          type: "submenu",
          submenu: []
        });
      }

      return submenus;
    }

    // Scrape top-level menu
    const topLinks = page.locator("li.nav-item.list-group-item > a.nav-link");
    const topCount = await topLinks.count();
    const allChildrenHrefs = new Set();

    for (let i = 0; i < topCount; i++) {
      const link = topLinks.nth(i);
      const menutext = (await link.innerText().catch(() => "—")).trim();
      let menuhref = await link.getAttribute("href");
      if (!menuhref) continue;
      if (menuhref.startsWith("/")) menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      const isDropdown = await link.evaluate(el => el.classList.contains("dropdown-toggle"));
      const entry = { menutext, menuhref, type: "mainmenu", submenu: [] };

      if (isDropdown && menuhref !== fullUrl) {
        console.log(`${"  ".repeat(depth)}📂 Dropdown found: ${menutext}`);
        console.log(`${"  ".repeat(depth)}➡️ Navigating submenu page: ${menuhref}`);

        const subResult = await scrapeLiveMenuRecursive(page, baseUrl, menuhref, depth + 1);
        entry.submenu = subResult;
        subResult.forEach(child => allChildrenHrefs.add(child.submenuhref));
      }

      result.push(entry);
    }

    // Remove duplicates (if already part of a submenu)
    return result.filter(item => !allChildrenHrefs.has(item.menuhref));

  } catch (err) {
    console.warn(`${"  ".repeat(depth)}❌ Error scraping ${fullUrl}: ${err.message}`);
    return result;
  }
}




// ========================================================
// 🍪 Cookie Popup Handler
// ========================================================
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
        await el.scrollIntoViewIfNeeded();
        await el.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(1000);
        console.log(`🍪 Closed cookie popup with selector: ${sel}`);
        break;
      } catch (err) {
        console.warn(`⚠️ Failed to click cookie close button (${sel}): ${err.message}`);
      }
    }
  }
}

// ========================================================
// 🌐 Safe Navigation
// ========================================================
async function safeGoto(page, url, { timeout = 90000, retries = 2 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🌍 Navigating to: ${url} (Attempt ${attempt}/${retries})`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      await page.waitForLoadState("domcontentloaded");
      return;
    } catch (err) {
      console.warn(`⚠️ Navigation failed (Attempt ${attempt}): ${err.message}`);
      if (attempt === retries) throw err;
      await page.waitForTimeout(3000);
    }
  }
}
