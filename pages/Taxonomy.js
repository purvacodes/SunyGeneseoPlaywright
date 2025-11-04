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

  // ----------------------------------------
  // 🧩 Fetch Drupal Taxonomies
  // ----------------------------------------
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

  // ----------------------------------------
  // 🧩 Fetch WordPress Taxonomies
  // ----------------------------------------
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

  // ----------------------------------------
  // 🧮 Compare Drupal vs WordPress Taxonomies
  // ----------------------------------------
  async compareTaxonomies(drupalArr, wpArr, debug = false) {
    // Find exact missing and extra items (no normalization)
    const missingInWPRaw = drupalArr.filter(d => !wpArr.includes(d));
    const extraInWPRaw = wpArr.filter(w => !drupalArr.includes(w));
    if (debug) {
      console.log("Missing in WP (raw):", missingInWPRaw);
      console.log("Extra in WP (raw):", extraInWPRaw);
    }

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

    // Find duplicates in Drupal
    this.drupalDuplicates = Object.entries(drupalCounts)
      .filter(([_, count]) => count > 1)
      .map(([taxonomy, count]) => ({ taxonomy, count }));

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

  // ----------------------------------------
  // 💾 Save Any Data to JSON
  // ----------------------------------------
  saveToFile(fileName, data) {
    const folder = path.resolve("test-artifacts", "taxonomies-json");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const filePath = path.join(folder, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const count = Array.isArray(data)
      ? data.length
      : typeof data === "object"
        ? Object.keys(data).length
        : 0;

    console.log(`${fileName} written with count:`, count);
  }

  // ----------------------------------------
  // 🧠 Validate Taxonomy Comparison + Quality
  // ----------------------------------------
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

    // Run content quality & formatting diff checks
    const qualityReport = await this.validateTaxonomyQualityForBoth(
      this.drupalTaxonomies,
      this.wordPressTaxonomies
    );

    // Build full report JSON
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        drupalCount: this.drupalTaxonomies.length,
        wpCount: this.wordPressTaxonomies.length,
        missingInWPCount: missingInWP.length,
        extraInWPCount: extraInWP.length,
        duplicateCount: drupalDuplicates.length,
      },
      comparison: {
        missingInWP,
        extraInWP,
        duplicates: drupalDuplicates,
      },
      quality: qualityReport
    };

    // Save JSON report
    const folder = path.resolve("test-artifacts", "taxonomies-json");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, `TaxonomyValidationReport_${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`📁 JSON report saved at: ${filePath}`);

    // // Keep old Playwright checks
    // expect(this.drupalTaxonomies.length, 'Drupal taxonomies should not be empty').toBeGreaterThan(0);
    // expect(this.wordPressTaxonomies.length, 'WordPress taxonomies should not be empty').toBeGreaterThan(0);
    // expect(wpCounts, 'Drupal and WP taxonomy counts must match').toEqual(drupalCounts);
    // expect(wpNormalized.sort(), 'Normalized taxonomy names must match').toEqual(drupalNormalized.sort());
    // expect(missingInWP.length, 'There should be no missing items in WP').toBe(0);
    // expect(extraInWP.length, 'There should be no extra items in WP').toBe(0);

    // drupalDuplicates.forEach(({ taxonomy, count: drupalCount }) => {
    //   const wpCount = wpCounts[taxonomy] || 0;
    //   expect.soft(wpCount, `Duplicate count for ${taxonomy} should match`).toBe(drupalCount);
    // });
  }

  // ----------------------------------------
  // 🧹 Content Quality & Formatting Diff Checks
  // ----------------------------------------
  async validateTaxonomyQualityForBoth(drupalTaxonomies, wpTaxonomies) {
    const analyze = (list, source) => {
      const normalizePunctuation = (str) =>
        str
          .replace(/[‘’]/g, "'")
          .replace(/[“”]/g, '"')
          .replace(/–|—/g, "-")
          .replace(/\s+/g, " ")
          .trim();

      const titleCaseIssues = [];
      const punctuationIssues = [];
      const commaSeparated = [];
      const sentenceLike = [];

      for (const term of list) {
        const clean = normalizePunctuation(term);

        // 1️⃣ Title Case consistency
        const titleCased = clean
          .split(" ")
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        if (clean !== titleCased)
          titleCaseIssues.push({ term, suggested: titleCased });

        // 2️⃣ Punctuation normalization
        if (term !== clean)
          punctuationIssues.push({ term, suggested: clean });

        // 3️⃣ Comma-separated multiple items
        if (term.includes(","))
          commaSeparated.push({
            term,
            suggestedSplit: term.split(",").map(t => t.trim()),
          });

        // 4️⃣ Overly long or sentence-like terms
        if (term.split(" ").length > 8 || term.endsWith("."))
          sentenceLike.push(term);
      }

      return {
        source,
        titleCaseIssues,
        punctuationIssues,
        commaSeparated,
        sentenceLike
      };
    };

    const drupalReport = analyze(drupalTaxonomies, "Drupal");
    const wpReport = analyze(wpTaxonomies, "WordPress");

    // Detect cross-system formatting differences
    const formattingDiffs = [];
    for (const dTerm of drupalTaxonomies) {
      const wpMatch = wpTaxonomies.find(
        (w) =>
          w.toLowerCase().replace(/[“”‘’"']/g, "") ===
          dTerm.toLowerCase().replace(/[“”‘’"']/g, "")
      );
      if (wpMatch && wpMatch !== dTerm) {
        formattingDiffs.push({ drupal: dTerm, wordpress: wpMatch });
      }
    }

    return { drupalReport, wpReport, formattingDiffs };
  }
}
