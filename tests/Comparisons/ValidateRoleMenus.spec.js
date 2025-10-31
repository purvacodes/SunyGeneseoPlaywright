import { test } from '@playwright/test';
import { createObjects } from '../../pages/ObjectFactory.js';
import { credentials } from "../../data/credentials.js";

test.setTimeout(60 * 60 * 1000);

test('Compare WP Role Menu Mapper with Drupal Groups', async ({ page }) => {
  const objectFactory = createObjects(page);

  // ---- STEP 1: Login to WP ----
  await page.goto("http://localhost/test/wp-admin/", {
    timeout: 60000,
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('textbox', { name: 'Username' }).fill("amit.kaushal@infostride.com");
  await page.getByRole('textbox', { name: 'Password' }).fill("Login@123");
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('#wpadminbar', { state: 'visible' });

  await page.goto("http://localhost/test/wp-admin/nav-menus.php", {
    timeout: 60000,
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.manage-menus');

  // ---- Extract WP Menu Options ----
  const optionTexts = await page.$$eval('#select-menu-to-edit option', options =>
    options.map(opt => opt.textContent.trim())
  );

  console.log('🎯 Extracted WordPress Menu Options:');
 // optionTexts.forEach((text, index) => console.log(`${index + 1}. ${text}`));
 optionTexts.forEach((text) => console.log(text));

  // ---- STEP 2: Login to Drupal ----
  await page.goto(credentials.drupal.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Username" }).fill(credentials.drupal.username);
  await page.getByRole("textbox", { name: "Password" }).fill(credentials.drupal.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForSelector('#toolbar-bar', { state: 'visible', timeout: 50000 });

  // ---- STEP 3: Go to Drupal Menu ----
  await page.goto("http://geneseo-drupal.ddev.site:33000/admin/structure/menu", {
    timeout: 60000,
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.local-actions');

  // ---- Extract menu titles from all pages ----
  const allTitles = [];

  while (true) {
    // Use CSS selector, not XPath
    const titles = await page.$$eval('td.menu-label', nodes =>
      nodes.map(n => n.textContent.trim())
    );
    allTitles.push(...titles);

    const nextBtn = page.getByRole('link', { name: 'Next page' });
    try {
      await nextBtn.waitFor({ state: 'visible', timeout: 2000 });
      await nextBtn.scrollIntoViewIfNeeded();
      await nextBtn.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);
    } catch {
      break; // Stop when no Next page button
    }
  }

  console.log('📋 Extracted Drupal Menu Titles:');
  //allTitles.forEach((t, i) => console.log(`${i + 1}. ${t}`));
  allTitles.forEach((t) => console.log(t));
});
