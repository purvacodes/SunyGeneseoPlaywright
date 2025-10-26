import { createObjects } from '../../pages/ObjectFactory.js';
import { taxonomyUrls } from "../../data/taxonomyUrls.js";
import { test, expect } from '@playwright/test';

test.setTimeout(6 * 60 * 60 * 1000); // 6 hours max

test('Scrape all WP pages (with pagination)', async ({ page }) => {
  // --- LOGIN ---
  await page.goto('https://palegoldenrod-ant-677872.hostingersite.com/wp-admin/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Username or Email Address' }).fill('amit.kaushal@infostride.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('Login@123');
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForSelector('#wpadminbar', { state: 'visible' });

  // --- GO TO PAGES LIST ---
  //await page.goto('https://palegoldenrod-ant-677872.hostingersite.com/wp-admin/edit.php?post_type=page', { waitUntil: 'domcontentloaded' });
  await page.goto('https://palegoldenrod-ant-677872.hostingersite.com/wp-admin/edit.php?post_type=page&paged=4', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wpadminbar', { state: 'visible' });

  // // --- OPTIONAL: Set items per page to 999 ---
  // await page.getByRole('button', { name: 'Screen Options' }).click();
  // await page.getByRole('spinbutton', { name: 'Number of items per page:' }).fill('999');
  // await page.locator('#screen-options-apply').click();
  // await page.waitForLoadState('networkidle');

  // --- SCRAPE LOOP WITH PAGINATION ---
  let pageNumber = 1;
  while (true) {
    console.log(`\n📄 Scraping page ${pageNumber}...`);

    const rows = page.locator('.row-title');
    const count = await rows.count();
    console.log(`Found ${count} rows on page ${pageNumber}`);

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await row.hover();

      const viewLink = row.locator('xpath=ancestor::td//div[contains(@class,"row-actions")]//a[contains(text(),"View")]');

      if (await viewLink.count()) {
        const url = await viewLink.first().getAttribute('href');
        const title = (await row.innerText()).trim();
       // console.log(`→ "${title}": ${url}`);
        console.log(url);
      } else {
        console.log(`⚠️ No "View" link found for: ${await row.innerText()}`);
      }
    }

    // --- PAGINATION HANDLING ---
    const nextButton = page.locator('.next-page.button').first();

    if (await nextButton.isDisabled()) {
      console.log("✅ Reached last page, scraping complete.");
      break;
    }

    // Track the number of rows before clicking "Next"
    const previousCount = count;

    await Promise.all([
      nextButton.click(),
      page.waitForFunction(
        (prev) => document.querySelectorAll('tbody#the-list tr').length !== prev,
        previousCount,
        { timeout: 30000 }
      )
    ]);
  await page.waitForSelector('#wpadminbar', { state: 'visible' });
    pageNumber++;
  }
});