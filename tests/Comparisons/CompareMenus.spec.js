// tests/menu-xpath.spec.js
import { test } from '@playwright/test';
import fs from 'fs';

const DEV_URL = 'https://dev-suny-geneseo.pantheonsite.io/great_day/archives/';
const PROD_URL = 'https://www.geneseo.edu/great_day/archives/';

class MenuExtractor {
  constructor(page) {
    this.page = page;
  }

  // Detect environment
  async detectEnv() {
    if (await this.page.locator('//h2[contains(@class,"subsite-menu-header")]').count()) return 'dev';
    if (await this.page.locator('//div[contains(@class,"list-group-item")]').count()) return 'prod';
    throw new Error('Unknown environment structure');
  }

  // ----- DEV: Recursive extraction (inline only) -----
  async extractDevMenu() {
    await this.page.waitForLoadState('domcontentloaded');
    const structure = [];
    const headings = this.page.locator('//h2[contains(@class,"subsite-menu-header")]');
    const headingCount = await headings.count();

    for (let h = 0; h < headingCount; h++) {
      const headingText = (await headings.nth(h).innerText()).trim();
      const headingNode = { heading: headingText, menuItems: [] };

      // Locate first UL sibling after heading
      const ulSibling = this.page.locator(`//h2[contains(@class,"subsite-menu-header")][${h + 1}]/following-sibling::ul[1]`);
      headingNode.menuItems = await this.extractDevMenuItems(ulSibling);

      structure.push(headingNode);
    }

    return structure;
  }

async extractDevMenuItems(ulLocator) {
  // Use XPath selector explicitly
  const items = ulLocator.locator('xpath=./li[contains(@class,"menu-item")]/a[contains(@class,"menu-link subsite-menu-item")]');
  const count = await items.count();
  const result = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const text = (await item.locator('xpath=.//span[contains(@class,"link-text")]').innerText()).trim();
    const href = await item.getAttribute('href');
    const node = { text, href, subMenu: [] };

    const toggle = item.locator('xpath=.//ancestor::li//span[contains(@class,"dropdown-arrow")]');
    if (await toggle.count()) {
      await toggle.click();
      const subUl = item.locator('xpath=.//following-sibling::ul[1]');
      await subUl.waitFor({ state: 'visible', timeout: 5000 });
      node.subMenu = await this.extractDevMenuItems(subUl); // recursive
    }

    result.push(node);
  }

  return result;
}

  // ----- PROD: Only navigate for submenu links -----
async extractProdMenu(baseUrl, depth = 0, visited = new Set()) {
  await this.page.waitForLoadState('domcontentloaded');
  const structure = [];

  // Use locator (not element handles) to stay live
  const items = this.page.locator('//li[contains(@class,"nav-item") and contains(@class,"list-group-item")]/a[contains(@class,"nav-link")]');
  const count = await items.count();

  for (let i = 0; i < count; i++) {
    // Get text/href safely before any navigation
    const item = items.nth(i);
    const text = (await item.innerText()).trim();
    const href = await item.getAttribute('href');
    const className = (await item.getAttribute('class')) || '';
    const isToggle = className.includes('dropdown-toggle');

    const node = { text, href, subMenu: [] };

    if (isToggle && href && !visited.has(href)) {
      visited.add(href);
      console.log(`${'  '.repeat(depth)}➡️ Navigating to submenu: ${text} (${href})`);

      try {
        // Navigation should come *after* reading attributes
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180_000 }),
          item.click(),
        ]);
        await this.page.waitForTimeout(800);

        // After navigation, do NOT reuse old item handles — re-run query
        node.subMenu = await this.extractProdMenu(href, depth + 1, visited);

        // Go back to parent page
        await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
        await this.page.waitForTimeout(800);
      } catch (err) {
        console.warn(`⚠️ Failed submenu "${text}" (${href}): ${err.message}`);
      }
    }

    structure.push(node);
  }

  if (depth === 0) {
    const headings = await this.page.$$eval('//div[contains(@class,"list-group-item")]', els =>
      els.map(el => el.textContent?.trim()).filter(Boolean)
    );
    headings.forEach(text => structure.unshift({ text, href: null, subMenu: [] }));
  }

  return structure;
}


  // Compare menus
  compareMenus(dev, prod, path = '') {
    const maxLen = Math.max(dev.length, prod.length);

    for (let i = 0; i < maxLen; i++) {
      const devNode = dev[i];
      const prodNode = prod[i];
      const currentPath = path + (devNode?.text || devNode?.heading || prodNode?.text || prodNode?.heading || `#${i}`) + ' > ';

      if (!devNode) {
        console.log(`❌ PROD extra: ${prodNode.text || prodNode.heading} (${prodNode.href || ''}) at ${currentPath}`);
        continue;
      }
      if (!prodNode) {
        console.log(`❌ DEV extra: ${devNode.text || devNode.heading} (${devNode.href || ''}) at ${currentPath}`);
        continue;
      }

      if ((devNode.text || devNode.heading) !== (prodNode.text || prodNode.heading)) {
        console.log(`⚠️ Text mismatch at ${currentPath}: DEV="${devNode.text || devNode.heading}" PROD="${prodNode.text || prodNode.heading}"`);
      }
      if ((devNode.href || '') !== (prodNode.href || '')) {
        console.log(`⚠️ Href mismatch at ${currentPath}: DEV="${devNode.href || ''}" PROD="${prodNode.href || ''}"`);
      }

      this.compareMenus(devNode.subMenu || devNode.menuItems || [], prodNode.subMenu || [], currentPath);
    }
  }
}

// --------- Playwright Test ---------
test.describe('Menu extraction and comparison with XPath', () => {
  test('DEV and PROD menu recursive extraction & comparison', async ({ page }) => {
    const extractor = new MenuExtractor(page);

    console.log('🌱 Extracting DEV menu...');
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const envDev = await extractor.detectEnv();
    const devMenu = await extractor.extractDevMenu();
    fs.writeFileSync('dev_menu.json', JSON.stringify(devMenu, null, 2));

    console.log('🌍 Extracting PROD menu...');
    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const envProd = await extractor.detectEnv();
    const prodMenu = await extractor.extractProdMenu(PROD_URL);
    fs.writeFileSync('prod_menu.json', JSON.stringify(prodMenu, null, 2));

    console.log('🔎 Comparing DEV vs PROD menus:');
    extractor.compareMenus(devMenu, prodMenu);
    console.log('✅ Extraction and comparison complete.');
  });
});
