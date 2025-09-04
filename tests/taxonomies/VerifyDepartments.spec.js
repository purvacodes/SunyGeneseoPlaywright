import { createObjects } from '../../pages/ObjectFactory.js';
import { taxonomyUrls } from "../../data/taxonomyUrls.js";
import { test, expect } from '@playwright/test';

test.setTimeout(60 * 1000);
test('Verify Departments Taxonomy Terms', async ({ page }) => {
    const objectFactory = createObjects(page);

    // Collect Drupal taxonomies
    await objectFactory.taxonomy.getDrupalTaxonomies(taxonomyUrls.drupal.departments);
    objectFactory.taxonomy.saveToFile('Departments_drupal.json', objectFactory.taxonomy.drupalTaxonomies);

    // Collect WordPress taxonomies
    await objectFactory.taxonomy.getWordPressTaxonomies(taxonomyUrls.wordPress.departments);
    objectFactory.taxonomy.saveToFile('Departments_wordPress.json', objectFactory.taxonomy.wordPressTaxonomies);

    objectFactory.taxonomy.ValidateTaxonomyComparisonResults();
});