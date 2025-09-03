import { test, expect } from '@playwright/test';
import fs from 'fs';

global.drupalTaxonomies = [];
global.wordPressTaxonomies = [];
global.drupalDuplicates = [];

test.describe.serial('Taxonomy comparison', () => {

    test('Get All the Taxonomies from Drupal', async ({ page }) => {
        //  Login Drupal
        await page.goto('http://drupal-geneseo-backup.ddev.site/user/login', { timeout: 60000, waitUntil: 'domcontentloaded' });
        await page.getByRole('textbox', { name: 'Username' }).click();
        await page.getByRole('textbox', { name: 'Username' }).fill('walters');
        await page.getByRole('textbox', { name: 'Password' }).click();
        await page.getByRole('textbox', { name: 'Password' }).fill('Welcome@123');
        await page.getByRole('button', { name: 'Log in' }).click();
        // Navigate to taxonomy page
        await page.goto('http://drupal-geneseo-backup.ddev.site/admin/structure/taxonomy/manage/academic_program_keywords/overview', { timeout: 60000, waitUntil: 'domcontentloaded' });

        while (true) {
            // Get taxonomies texts from current page
            const texts = await page.locator('.menu-item__link').allTextContents();
            global.drupalTaxonomies.push(...texts.map(t => t.trim()));
            const nextBtn = page.getByRole('link', { name: 'Next page' });
            try {
                await page.mouse.wheel(0, 2000);
                await nextBtn.waitFor({ state: 'visible', timeout: 2000 });
                await nextBtn.scrollIntoViewIfNeeded();
                await nextBtn.click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(1000);
            } catch (err) {
                break;
            }
        }
        //Writing drupal taxonomies in file
        fs.writeFileSync('drupalTaxonomies.json', JSON.stringify(drupalTaxonomies, null, 2));
        console.log('Drupal mediaContactsTaxonomies Count:', drupalTaxonomies.length);
    });

    test('Get All the Taxonomies from wordPress', async ({ page }) => {
        await page.goto('https://dev-infostride-geneseo.pantheonsite.io/wp-admin/');
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('textbox', { name: 'Username or Email Address' }).fill('amit.kaushal@infostride.com');
        await page.getByRole('textbox', { name: 'Password' }).click();
        await page.getByRole('textbox', { name: 'Password' }).fill('Login@123');
        await page.getByRole('button', { name: 'Log In' }).click();
        await page.goto('https://dev-infostride-geneseo.pantheonsite.io/wp-admin/edit-tags.php?taxonomy=academic_program_keywords&post_type=program_page');
        await page.getByRole('button', { name: 'Screen Options' }).click();
        await page.getByRole('spinbutton', { name: 'Number of items per page:' }).click();
        await page.getByRole('spinbutton', { name: 'Number of items per page:' }).fill('700');
        await page.getByLabel('Screen Options Tab').getByRole('button', { name: 'Apply' }).click();

        await page.waitForLoadState('networkidle');  // waits until page is done loading
        // await page.waitForLoadState('domcontentloaded');
        //       await page.waitForTimeout(10000);
        const texts = await page.locator('.row-title').allTextContents();
        global.wordPressTaxonomies.push(...texts.map(t => t.trim()));

        //Writing wordPress taxonomies in file 
        fs.writeFileSync('wordPressTaxonomies.json', JSON.stringify(wordPressTaxonomies, null, 2));
        console.log('wordPress mediaContactsTaxonomies Count:', wordPressTaxonomies.length);
    });

    const compareTaxonomies = (drupalArr, wpArr) => {

        // 🔎 Debug log: find actual unequal raw strings
          
        const missingInWPRaw = drupalArr.filter(d => !wpArr.includes(d));
        const extraInWPRaw = wpArr.filter(w => !drupalArr.includes(w));
        console.log("missingInWPRaw: ", missingInWPRaw);
        console.log("extraInWPRaw: ", extraInWPRaw);


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
        drupalDuplicates = Object.entries(drupalCounts)
            .filter(([_, count]) => count > 1)
            .map(([taxonomy, count]) => ({ taxonomy, count }));
        console.log("Duplicates in Drupal", drupalDuplicates)

        const missingInWP = [];
        const extraInWP = [];
        const extraInDr = [];

        const allKeys = new Set([...Object.keys(drupalCounts), ...Object.keys(wpCounts)]);

        for (const key of allKeys) {
            const dCount = drupalCounts[key] || 0;
            const wCount = wpCounts[key] || 0;

            if (dCount > wCount) missingInWP.push({ taxonomy: key, count: dCount - wCount });
            if (wCount > dCount) extraInWP.push({ taxonomy: key, count: wCount - dCount });
            if (dCount > wCount) extraInDr.push({ taxonomy: key, count: dCount - wCount });
        }

        console.log('Missing in WP:', missingInWP);
        console.log('Extra in WP:', extraInWP);
        // console.log('Extra in Dr:', extraInDr);
        return { missingInWP, extraInWP, extraInDr, drupalCounts, wpCounts, drupalDuplicates };
    };

    test('Compare Drupal vs wordPress Taxonomies from JSON', async () => {
        const { missingInWP, extraInWP, drupalCounts, drupalDuplicates, wpCounts, wpNormalized, drupalNormalized } =
            compareTaxonomies(global.drupalTaxonomies, global.wordPressTaxonomies);

        //checks logical equality (ignores formatting differences).
        expect(wpNormalized, 'Drupal and WP taxonomy lists must match text-wise').toEqual(drupalNormalized);


        // //checks literal equality (every character must match).
        // expect(wpTaxonomies, 'Drupal and WP taxonomy lists must match text-wise').toEqual(drupalTaxonomies);

        expect(wpCounts, 'Drupal and WP taxonomy counts must match exactly').toEqual(drupalCounts);
        expect(missingInWP.length, 'There should be no missing items in WP').toBe(0);
        expect(extraInWP.length, 'There should be no extra items in WP').toBe(0);
        drupalDuplicates?.forEach(([taxonomy, drupalCount]) => {
            const wpCount = wpCounts[taxonomy] || 0;
            expect(wpCount, `Duplicate count for ${taxonomy} should match`).toBe(drupalCount);
        });

    });

});