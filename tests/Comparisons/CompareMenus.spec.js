import { test, chromium } from '@playwright/test';
import fs from 'fs';

const DEV_URL = 'https://dev-suny-geneseo.pantheonsite.io/great_day/archives/';
const PROD_URL = 'https://www.geneseo.edu/great_day/archives/';

test('Standalone DEV vs PROD Menu Extraction and Comparison', async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  class MenuExtractor {
    constructor(page) {
      this.page = page;
    }

    async detectEnvironment() {
      if (await this.page.locator('h2.subsite-menu-header').count()) return 'dev';
      if (await this.page.locator('div.list-group-item').count()) return 'prod';
      throw new Error('Unknown environment structure');
    }

    // ---------------- DEV ----------------
    async extractDevMenu() {
      await this.page.waitForLoadState('domcontentloaded');
      console.log('🔹 Extracting DEV menu headings...');

      const menuStructure = [];
      const headingLocators = this.page.locator('h2.subsite-menu-header');
      const headingCount = await headingLocators.count();

      for (let i = 0; i < headingCount; i++) {
        const headingEl = headingLocators.nth(i);
        const headingText = (await headingEl.innerText()).trim();
        console.log(`📌 DEV Heading: "${headingText}"`);

        const headingNode = { heading: headingText, menuItems: [] };
        const siblingUl = headingEl.locator('xpath=following-sibling::ul[1]');
        headingNode.menuItems = await this.extractDevMenuItems(siblingUl);

        menuStructure.push(headingNode);
      }

      return menuStructure;
    }

    async extractDevMenuItems(ulLocator) {
      // Updated selector: li.menu-item > div.menu-link-container > a.menu-link.subsite-menu-item
      const itemsLocator = ulLocator.locator('li.menu-item > div.menu-link-container > a.menu-link.subsite-menu-item');
      const count = await itemsLocator.count();
      const menuItems = [];

      for (let i = 0; i < count; i++) {
        const item = itemsLocator.nth(i);
        const text = (await item.locator('span.link-text').innerText()).trim();
        const href = await item.getAttribute('href');
        console.log(`   ➤ Menu Item: "${text}" (${href})`);

        const menuNode = { text, href, subMenu: [] };

        // Detect submenu toggle by presence of dropdown-arrow span inside ancestor li
        const dropdownArrow = item.locator('xpath=ancestor::li//span[contains(@class, "dropdown-arrow")]');
        if (await dropdownArrow.count()) {
          console.log(`     🔽 Found submenu for "${text}", expanding...`);
          await dropdownArrow.first().click();
          // Wait for submenu <ul> that follows the ancestor <li>
          const parentLi = item.locator('xpath=ancestor::li[1]');
          const subUl = parentLi.locator('ul').first();
          await subUl.waitFor({ state: 'visible', timeout: 5000 });
          menuNode.subMenu = await this.extractDevMenuItems(subUl);
        }

        menuItems.push(menuNode);
      }

      return menuItems;
    }

    // ---------------- PROD ----------------
    async extractProdMenu(baseUrl, depth = 0, visitedHrefs = new Set()) {
      await this.page.waitForLoadState('domcontentloaded');

      const menuStructure = [];
      const itemsLocator = this.page.locator('li.nav-item.list-group-item > a.nav-link');
      const count = await itemsLocator.count();

      for (let i = 0; i < count; i++) {
        const item = itemsLocator.nth(i);
        const text = (await item.innerText()).trim();
        const href = await item.getAttribute('href');
        const className = (await item.getAttribute('class')) || '';
        const isDropdown = className.includes('dropdown-toggle');

        console.log(`${'  '.repeat(depth)}📌 PROD Menu Item: "${text}" (${href})`);

        const node = { text, href, subMenu: [] };

        if (isDropdown && href && !visitedHrefs.has(href)) {
          visitedHrefs.add(href);
          console.log(`${'  '.repeat(depth)}🔽 Dropdown detected: "${text}", navigating...`);

          try {
            await Promise.all([
              this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180_000 }),
              item.click(),
            ]);
            await this.page.waitForTimeout(800);

            node.subMenu = await this.extractProdMenu(baseUrl, depth + 1, visitedHrefs);

            // Return to base URL after submenu extraction
            await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
            await this.page.waitForTimeout(800);
          } catch (err) {
            console.warn(`⚠️ Failed submenu "${text}" (${href}): ${err.message}`);
          }
        }

        menuStructure.push(node);
      }

      if (depth === 0) {
        const headings = await this.page.$$eval('div.list-group-item h2 > a', els =>
          els.map(el => el.textContent?.trim()).filter(Boolean)
        );
        headings.forEach(text => {
          console.log(`📌 PROD Heading: "${text}"`);
          menuStructure.unshift({ text, href: null, subMenu: [] });
        });
      }

      return menuStructure;
    }

    // ---------------- Comparison ----------------
    compareMenus(devMenu, prodMenu, path = '') {
      const maxLength = Math.max(devMenu.length, prodMenu.length);

      for (let i = 0; i < maxLength; i++) {
        const devNode = devMenu[i];
        const prodNode = prodMenu[i];
        const currentPath =
          path + (devNode?.text || devNode?.heading || prodNode?.text || prodNode?.heading || `#${i}`) + ' > ';

        if (!devNode) {
          console.log(`❌ PROD extra: ${prodNode.text || prodNode.heading} (${prodNode.href || ''}) at ${currentPath}`);
          continue;
        }
        if (!prodNode) {
          console.log(`❌ DEV extra: ${devNode.text || devNode.heading} (${devNode.href || ''}) at ${currentPath}`);
          continue;
        }

        const devText = devNode.text || devNode.heading;
        const prodText = prodNode.text || prodNode.heading;

        if (devText !== prodText) {
          console.log(`⚠️ Text mismatch at ${currentPath}: DEV="${devText}" PROD="${prodText}"`);
        }

        if ((devNode.href || '') !== (prodNode.href || '')) {
          console.log(`⚠️ Href mismatch at ${currentPath}: DEV="${devNode.href || ''}" PROD="${prodNode.href || ''}"`);
        }

        this.compareMenus(devNode.subMenu || devNode.menuItems || [], prodNode.subMenu || [], currentPath);
      }
    }
  }

  const extractor = new MenuExtractor(page);

  // ---------------------- DEV ----------------------
  console.log('🌱 Navigating to DEV site...');
  await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
  const devEnv = await extractor.detectEnvironment();
  console.log(`🟢 Environment detected: ${devEnv.toUpperCase()}`);

  const devMenu = await extractor.extractDevMenu();
  fs.writeFileSync('dev_menu.json', JSON.stringify(devMenu, null, 2));
  console.log('💾 DEV menu saved to dev_menu.json');

  // ---------------------- PROD ----------------------
  console.log('🌍 Navigating to PROD site...');
  await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });
  const prodEnv = await extractor.detectEnvironment();
  console.log(`🟢 Environment detected: ${prodEnv.toUpperCase()}`);

  const prodMenu = await extractor.extractProdMenu(PROD_URL);
  fs.writeFileSync('prod_menu.json', JSON.stringify(prodMenu, null, 2));
  console.log('💾 PROD menu saved to prod_menu.json');

  // ---------------------- Comparison ----------------------
  console.log('🔎 Comparing DEV and PROD menus...');
  extractor.compareMenus(devMenu, prodMenu);
  console.log('✅ Menu extraction and comparison completed.');

  await browser.close();
});
