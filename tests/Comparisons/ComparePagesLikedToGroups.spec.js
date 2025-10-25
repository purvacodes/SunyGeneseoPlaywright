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
        const key = group.toLowerCase();
        if (!csvMap[key]) csvMap[key] = [];
        if (permalink) csvMap[key].push(permalink);
    });

    const normalize = url => (url || '').trim().replace(/\/+$/, '');

    // --- Step 3: Process Drupal data ---
    const results = [];

    data.forEach(row => {
        const drupalGroupRaw = (row['Drupal Group'] || '').trim();
        const drupalURL = (row['URL'] || '').trim();
        if (!drupalGroupRaw || !drupalURL) return;

        const drupalGroups = drupalGroupRaw.split(';').map(g => g.trim()).filter(Boolean);

        drupalGroups.forEach(group => {
            const key = group.toLowerCase();
            const expectedPermalinks = csvMap[key] || [];

            if (expectedPermalinks.length === 0) {
                results.push({
                    GroupName: group,
                    DrupalURL: drupalURL,
                    Status: '❌ Group Not Found',
                    MismatchedPermalink: ''
                });
            } else {
                // --- Check if this Drupal URL matches any CSV permalink ---
                const matched = expectedPermalinks.find(p => normalize(p) === normalize(drupalURL));
                if (matched) {
                    results.push({
                        GroupName: group,
                        DrupalURL: drupalURL,
                        Status: '✅ Match',
                        MismatchedPermalink: ''
                    });
                } else {
                    results.push({
                        GroupName: group,
                        DrupalURL: drupalURL,
                        Status: '⚠️ URL Mismatch',
                        MismatchedPermalink: ''  // Empty for mismatched Drupal URL
                    });
                }

                // --- Add rows for each unmatched CSV permalink individually ---
                const unmatched = expectedPermalinks.filter(p => normalize(p) !== normalize(drupalURL));
                unmatched.forEach(p => {
                    results.push({
                        GroupName: group,
                        DrupalURL: '',
                        Status: '❌ CSV URL Missing',
                        MismatchedPermalink: p
                    });
                });
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
