import { createObjects } from '../../pages/ObjectFactory.js';
import { taxonomyUrls } from "../../data/taxonomyUrls.js";
import { test, expect } from '@playwright/test';

test.setTimeout(60 * 1000);
test('Verify News Tag Taxonomy Terms', async ({ page }) => {
    const objectFactory = createObjects(page);

    // Collect Drupal taxonomies
    await objectFactory.taxonomy.getDrupalTaxonomies(taxonomyUrls.drupal.newsTags);
    objectFactory.taxonomy.saveToFile('NewsTags_drupal.json', objectFactory.taxonomy.drupalTaxonomies);

    // Collect WordPress taxonomies
    await objectFactory.taxonomy.getWordPressTaxonomies(taxonomyUrls.wordPress.newsTags);
    objectFactory.taxonomy.saveToFile('NewsTags_wordPress.json', objectFactory.taxonomy.wordPressTaxonomies);

    objectFactory.taxonomy.ValidateTaxonomyComparisonResults();
});