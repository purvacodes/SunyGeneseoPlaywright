import { Console } from 'console';
import { contentPostTypesUrls } from '../data/contentPostTypesUrls.js';
import { credentials } from '../data/credentials.js';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

export class Utility {
    constructor(wordPress, page) {
        this.env = credentials.env.wordPress;
        this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
        this.wordPress = wordPress;
        this.page = page; // make sure to pass `page` from Playwright
    }

    async getUrlsfromSitemap(baseUrl, cpt, count) {
        const urls = [];

        for (let i = 1; i <= count; i++) {
            const path = i === 1
                ? `/${cpt}-sitemap.xml`
                : `/${cpt}-sitemap${i}.xml`;

            const fullUrl = baseUrl.replace(/\/$/, '') + path;
            urls.push(fullUrl);
        }
        return urls;
    }

    async setItemsPerPageByScreenOptions() {
        await this.page.getByRole('button', { name: 'Screen Options' }).click();
        const spinButton = this.page.getByRole('spinbutton', { name: 'Number of items per page:' });
        await spinButton.click();
        await spinButton.fill('999');
        await this.page.getByLabel('Screen Options Tab')
            .getByRole('button', { name: 'Apply' })
            .click();
        await this.page.waitForSelector('#wpadminbar', { state: 'visible', timeout: 60000 });
    }

    async scrapePaginatedUrls(page) {
        const allUrls = new Map();
        let currentPage = 1;

        while (true) {
            // Wait for rows & stabilization
            await page.waitForSelector('tbody#the-list tr', { state: 'visible' });

            let lastCount = 0;
            let stableCount = 0;
            while (stableCount < 2) {
                const currentCount = await page.$$eval('tbody#the-list tr', rows => rows.length);
                if (currentCount === lastCount) {
                    stableCount++;
                } else {
                    stableCount = 0;
                    lastCount = currentCount;
                }
                await page.waitForTimeout(500);
            }

            // Extract once stable
            const links = await page.$$eval('a.row-title', els =>
                els.map(el => ({
                    href: el.href,
                    text: el.textContent.trim()
                }))
            );
            links.forEach(link => allUrls.set(link.href, link));

            console.log(`📄 Scraped page ${currentPage}, got ${links.length} rows, total so far: ${allUrls.size}`);

            const nextButton = page.locator('.next-page.button').first();
            if (await nextButton.isDisabled()) {
                console.log("✅ Reached last page, scraping complete.");
                break; 
            }
            const previousCount = lastCount;
            await Promise.all([
                nextButton.click(),
                page.waitForFunction(
                    (prev) => document.querySelectorAll('tbody#the-list tr').length !== prev,
                    previousCount,
                    { timeout: 20000 }
                )
            ]);

            currentPage++;
        }

        return Array.from(allUrls.values());
    }

    async saveCptUrlsToExcel(allUrls, cpt) {
        const folderPath = path.join('.', 'test-artifacts', 'BrokenMedia');
        const filePath = path.join(folderPath, `${cpt}.xlsx`);

        const sheetName = cpt;

        const workbook = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([['Path']]);
        allUrls.forEach(url => {
            XLSX.utils.sheet_add_aoa(ws, [[url]], { origin: -1 });
        });

        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
        XLSX.writeFile(workbook, filePath);
        console.log(`✅ Saved ${allUrls.length} URLs to ${filePath}`);
    }

    saveToExcel(fileName, sheetName, data, subfolder) {
        if (!data || data.length === 0) {
            console.warn(`⚠️ No data provided for ${sheetName}, skipping Excel generation.`);
            return;
        }

        const MAX_CELL_LENGTH = 32767;

        // Sanitize data
        const sanitizedData = data.map(row => {
            const sanitizedRow = {};
            for (const key in row) {
                let value = row[key];
                if (typeof value === 'string' && value.length > MAX_CELL_LENGTH) {
                    value = value.slice(0, MAX_CELL_LENGTH - 3) + '...';
                }
                sanitizedRow[key] = value;
            }
            return sanitizedRow;
        });

        const worksheet = XLSX.utils.json_to_sheet(sanitizedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        // Ensure folder exists
        const dirPath = path.join('test-artifacts', subfolder);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        const outputPath = path.join(dirPath, fileName);
        XLSX.writeFile(workbook, outputPath);

        console.log(`✅ Excel file saved at: ${outputPath}`);
    }

    loadCptUrlsFromExcel(cpt, baseUrl) {

        const filePath = path.resolve(process.cwd(), 'test-artifacts', 'BrokenMedia', `${cpt}.xlsx`);
        const sheetName = cpt;
        console.log(`🔍 Attempting to read Excel from: ${filePath}`);
        if (!fs.existsSync(filePath)) {
            throw new Error(`❌ File not found: ${filePath}`);
        }
        console.log(`Loading URLs from: ${filePath}`);
        const workbook = XLSX.readFile(filePath);

        if (!workbook.Sheets[sheetName]) {
            throw new Error(`❌ Sheet "${sheetName}" not found in ${filePath}`);
        }

        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        return data
            .map(row => row.URL || row.Path)
            .filter(Boolean)
            .map(path => {
                if (baseUrl && !path.startsWith("http")) {  // Ensure it's not already a full URL
                    return baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "");  // Append path
                }
                return path;  // Return as-is if it already starts with http(s)
            })
    }

    loadExcel(filePath) {
        console.log(`🔍 Attempting to read Excel from: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`❌ File not found: ${filePath}`);
        }

        console.log(`Loading data from: ${filePath}`);

        const workbook = XLSX.readFile(filePath);
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            throw new Error(`❌ No sheets found in ${filePath}`);
        }

        const sheet = workbook.Sheets[firstSheetName];

        // Read raw rows
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (data.length < 2) {
            throw new Error("❌ Sheet contains no data rows.");
        }
        // Skip the first row (headers), then map the first column
        const firstColumn = data.slice(1)  // skip header
            .map(row => row[0])
            .filter(Boolean);
        return firstColumn;
  
    }
}

