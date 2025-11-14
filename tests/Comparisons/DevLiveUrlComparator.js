import { test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createObjects } from "../../pages/ObjectFactory.js";

const finalFactory = createObjects();

/* ======================================================================
   HELPERS
====================================================================== */

function normalizeHref(url = "") {
    return url
        .replace("http://localhost/wordpress-test", "")
        .replace("http://localhost/drupal-geneseo/list_menus.php", "")
        .replace(/\/$/, "")
        .trim() || "/";
}

function cleanWpMenuSlug(raw = "") {
    return raw.split("[")[0].replace(/-+$/, "").trim();
}

/* ======================================================================
   MENU ITEM CLASS
====================================================================== */

class MenuItem {
    constructor({ title = "", href = "", children = [] }) {
        this.title = title;
        this.href = href;
        this.children = children;
    }
}

/* ======================================================================
   WORDPRESS MENU EXTRACTION
====================================================================== */

async function extractWpItems(ulLocator, depth = 0) {
    const items = [];
    const indent = "  ".repeat(depth);

    console.log(`${indent}📁 Reading WP items at depth ${depth}...`);

    const liNodes = await ulLocator.locator(":scope > li.menu-item-box").all();

    for (const li of liNodes) {
        const title = (await li.locator(".menu-item-title").textContent().catch(() => "")).trim();
        const hrefRaw = await li.locator(".menu-item-meta a").getAttribute("href").catch(() => "");
        const href = normalizeHref(hrefRaw);

        console.log(`${indent}🔹 WP Item: ${title} → ${href}`);

        const menuItem = new MenuItem({ title, href, children: [] });

        const hasChildren = await li.evaluate(el => el.classList.contains("has-children"));
        if (hasChildren) {
            console.log(`${indent}↳ WP Item "${title}" has children`);
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

    for (const wrap of wrappers) {
        const slugRaw = await wrap.locator("span.menu-slug").textContent().catch(() => "");
        const menuSlug = cleanWpMenuSlug(slugRaw);

        console.log(`📘 WP Menu Slug: ${menuSlug}`);

        const items = await extractWpItems(wrap.locator("ul.menu-level.menu-level-0"));

        menus.push({ menuSlug, items });
    }

    console.log("🔵 WP extraction complete.\n");
    return menus;
}

/* ======================================================================
   DRUPAL MENU EXTRACTION
====================================================================== */

async function extractDrupalItems(ulLocator, depth = 0) {
    const items = [];
    const indent = "  ".repeat(depth);

    console.log(`${indent}📁 Reading Drupal items at depth ${depth}...`);

    const liNodes = await ulLocator.locator(":scope > li.menu-item-box").all();

    for (const li of liNodes) {
        const status = await li.locator(".status-badge").textContent().catch(() => "");
        const isEnabled = status.includes("Enabled");
        if (!isEnabled) continue;

        const title = (await li.locator(".menu-item-title").textContent().catch(() => "")).trim();
        const hrefRaw = await li.locator(".menu-item-meta a").getAttribute("href").catch(() => "");
        const href = normalizeHref(hrefRaw);

        console.log(`${indent}🔹 Drupal Item: ${title} → ${href}`);

        const menuItem = new MenuItem({ title, href, children: [] });

        const hasChildren = await li.evaluate(el => el.classList.contains("has-children"));
        if (hasChildren) {
            console.log(`${indent}↳ Drupal Item "${title}" has children`);
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

    for (const wrap of wrappers) {
        const menuIdRaw = await wrap.locator("span.menu-id").textContent().catch(() => "");
        const menuId = menuIdRaw.replace("[Menu ID:", "").replace("]", "").trim();

        console.log(`📗 Drupal Menu ID: ${menuId}`);

        const items = await extractDrupalItems(wrap.locator("ul.menu-level.menu-level-0"));

        menus.push({ menuId, items });
    }

    console.log("🟣 Drupal extraction complete.\n");
    return menus;
}

/* ======================================================================
   COMPARATOR
====================================================================== */

class MenuComparator {

    static flatten(items, parent = "") {
        let output = [];
        for (const item of items) {
            const path = parent ? `${parent} > ${item.title}` : item.title;

            output.push({ path, title: item.title, href: item.href });

            if (item.children?.length > 0) {
                output.push(...MenuComparator.flatten(item.children, path));
            }
        }
        return output;
    }

    static compareMenus(drupalItems, wpItems) {
        let results = [];

        const flatD = MenuComparator.flatten(drupalItems);
        const flatW = MenuComparator.flatten(wpItems);

        const mapW = new Map(flatW.map(i => [i.path, i]));

        // Drupal → WP
        for (const d of flatD) {
            const w = mapW.get(d.path);
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

        // WP → Drupal extra items
        const mapD = new Map(flatD.map(i => [i.path, i]));

        for (const w of flatW) {
            if (!mapD.has(w.path)) {
                results.push({
                    Node: w.path,
                    Item: w.title,
                    Issue: "Extra in WordPress",
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

    for (const d of drupalMenus) {
        const w = wpMenus.find(x => x.menuSlug.toLowerCase() === d.menuId.toLowerCase());

        if (!w) {
            comparison.push({
                Node: d.menuId,
                Item: "",
                Issue: "Entire menu missing in WordPress",
                DrupalURL: "",
                WordPressURL: ""
            });
            continue;
        }

        comparison.push(...MenuComparator.compareMenus(d.items, w.items));
    }

    await finalFactory.utility.saveToExcel(
        "menuHtmlsComparison.xlsx", 
        "menuHtmlsComparison", 
        comparison, 
        "comparison"
    );

    fs.writeFileSync("MenuComparison.json", JSON.stringify(comparison, null, 2));

    console.log("🎉 Comparison completed!");
});
