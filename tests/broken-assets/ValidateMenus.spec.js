import { test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createObjects } from "../../pages/ObjectFactory.js";

const finalFactory = createObjects();

/* ======================================================================
   MENU ITEM CLASSES
====================================================================== */
class MenuItem {
    constructor({ title = "", href = "", text = "", children = [] }) {
        this.title = title;
        this.href = href;
        this.text = text;
        this.children = children;
    }
}

class MainMenu {
    constructor({ menuTitle = "", menuId = "", menuSlug = "", items = [] }) {
        this.menuTitle = menuTitle;
        this.menuId = menuId;
        this.menuSlug = menuSlug;
        this.items = items;
    }
}

/* ======================================================================
   WORDPRESS MENU EXTRACTOR
====================================================================== */
async function extractWpItems(ulLocator, depth = 0) {
    const items = [];
    const indent = "  ".repeat(depth);

    console.log(`${indent}📁 Reading WP items at depth ${depth}...`);

    const liNodes = await ulLocator.locator(":scope > li.menu-item-box").all();
    console.log(`${indent}Found ${liNodes.length} WP <li> nodes`);

    for (const li of liNodes) {
        const title = (await li.locator(".menu-item-title").textContent().catch(() => "")).trim();
        const href = await li.locator(".menu-item-meta a").getAttribute("href").catch(() => "");
        const text = await li.locator(".menu-item-meta").textContent().catch(() => "");

        console.log(`${indent}🔹 WP Item: ${title} (${href})`);

        const menuItem = new MenuItem({ title, href, text, children: [] });

        const hasChildren = await li.evaluate(el => el.classList.contains("has-children"));
        if (hasChildren) {
            console.log(`${indent}↳ WP Item "${title}" has children...`);
            const childUl = li.locator(":scope > ul.menu-level");
            menuItem.children = await extractWpItems(childUl, depth + 1);
        }

        items.push(menuItem);
    }
    return items;
}

async function extractWordPressMenus(page) {
    console.log("🔵 START WordPress menu extraction...");

    const menus = [];
    const wrappers = await page.locator(".menu-wrapper").all();

    console.log(`Found ${wrappers.length} WP menu sections`);

    for (const wrap of wrappers) {
        const menuTitle = (await wrap.locator("h2").textContent().catch(() => "")).trim();
        const termIdText = await wrap.locator("span.menu-term-id").textContent().catch(() => "");
        const menuId = termIdText.replace("[Term ID:", "").replace("]", "").trim();
        const slug = menuTitle.toLowerCase().replace(/\s+/g, "-");

        console.log(`📘 WP Menu: ${menuTitle} (ID: ${menuId})`);

        const items = await extractWpItems(wrap.locator("ul.menu-level.menu-level-0"));

        menus.push(new MainMenu({ menuTitle, menuId, menuSlug: slug, items }));
    }

    console.log("🔵 WP extraction complete.\n");
    return menus;
}

/* ======================================================================
   DRUPAL MENU EXTRACTOR
====================================================================== */
async function extractDrupalItems(ulLocator, depth = 0) {
    const items = [];
    const indent = "  ".repeat(depth);

    console.log(`${indent}📁 Reading Drupal items at depth ${depth}...`);

    const liNodes = await ulLocator.locator(":scope > li.menu-item-box").all();
    console.log(`${indent}Found ${liNodes.length} Drupal <li> nodes`);

    for (const li of liNodes) {
        const status = await li.locator(".status-badge").textContent().catch(() => "");
        const isEnabled = status.includes("Enabled");

        const title = (await li.locator(".menu-item-title").textContent().catch(() => "")).trim();
        const href = await li.locator(".menu-item-meta a").getAttribute("href").catch(() => "");
        const text = await li.locator(".menu-item-meta").textContent().catch(() => "");

        console.log(`${indent}🔹 Drupal Item: ${title} (${href}) [${status}]`);

        if (!isEnabled) {
            console.log(`${indent}⚠️ Skipping disabled item`);
            continue;
        }

        const menuItem = new MenuItem({ title, href, text, children: [] });

        const hasChildren = await li.evaluate(el => el.classList.contains("has-children"));
        if (hasChildren) {
            console.log(`${indent}↳ Drupal Item "${title}" has children...`);
            const subUl = li.locator(":scope > ul.menu-level");
            menuItem.children = await extractDrupalItems(subUl, depth + 1);
        }

        items.push(menuItem);
    }

    return items;
}

async function extractDrupalMenus(page) {
    console.log("🟣 START Drupal menu extraction...");

    const menus = [];
    const wrappers = await page.locator(".menu-wrapper").all();

    console.log(`Found ${wrappers.length} Drupal menu sections`);

    for (const wrap of wrappers) {
        const menuTitle = (await wrap.locator("h2").textContent().catch(() => "")).trim();
        const menuIdText = await wrap.locator("span.menu-id").textContent().catch(() => "");
        
        const menuId = menuIdText.replace("[Menu ID:", "").replace("]", "").trim();
        const slug = menuTitle.toLowerCase().replace(/\s+/g, "-");

        console.log(`📗 Drupal Menu: ${menuTitle} (ID: ${menuId})`);

        const items = await extractDrupalItems(wrap.locator("ul.menu-level.menu-level-0"));

        menus.push(new MainMenu({ menuTitle, menuId, menuSlug: slug, items }));
    }

    console.log("🟣 Drupal extraction complete.\n");
    return menus;
}

/* ======================================================================
   COMPARATOR (UPDATED — HIERARCHY AWARE)
====================================================================== */
class MenuComparator {

    static flattenTree(items, parent = "") {
        let result = [];

        for (const item of items) {
            const path = parent ? `${parent} > ${item.title}` : item.title;

            result.push({
                path,
                title: item.title,
                href: item.href,
            });

            if (item.children?.length) {
                result.push(...MenuComparator.flattenTree(item.children, path));
            }
        }

        return result;
    }

    static compareMenus(drupalItems, wpItems, menuName) {
        let results = [];

        const flatDrupal = MenuComparator.flattenTree(drupalItems);
        const flatWP = MenuComparator.flattenTree(wpItems);

        const mapWP = new Map(flatWP.map(i => [i.path, i]));
        const mapDrupal = new Map(flatDrupal.map(i => [i.path, i]));

        // Drupal → WP  
        for (const d of flatDrupal) {
            const w = mapWP.get(d.path);

            if (!w) {
                results.push({
                    Node: d.path,
                    Item: d.title,
                    Issue: "Missing in WordPress",
                    DrupalURL: d.href,
                    WordPressURL: ""
                });
                continue;
            }

            if (d.href !== w.href) {
                results.push({
                    Node: d.path,
                    Item: d.title,
                    Issue: "URL mismatch",
                    DrupalURL: d.href,
                    WordPressURL: w.href
                });
            }
        }

        // WP → Drupal
        for (const w of flatWP) {
            if (!mapDrupal.has(w.path)) {
                results.push({
                    Node: w.path,
                    Item: w.title,
                    Issue: "Extra in WordPress or hierarchy mismatch",
                    DrupalURL: "",
                    WordPressURL: w.href
                });
            }
        }

        return results;
    }
}

/* ======================================================================
   MAIN TEST
====================================================================== */
test.setTimeout(15 * 60 * 60 * 1000);

test("🔥 Full Drupal vs WordPress Menu Comparison", async ({ page }) => {

    const drupalFile = "file://" + path.resolve(__dirname, "Drupalv3.html");
    const wpFile = "file://" + path.resolve(__dirname, "WordpressV3.html");

    console.log("📥 Extracting Drupal HTML menus...");
    await page.goto(drupalFile);
    const drupalMenus = await extractDrupalMenus(page);

    console.log("📥 Extracting WordPress HTML menus...");
    await page.goto(wpFile);
    const wpMenus = await extractWordPressMenus(page);

    fs.writeFileSync("DrupalMenus.json", JSON.stringify(drupalMenus, null, 2));
    fs.writeFileSync("WordPressMenus.json", JSON.stringify(wpMenus, null, 2));

    let comparison = [];

    // Compare each Drupal menu with WP menu
    for (const d of drupalMenus) {
        const w = wpMenus.find(x => x.menuSlug === d.menuSlug);

        if (!w) {
            comparison.push({
                Node: d.menuTitle,
                Item: "",
                Issue: "Entire menu missing in WordPress",
                DrupalURL: "",
                WordPressURL: ""
            });
            continue;
        }

        comparison.push(...MenuComparator.compareMenus(d.items, w.items, d.menuTitle));
    }

    // Check extra WP menus
    for (const w of wpMenus) {
        const exists = drupalMenus.find(x => x.menuSlug === w.menuSlug);
        if (!exists) {
            comparison.push({
                Node: w.menuTitle,
                Item: "",
                Issue: "Extra menu in WordPress",
                DrupalURL: "",
                WordPressURL: ""
            });
        }
    }

    fs.writeFileSync("MenuComparison.json", JSON.stringify(comparison, null, 2));
    await finalFactory.utility.saveToExcel("menuHtmlsComparison.xlsx", "menuHtmlsComparison", comparison, "comparison");

    console.log("🎉 Comparison completed!");
    console.log("✔ DrupalMenus.json created");
    console.log("✔ WordPressMenus.json created");
    console.log("✔ MenuComparison.json created");
    console.log("✔ Excel saved: comparison/menuHtmlsComparison.xlsx");
});
