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

    const pageDiffs = compareMenus(livePage.menu || [], devPage.menu || [], livePage.slug);
    diffs.push(...pageDiffs);
  }

  return diffs;
}

function textOrEmpty(v) {
  return typeof v === "string" ? v : (v?.toString?.() || "");
}

function getChildren(node) {
  // Support different naming conventions used previously
  return node?.submenu || node?.submenuItems || node?.children || [];
}

function compareMenus(liveArr, devArr, path = "") {
  const diffs = [];
  const len = Math.max(liveArr.length, devArr.length);

  for (let i = 0; i < len; i++) {
    const L = liveArr[i];
    const D = devArr[i];

    const Ltext = textOrEmpty(L?.menutext || L?.submenutext || "");
    const Dtext = textOrEmpty(D?.menutext || D?.submenutext || "");
    const current = path + " > " + (Ltext || Dtext || "");

    if (!L) {
      diffs.push({ Type: "Missing in LIVE", LIVE: "", DEV: Dtext, Details: current });
      continue;
    }

    if (!D) {
      diffs.push({ Type: "Missing in DEV", LIVE: Ltext, DEV: "", Details: current });
      continue;
    }

    // Determine whether either side is a header
    const isHeader = (node) => node?.type === "header";

    if (Ltext !== Dtext) {
      const type = (isHeader(L) || isHeader(D)) ? "Heading Mismatch" : "Text Mismatch";
      diffs.push({ Type: type, LIVE: Ltext, DEV: Dtext, Details: current });
    }

    const Lhref = textOrEmpty(L?.menuhref || L?.menuHref || L?.href || "");
    const Dhref = textOrEmpty(D?.menuhref || D?.menuHref || D?.href || "");
    if (Lhref !== Dhref) {
      diffs.push({ Type: "Href Mismatch", LIVE: Lhref, DEV: Dhref, Details: current });
    }

    // SUBMENU LEVEL 1
    const Lchildren = getChildren(L) || [];
    const Dchildren = getChildren(D) || [];
    diffs.push(...compareSubItems(Lchildren, Dchildren, current));
  }

  return diffs;
}

function compareSubItems(liveSub, devSub, path) {
  const diffs = [];
  liveSub = liveSub || [];
  devSub = devSub || [];

  const len = Math.max(liveSub.length, devSub.length);

  for (let i = 0; i < len; i++) {
    const L = liveSub[i];
    const D = devSub[i];

    const Ltext = textOrEmpty(L?.submenutext || L?.menutext || "");
    const Dtext = textOrEmpty(D?.submenutext || D?.menutext || "");
    const current = path + " > " + (Ltext || Dtext || "");

    if (!L) {
      diffs.push({ Type: "Missing in LIVE", LIVE: "", DEV: Dtext, Details: current });
      continue;
    }

    if (!D) {
      diffs.push({ Type: "Missing in DEV", LIVE: Ltext, DEV: "", Details: current });
      continue;
    }

    if (Ltext !== Dtext)
      diffs.push({ Type: "Text Mismatch", LIVE: Ltext, DEV: Dtext, Details: current });

    const Lhref = textOrEmpty(L?.submenuhref || L?.menuhref || L?.href || "");
    const Dhref = textOrEmpty(D?.submenuhref || D?.menuhref || D?.href || "");
    if (Lhref !== Dhref)
      diffs.push({ Type: "Href Mismatch", LIVE: Lhref, DEV: Dhref, Details: current });

    // nested submenu
    const Lnested = L?.nestedsubmenuItems || L?.nested || L?.submenu || [];
    const Dnested = D?.nestedsubmenuItems || D?.nested || D?.submenu || [];
    diffs.push(...compareNestedItems(Lnested, Dnested, current));
  }

  return diffs;
}

function compareNestedItems(LN = [], DN = [], path) {
  const diffs = [];
  const len = Math.max(LN.length, DN.length);

  for (let i = 0; i < len; i++) {
    const L = LN[i];
    const D = DN[i];

    const Ltext = textOrEmpty(L?.nestedmenutext || L?.menutext || "");
    const Dtext = textOrEmpty(D?.nestedmenutext || D?.menutext || "");
    const current = path + " > " + (Ltext || Dtext || "");

    if (!L) {
      diffs.push({ Type: "Missing in LIVE", LIVE: "", DEV: Dtext, Details: current });
      continue;
    }

    if (!D) {
      diffs.push({ Type: "Missing in DEV", LIVE: Ltext, DEV: "", Details: current });
      continue;
    }

    if (Ltext !== Dtext)
      diffs.push({ Type: "Text Mismatch", LIVE: Ltext, DEV: Dtext, Details: current });

    const Lhref = textOrEmpty(L?.nestedmenuhref || L?.href || "");
    const Dhref = textOrEmpty(D?.nestedmenuhref || D?.href || "");
    if (Lhref !== Dhref)
      diffs.push({ Type: "Href Mismatch", LIVE: Lhref, DEV: Dhref, Details: current });
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
        const ok = await hasDevMenu(page);
        if (!ok) {
          console.log("❌ DEV: No valid menu — skipping scrape");
          menuStatus = "INVALID OR NO MENU";
          menuData = [];
        } else {
          console.log("✅ DEV: Menu found — scraping...");
          menuStatus = "VALID MENU";
          menuData = await scrapeDevMenu(page, baseUrl);
        }
      }

      results.push({
        CPT: cpt,
        slug: cleanSlug,
        url: fullUrl,
        menuStatus,   // ← added
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



// ========================================================
// 🧭 DEV MENU SCRAPER (handles multiple dropdowns)
// ========================================================
async function scrapeDevMenu(page, baseUrl) {
  console.log(`\n🖥️ Scraping DEV: ${page.url()}`);

  const menuData = [];
  const visitedSubmenuHrefs = new Set();

  // ----- Add DEV global heading (at top) if present -----
  const devGlobalHeading = await page.locator("div.menu-header h2.subsite-menu-header span").innerText().catch(() => "");
  if (devGlobalHeading) {
    menuData.push({
      menutext: devGlobalHeading.trim(),
      menuhref: "",
      type: "header",
      submenu: []
    });
    console.log(`📌 DEV Heading Found: ${devGlobalHeading}`);
  }

  // Existing header blocks (if present)
  const headers = page.locator("h2.subsite-menu-header");
  const headerCount = await headers.count().catch(() => 0);

  console.log(`🔹 Found ${headerCount} menu headers (subsite-menu-header).`);

  for (let i = 0; i < headerCount; i++) {
    const headerText = await headers.nth(i).innerText().catch(() => "—");
    console.log(`📂 Header: ${headerText}`);

    // push header as a header item (keeps it visible in comparison)
    menuData.push({
      menutext: headerText,
      menuhref: "",
      type: "header",
      submenu: []
    });

    const items = page.locator("li.menu-item a.menu-link.subsite-menu-item");
    const itemCount = await items.count().catch(() => 0);

    console.log(`   🔸 Found ${itemCount} top-level menu items under this header.`);

    for (let j = 0; j < itemCount; j++) {
      const item = items.nth(j);

      const parentLi = item.locator("..").locator("..");

      const isInsideSubmenu =
        (await item.locator("xpath=ancestor::ul[contains(@class,'sub-menu')]").count()) > 0;

      // keep your rule exactly
      if (isInsideSubmenu) continue;

      const menutext = await item.locator("span.link-text").innerText().catch(() => "—");
      let menuhref = await item.getAttribute("href");
      if (menuhref?.startsWith("/"))
        menuhref = `${baseUrl.replace(/\/+$/, "")}${menuhref}`;

      console.log(`   🔹 Menu: ${menutext}  →  ${menuhref}`);

      const arrow = parentLi.locator("span.dropdown-arrow");
      const arrowCount = await arrow.count().catch(() => 0);

      const submenu = [];

      if (arrowCount > 0) {
        console.log(`      📦 Dropdown detected (${arrowCount} arrow(s)) for "${menutext}"`);

        for (let a = 0; a < arrowCount; a++) {
          const thisArrow = arrow.nth(a);

          // ensure arrow belongs to THIS menu item only
          const arrowLi = await thisArrow.evaluateHandle(el => el.closest("li"));

          const isDirectArrow = await parentLi.evaluate(
            (li, arrowLi) => li === arrowLi,
            arrowLi
          );

          if (!isDirectArrow) continue; // skip child submenu arrows

          if (await thisArrow.isVisible()) {
            await thisArrow.scrollIntoViewIfNeeded();
            await thisArrow.click({ force: true });
            await page.waitForTimeout(300);

            const subLinks = parentLi.locator(
              "> ul.sub-menu li.submenu-item a.menu-link.subsite-menu-item"
            );
            const subCount = await subLinks.count().catch(() => 0);

            console.log(`         🔸 Found ${subCount} submenu items under "${menutext}"`);

            for (let k = 0; k < subCount; k++) {
              const subLink = subLinks.nth(k);
              const submenutext = await subLink.locator("span.link-text").innerText().catch(() => "—");
              let submenuhref = await subLink.getAttribute("href");

              if (submenuhref?.startsWith("/"))
                submenuhref = `${baseUrl.replace(/\/+$/, "")}${submenuhref}`;

              console.log(`            ↳ Submenu: ${submenutext}  →  ${submenuhref}`);

              submenu.push({
                submenutext,
                submenuhref,
                type: "submenu",
                submenu: []
              });

              visitedSubmenuHrefs.add(submenuhref);
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

  // If no subsite-menu-header blocks found, attempt to collect standard top-level menu items
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

  const filteredMenu = menuData.filter(item => !visitedSubmenuHrefs.has(item.menuhref));

  console.log(`\n✅ DEV scraping complete.`);
  console.log(`📊 Final menu count: ${filteredMenu.length}`);

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

    // ------------------------------
    // LIVE global heading (insert at top)
    // ------------------------------
    const liveHeading = await page.locator("div.list-group-item h2").innerText().catch(() => "");
    if (liveHeading) {
      result.push({
        menutext: liveHeading.trim(),
        menuhref: "",
        type: "header",
        submenu: []
      });
      console.log(`📌 LIVE Heading Found: ${liveHeading}`);
    }

    // ------------------------------
    // GET TOP-LEVEL MENU ITEMS
    // ------------------------------
    const menuItems = page.locator("li.nav-item.list-group-item > a.nav-link:not(.sub-menu-link)");
    const count = await menuItems.count().catch(() => 0);

    console.log(`🔹 Found ${count} top-level menu items.`);

    const toggleQueue = [];

    // ------------------------------
    // PASS 1 — READ TOP-LEVEL
    // ------------------------------
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

      const entry = {
        menutext,
        menuhref,
        type: "mainmenu",
        submenu: []
      };

      // Case: submenu already visible on same page
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

          entry.submenu.push({
            submenutext,
            submenuhref,
            type: "submenu"
          });

          allSubmenuHrefs.add(submenuhref);
        }
      }

      // Case: dropdown toggle, submenu loads on navigation
      else if (isDropdown) {
        toggleQueue.push({ menutext, menuhref });
      }

      result.push(entry);
    }

    console.log(`📦 LIVE toggleQueue (${toggleQueue.length}):`);
    console.log(toggleQueue);

    // ------------------------------
    // PASS 2 — VISIT DROPDOWN PAGES
    // ------------------------------
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

          submenuArr.push({
            submenutext,
            submenuhref,
            type: "submenu"
          });

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

    // --------------------------------
    // CLEANUP — REMOVE DUPLICATE MAIN ITEMS
    // --------------------------------
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

  const container = page.locator(".wp-block-group.subsiteNav");
  const exists = await container.count();

  if (!exists) {
    console.log(`❌ DEV: subsiteNav NOT FOUND → ${current}`);
    return false;
  }

  const realMenu = await container.locator(".wp-block-create-block-custom-menu-block").count();

  if (realMenu > 0) {
    console.log(`✅ DEV: REAL MENU FOUND → ${current}`);
    return true;
  }

  // otherwise get text
  const rawText = await container.evaluate(el => el.textContent || "");
  const cleaned = rawText.trim();

  console.log(`📌 DEV subsiteNav Raw Text: ${JSON.stringify(cleaned)} → ${current}`);

  if (cleaned.length > 0) {
    console.log(`❌ DEV: INVALID MENU (text found) → ${current}`);
    return false;
  }

  console.log(`❓ DEV: EMPTY MENU BLOCK → ${current}`);
  return false;
}

