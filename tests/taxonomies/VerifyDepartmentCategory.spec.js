import { createObjects } from '../../pages/ObjectFactory.js';
import { taxonomyUrls } from "../../data/taxonomyUrls.js";
import { test, expect } from '@playwright/test';

test.setTimeout(60 * 1000);
test('Verify Department Category Taxonomy Terms', async ({ page }) => {
    const objectFactory = createObjects(page);

    // Collect Drupal taxonomies
    await objectFactory.taxonomy.getDrupalTaxonomies(taxonomyUrls.drupal.departmentCategory);
    objectFactory.taxonomy.saveToFile('DepartmentCategory_drupal.json', objectFactory.taxonomy.drupalTaxonomies);

    // Collect WordPress taxonomies
    await objectFactory.taxonomy.getWordPressTaxonomies(taxonomyUrls.wordPress.departmentCategory);
    objectFactory.taxonomy.saveToFile('DepartmentCategory_wordPress.json', objectFactory.taxonomy.wordPressTaxonomies);

    objectFactory.taxonomy.ValidateTaxonomyComparisonResults();
});