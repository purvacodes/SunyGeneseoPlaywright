import { Console } from 'console';
import fs from 'fs';

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
    //getByRole('link', { name: '“accountancy” (Edit)' })
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
      } catch (err) {
        break;
      }
    }
  }

  async getwordPressTaxonomies(url) {
    await this.wordPress.loginToWordPress();
    await this.page.goto(url);
    await this.page.getByRole('button', { name: 'Screen Options' }).click();
    await this.page.getByRole('spinbutton', { name: 'Number of items per page:' }).click();
    await this.page.getByRole('spinbutton', { name: 'Number of items per page:' }).fill('700');
    await this.page.getByLabel('Screen Options Tab').getByRole('button', { name: 'Apply' }).click();
    
    await this.page.waitForSelector('#wpadminbar', { state: 'visible', timeout: 60000 });
    const texts = await this.page.locator('.row-title').allTextContents();
    this.wordPressTaxonomies.push(...texts.map(t => t.trim()));
  }

  async compareTaxonomies(drupalArr, wpArr) {
    //To find exact missing and extra items without normalization
    const missingInWPRaw = drupalArr.filter(d => !wpArr.includes(d));
    const extraInWPRaw = wpArr.filter(w => !drupalArr.includes(w));
 
    const normalize = (str) => str.replace(/[“”"']/g, "").replace(/[’‘]/g, "").replace(/\s+/g, " ").trim();
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
      .filter(([_, count]) => count > 1)
      .map(([taxonomy, count]) => ({ taxonomy, count }));
    console.log("Duplicates in Drupal", this.drupalDuplicates)

    const missingInWP = []; const extraInWP = []; const extraInDr = [];

    const allKeys = new Set([...Object.keys(drupalCounts), ...Object.keys(wpCounts)]);

    for (const key of allKeys) {
      const dCount = drupalCounts[key] || 0;
      const wCount = wpCounts[key] || 0;

      if (dCount > wCount) missingInWP.push({ taxonomy: key, count: dCount - wCount });
      if (wCount > dCount) extraInWP.push({ taxonomy: key, count: wCount - dCount });
      if (dCount > wCount) extraInDr.push({ taxonomy: key, count: dCount - wCount });
    }

    return {
      missingInWP, extraInWP, extraInDr, drupalCounts, wpCounts, missingInWP, drupalDuplicates: this.drupalDuplicates,
      wpNormalized,drupalNormalized};

  }

  saveToFile(fileName, data) {
    fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
    console.log(`${fileName} written with count:`, data.length);
  }
}
