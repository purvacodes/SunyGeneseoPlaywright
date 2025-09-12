import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';

export class Taxonomy {
  constructor(page, drupal, wordPress) {
    this.page = page;
    this.drupal = drupal;
    this.wordPress = wordPress;
    this.drupalTaxonomies = [];
    this.wordPressTaxonomies = [];
    this.drupalDuplicates = [];
  }

  async getDrupalTaxonomies(url) {
    await this.drupal.loginToDrupal();
    await this.page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });

    while (true) {
      const texts = await this.page.locator('.menu-item__link').allTextContents();
      this.drupalTaxonomies.push(...texts.map(t => t.trim()));

      const nextBtn = this.page.getByRole('link', { name: 'Next page' });
      try {
        await this.page.mouse.wheel(0, 2000);
        await nextBtn.waitFor({ state: 'visible', timeout: 2000 });
        await nextBtn.scrollIntoViewIfNeeded();
        await nextBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(1000);
      } catch {
        break; // Exit loop when there is no "Next page"
      }
    }
  }

  async getWordPressTaxonomies(url) {
    await this.wordPress.loginToWordPress();
    await this.page.goto(url, { timeout: 60000 });
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });

    // Increase items per page
    await this.page.getByRole('button', { name: 'Screen Options' }).click();
    const spinButton = this.page.getByRole('spinbutton', { name: 'Number of items per page:' });
    await spinButton.click();
    await spinButton.fill('700');
    await this.page.getByLabel('Screen Options Tab')
      .getByRole('button', { name: 'Apply' })
      .click();

    await this.page.waitForSelector('#wpadminbar', { state: 'visible', timeout: 60000 });
    const texts = await this.page.locator('.row-title').allTextContents();
    this.wordPressTaxonomies.push(...texts.map(t => t.trim()));
  }

  async compareTaxonomies(drupalArr, wpArr, debug = false) {
    //To find exact missing and extra items without normalization
    const missingInWPRaw = drupalArr.filter(d => !wpArr.includes(d));
    const extraInWPRaw = wpArr.filter(w => !drupalArr.includes(w));
    console.log("Missing in WP without normalization", missingInWPRaw);
    console.log("Extra in WP without normalization", extraInWPRaw);

    const normalize = (str) =>
      str.replace(/[“”"']/g, "")
        .replace(/[’‘]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const drupalNormalized = drupalArr.map(normalize);
    const wpNormalized = wpArr.map(normalize);

    const countItems = (arr) =>
      arr.reduce((acc, item) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
      }, {});

    const drupalCounts = countItems(drupalNormalized);
    const wpCounts = countItems(wpNormalized); 
    // Identify duplicates in Drupal 
    this.drupalDuplicates = Object.entries(drupalCounts) 
    .filter(([_, count]) => count > 1) .map(([taxonomy, count]) => ({ taxonomy, count })); 
    console.log("Duplicates in Drupal", this.drupalDuplicates)

    const missingInWP = [];
    const extraInWP = [];

    const allKeys = new Set([...Object.keys(drupalCounts), ...Object.keys(wpCounts)]);

    for (const key of allKeys) {
      const dCount = drupalCounts[key] || 0;
      const wCount = wpCounts[key] || 0;

      if (dCount > wCount) missingInWP.push({ taxonomy: key, count: dCount - wCount });
      if (wCount > dCount) extraInWP.push({ taxonomy: key, count: wCount - dCount });
    }

    return {
      missingInWP,
      extraInWP,
      drupalCounts,
      wpCounts,
      drupalDuplicates: this.drupalDuplicates,
      wpNormalized,
      drupalNormalized
    };
  }

  saveToFile(fileName, data) {
   const folder = path.resolve("test-artifacts", "taxonomies-json");
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    const filePath = path.join(folder, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const count = Array.isArray(data)
      ? data.length
      : typeof data === "object"
        ? Object.keys(data).length
        : 0;

    console.log(`${fileName} written with count:`, count);
  }

  async ValidateTaxonomyComparisonResults() {
    const {
      missingInWP,
      extraInWP,
      drupalCounts,
      wpCounts,
      drupalDuplicates,
      wpNormalized,
      drupalNormalized
    } = await this.compareTaxonomies(this.drupalTaxonomies, this.wordPressTaxonomies);

    console.log('Missing in WP:', missingInWP);
    console.log('Extra in WP:', extraInWP);

    expect(this.drupalTaxonomies.length, 'Drupal taxonomies should not be empty').toBeGreaterThan(0);
    expect(this.wordPressTaxonomies.length, 'WordPress taxonomies should not be empty').toBeGreaterThan(0);


    expect(wpCounts, 'Drupal and WP taxonomy counts must match').toEqual(drupalCounts);
    expect(wpNormalized.sort(), 'Normalized taxonomy names must match').toEqual(drupalNormalized.sort());
    expect(missingInWP.length, 'There should be no missing items in WP').toBe(0);
    expect(extraInWP.length, 'There should be no extra items in WP').toBe(0);

    drupalDuplicates.forEach(({ taxonomy, count: drupalCount }) => {
      const wpCount = wpCounts[taxonomy] || 0;
      expect.soft(wpCount, `Duplicate count for ${taxonomy} should match`).toBe(drupalCount);
    });
  }
  
}
