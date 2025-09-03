import { createObjects } from '../../pages/ObjectFactory.js';
import { taxonomyUrls } from "../../data/taxonomyUrls.js";
import { test, expect } from '@playwright/test';

test('Verify Academic Program Keywords Taxonomy', async ({ page }) => {
    const objectFactory = createObjects(page);

    // Collect Drupal taxonomies
    await objectFactory.taxonomy.getDrupalTaxonomies(taxonomyUrls.drupal.academicProgramKeywords);
    objectFactory.taxonomy.saveToFile('drupalAcademicProgramKeywords.json', objectFactory.taxonomy.drupalTaxonomies);

    // Collect WordPress taxonomies
    await objectFactory.taxonomy.getwordPressTaxonomies(taxonomyUrls.wordPress.academicProgramKeywords);
    objectFactory.taxonomy.saveToFile('wordPressAcademicProgramKeywords.json', objectFactory.taxonomy.wordPressTaxonomies);

    const {
        missingInWP,
        extraInWP,
        drupalCounts,
        wpCounts,
        drupalDuplicates,
        wpNormalized,
        drupalNormalized
    } = await objectFactory.taxonomy.compareTaxonomies(
        objectFactory.taxonomy.drupalTaxonomies,
        objectFactory.taxonomy.wordPressTaxonomies
    );
    console.log('Missing in WP:', missingInWP);
    console.log('Extra in WP:', extraInWP);

    expect(objectFactory.taxonomy.drupalTaxonomies.length, 'Drupal taxonomies array should not be empty').toBeGreaterThan(0);
    expect(objectFactory.taxonomy.wordPressTaxonomies.length, 'WordPress taxonomies array should not be empty').toBeGreaterThan(0);

    expect.soft(wpNormalized, 'Drupal and WP taxonomy lists must match text-wise').toEqual(drupalNormalized);
    expect.soft(wpCounts, 'Drupal and WP taxonomy counts must match exactly').toEqual(drupalCounts);
    expect.soft(missingInWP.length, 'There should be no missing items in WP').toBe(0);
    expect.soft(extraInWP.length, 'There should be no extra items in WP').toBe(0);
    drupalDuplicates?.forEach(({ taxonomy, count: drupalCount }) => {
        const wpCount = wpCounts[taxonomy] || 0;
        expect.soft(wpCount, `Duplicate count for ${taxonomy} should match`).toBe(drupalCount);
    });
    expect.assertions();
});