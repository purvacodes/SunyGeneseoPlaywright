import { test, expect } from '@playwright/test';
import XLSX from 'xlsx';
import { createObjects } from '../../pages/ObjectFactory.js';
import { credentials } from "../../data/credentials.js";

test.setTimeout(60 * 60 * 1000);

test('Compare WP Role Menu Mapper with Drupal Groups', async ({ page }) => {
  const objectFactory = createObjects(page);

  // ---- STEP 1: Login to Hostinger (WP) ----
 await page.goto("https://dev-suny-geneseo.pantheonsite.io/wp-admin/", {
    timeout: 60000,
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('textbox', { name: 'Username' }).fill("amit.kaushal@infostride.com");
  await page.getByRole('textbox', { name: 'Password' }).fill("Login@123");
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('#wpadminbar', { state: 'visible' });


  // ---- STEP 2: Go to Role Menu Mapper ----
  await page.goto(
    'https://dev-suny-geneseo.pantheonsite.io/wp-admin/themes.php?page=mu-role-menu-mapper'
  );
  await page.waitForSelector('.mu-rmm-row');

  // ---- STEP 3: Extract WP Roles & Menus ----
  const wpData = await page.$$eval('.mu-rmm-row', rows =>
    rows.map(row => {
      const roleElem = row.querySelector('.mu-rmm-col.role strong');
      const selectElem = row.querySelector('select');
      let menuText = '';
      if (selectElem) {
        const selectedOption = selectElem.options[selectElem.selectedIndex];
        menuText = selectedOption ? selectedOption.textContent.trim() : '';
      }
      const role = roleElem ? roleElem.textContent.trim() : '';
      return { role, menu: menuText };
    })
  );

  // ---- STEP 4: Login to Drupal ----
  await page.goto(credentials.drupal.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Username" }).fill(credentials.drupal.username);
  await page.getByRole("textbox", { name: "Password" }).fill(credentials.drupal.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForSelector('#toolbar-bar', { state: 'visible', timeout: 50000 });

  // ---- STEP 5: Go to Drupal Groups ----
  await page.goto("http://geneseo-drupal.ddev.site:33000/admin/group", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('table tbody tr');

  // ---- STEP 6: Extract Drupal Group Data ----
  const drupalData = await page.$$eval('table tbody tr', rows =>
    rows.map(row => {
      const id = row.querySelector('[headers="view-id-table-column"]')?.textContent.trim() || '';
      const name = row.querySelector('[headers="view-label-table-column"]')?.textContent.trim() || '';
      const subsite = row.querySelector('[headers="view-field-sub-site-url-table-column"] a')?.textContent.trim() || '';
      return { id, name, subsite };
    })
  );

  // ---- STEP 7: Compare WP vs Drupal ----
  const results = [];

  for (const wp of wpData) {
    const match = drupalData.find(
      d => d.name.toLowerCase().trim() === wp.role.toLowerCase().trim()
    );

    if (!match) {
      results.push({
        Role: wp.role,
        'Drupal Group': '-',
        'Drupal Group ID': '-',
        'WP Menu': wp.menu,
        'Drupal Subsite': '-',
        Status: 'Not Found in Drupal',
      });
      continue;
    }

    const wpMenu = wp.menu.toLowerCase().replace(/^group-menu-/, '').replace(/[-_ ]/g, '');
    const drupalSubsite = match.subsite.toLowerCase().replace(/[-_ ]/g, '');
    const isMatch = wpMenu === drupalSubsite;

    results.push({
      Role: wp.role,
      'Drupal Group': match.name,
      'Drupal Group ID': match.id,
      'WP Menu': wp.menu,
      'Drupal Subsite': match.subsite,
      Status: isMatch ? 'Match' : 'Mismatch',
    });
  }

  // ---- STEP 8: Add extra Drupal-only groups ----
  for (const d of drupalData) {
    if (!wpData.some(w => w.role.toLowerCase().trim() === d.name.toLowerCase().trim())) {
      results.push({
        Role: '-',
        'Drupal Group': d.name,
        'Drupal Group ID': d.id,
        'WP Menu': '-',
        'Drupal Subsite': d.subsite,
        Status: 'Not Found in WP',
      });
    }
  }

  // ---- STEP 9: Console Output ----
  console.table(results, [
    'Role',
    'Drupal Group',
    'Drupal Group ID',
    'WP Menu',
    'Drupal Subsite',
    'Status'
  ]);

  // ---- STEP 10: Save to Excel (styled) ----
  const formattedResults = results.map(r => ({
    Role: r.Role || '',
    'Drupal Group': r['Drupal Group'] || '',
    'Drupal Group ID': r['Drupal Group ID'] || '',
    'WP Menu': r['WP Menu'] || '',
    'Drupal Subsite': r['Drupal Subsite'] || '',
    Status: r.Status || '',
  }));

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(formattedResults, {
    header: ['Role', 'Drupal Group', 'Drupal Group ID', 'WP Menu', 'Drupal Subsite', 'Status'],
  });

  // Auto-adjust column widths
  const colWidths = Object.keys(formattedResults[0]).map(k => ({
    wch: Math.max(
      k.length,
      ...formattedResults.map(r => (r[k] ? r[k].toString().length : 0))
    ) + 2,
  }));
  sheet['!cols'] = colWidths;

  // ---- Header styling ----
  const headerColor = "007CBA";
  const headerFontColor = "FFFFFF";
  ['A1','B1','C1','D1','E1','F1'].forEach(c => {
    if (sheet[c]) {
      sheet[c].s = {
        font: { bold: true, color: { rgb: headerFontColor } },
        fill: { fgColor: { rgb: headerColor } },
        alignment: { horizontal: "center" },
      };
    }
  });

  // ---- Status-based row color ----
  formattedResults.forEach((r, i) => {
    const rowNum = i + 2;
    const color =
      r.Status === 'Match'
        ? 'C6EFCE' // green
        : r.Status === 'Mismatch'
        ? 'FFC7CE' // red
        : 'FFEB9C'; // yellow

    const statusCell = `F${rowNum}`;
    if (sheet[statusCell]) {
      sheet[statusCell].s = {
        fill: { fgColor: { rgb: color } },
        alignment: { horizontal: "center" },
      };
    }
  });

  // ---- Save ----
  XLSX.utils.book_append_sheet(workbook, sheet, 'Comparison_Results');
  XLSX.writeFile(workbook, 'RoleMenuCompare.xlsx');
  console.log('📘 Comparison results saved to RoleMenuCompare.xlsx with full formatting.');

});
