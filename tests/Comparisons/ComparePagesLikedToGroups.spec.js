import { test } from '@playwright/test';
import XLSX from "xlsx";

const EXCEL_FILE = 'Inventory.xlsx';       // Input file
const OUTPUT_FILE = './comparison-results.xlsx'; // Output file

test('🔍 Compare CSV Group URLs vs Drupal Group URLs', async () => {
  // --- Step 1: Read Excel ---
  const workbook = XLSX.readFile(EXCEL_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  // --- Step 2: Build CSV lookup map ---
  const csvMap = {};
  data.forEach(row => {
    const group = (row['CSV Group Name'] || '').trim();
    const permalink = (row['Permalink'] || '').trim();
    if (!group) return;
    if (!csvMap[group.toLowerCase()]) csvMap[group.toLowerCase()] = [];
    csvMap[group.toLowerCase()].push(permalink);
  });

  // --- Step 3: Process Drupal data ---
  const results = [];

  data.forEach(row => {
    const drupalGroupRaw = (row['Drupal Group'] || '').trim();
    const drupalURL = (row['URL'] || '').trim();
    if (!drupalGroupRaw || !drupalURL) return;

    // Split multiple groups in Drupal column
    const drupalGroups = drupalGroupRaw.split(';').map(g => g.trim()).filter(Boolean);

    drupalGroups.forEach(group => {
      const key = group.toLowerCase();
      const expectedPermalinks = csvMap[key] || [];

      if (expectedPermalinks.length === 0) {
        results.push({
          DrupalGroup: group,
          DrupalURL: drupalURL,
          Status: '❌ Group Not Found',
          MatchedCSVPermalink: '',
          ExpectedPermalinks: ''
        });
      } else {
       

        // Normalize URLs: remove trailing slash for comparison
const normalize = url => (url || '').trim().replace(/\/+$/, '');

// Later in your comparison
const matched = expectedPermalinks.find(p => normalize(p) === normalize(drupalURL));

        if (matched) {
          results.push({
            DrupalGroup: group,
            DrupalURL: drupalURL,
            Status: '✅ Match',
            MatchedCSVPermalink: matched,
            ExpectedPermalinks: expectedPermalinks.join('; ')
          });
        } else {
          results.push({
            DrupalGroup: group,
            DrupalURL: drupalURL,
            Status: '⚠️ URL Mismatch',
            MatchedCSVPermalink: '',
            ExpectedPermalinks: expectedPermalinks.join('; ')
          });
        }
      }
    });
  });

  // --- Step 4: Export results to Excel ---
  const ws = XLSX.utils.json_to_sheet(results);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Results');
  XLSX.writeFile(wb, OUTPUT_FILE);

  console.log(`✅ Comparison complete. Results saved to ${OUTPUT_FILE}`);
});
