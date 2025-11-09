import { test } from "@playwright/test";
import { chromium } from "playwright";
import { createObjects } from "../../pages/ObjectFactory.js";

test.setTimeout(15 * 60 * 60 * 1000); // 15 hours

test("📊 Scrape Menus from Live and Dev", async () => {
  const liveBase = "https://www.geneseo.edu/";
  const devBase = "https://dev-suny-geneseo.pantheonsite.io/";
  const excelInput = "basic_page.xlsx";
  const liveOutput = "live_menu.xlsx";
  const devOutput = "dev_menu.xlsx";

  console.log(`\n📥 Loading URLs from: ${excelInput}`);
  const tempBrowser = await chromium.launch();
  const tempPage = await tempBrowser.newPage();
  const finalFactory = createObjects(tempPage, tempBrowser);
  const extractedUrls = await finalFactory.utility.loadUrlswithCPT(excelInput);
  await tempBrowser.close();

  console.log(`📄 Total URLs to process: ${extractedUrls.length}\n`);

  // LIVE
  console.log("🌐 Collecting menu data from LIVE site...");
  const liveResults = await collectMenus("LIVE", liveBase, extractedUrls);
  await finalFactory.utility.saveToExcel(liveOutput, "LiveMenu", liveResults, "comparison");

  // DEV
  console.log("🖥️ Collecting menu data from DEV site...");
  const devResults = await collectMenus("DEV", devBase, extractedUrls);
  await finalFactory.utility.saveToExcel(devOutput, "DevMenu", devResults, "comparison");

  console.log(`✅ Menu scraping complete!`);
});

// ========================================================
// 📘 Collect Menu Data
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
      await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForLoadState("domcontentloaded");

      // 🟦 Scrape H2 Header
      const headerText = await page.locator('h2.subsite-menu-header').first().innerText().catch(() => "—");

      // 🟦 Scrape Menu Items
      const items = page.locator('li.menu-item a.menu-link.subsite-menu-item');
      const itemCount = await items.count();

      for (let i = 0; i < itemCount; i++) {
        const item = items.nth(i);
        const text = await item.locator('span.link-text').innerText().catch(() => "—");
        let href = await item.getAttribute('href');
        if (href && href.startsWith("/")) href = `${baseUrl.replace(/\/+$/, "")}${href}`;

        // 🟦 Scrape Submenu Items
        const parentLi = item.locator('..').locator('..');
        const subLinks = parentLi.locator('ul.sub-menu li.submenu-item a.menu-link.subsite-menu-item');
        const subCount = await subLinks.count();
        const subItems = [];
        for (let j = 0; j < subCount; j++) {
          const subText = await subLinks.nth(j).locator('span.link-text').innerText().catch(() => "—");
          let subHref = await subLinks.nth(j).getAttribute('href');
          if (subHref && subHref.startsWith("/")) subHref = `${baseUrl.replace(/\/+$/, "")}${subHref}`;
          subItems.push({ subText, subHref });
        }

        menuData.push({ text, href, subItems });
      }

      results.push({ CPT: cpt, slug: cleanSlug, url: fullUrl, header: headerText, menu: menuData });
    } catch (err) {
      status = `Error: ${err.message}`;
      results.push({ CPT: cpt, slug: cleanSlug, url: fullUrl, header: "—", menu: [], status });
    }

    count++;
    if (count % 10 === 0) console.log(`⏳ [${envName}] ${count}/${urls.length} processed`);
  }

  console.log(`✅ [${envName}] Finished ${count}/${urls.length}`);
  await browser.close();
  return results;
}
