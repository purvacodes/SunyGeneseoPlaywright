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

    const liNodes = await ulLocator.locator(":scope > li[class*='menu-item-box']").all();
    console.log(`${indent}Found ${liNodes.length} WP <li> nodes`);

    for (const li of liNodes) {
        const title = (await li.locator(".menu-item-title strong").first().textContent().catch(() => "")).trim();

        let href = "";
        const aTag = li.locator(".menu-item-meta a").first();
        if (await aTag.count()) href = await aTag.getAttribute("href");

        const text = await li.locator(".menu-item-meta").innerText().catch(() => "");

        console.log(`${indent}🔹 WP Item: ${title} (${href})`);

        const menuItem = new MenuItem({ title, href, text, children: [] });

        const hasChildren = await li.evaluate(el => el.classList.contains("has-children"));
        if (hasChildren) {
            const childUl = li.locator(":scope > ul[class*='menu-level']");
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
        const menuTitle = (await wrap.locator("h2").textContent().catch(() => "")).trim();
        const termIdText = await wrap.locator("span.menu-term-id").textContent().catch(() => "");
        const menuId = termIdText.replace("[Term ID:", "").replace("]", "").trim();

        // WP slug contains [term-id] suffix - we remove later
        const menuSlug = `${menuTitle.toLowerCase().replace(/\s+/g, "-")}`

        const items = await extractWpItems(wrap.locator("ul.menu-level.menu-level-0"));

        menus.push(new MainMenu({ menuTitle, menuId, menuSlug, items }));
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

    const liNodes = await ulLocator.locator(":scope > li[class*='menu-item-box']").all();

    for (const li of liNodes) {
        const status = await li.locator(".status-badge").innerText().catch(() => "");

        const isDisabled = status.includes("Disabled");
        const title = (await li.locator(".menu-item-title strong").first().textContent().catch(() => "")).trim();

        let href = "";
        const link = li.locator(".menu-item-meta a").first();
        if (await link.count()) href = await link.getAttribute("href");

        const text = await li.locator(".menu-item-meta").innerText().catch(() => "");

        if (isDisabled) continue;

        const menuItem = new MenuItem({ title, href, text, children: [] });

        const hasChildren = await li.evaluate(el => el.classList.contains("has-children"));
        if (hasChildren) {
            const subUl = li.locator(":scope > ul[class*='menu-level']");
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
        const menuTitle = (await wrap.locator("h2").textContent().catch(() => "")).trim();
        const menuIdText = await wrap.locator("span.menu-id").textContent().catch(() => "");

        const menuId = menuIdText.replace("[Menu ID:", "").replace("]", "").trim();
        const menuSlug = menuTitle.toLowerCase().replace(/\s+/g, "-");

        const items = await extractDrupalItems(wrap.locator("ul.menu-level.menu-level-0"));

        menus.push(new MainMenu({ menuTitle, menuId, menuSlug, items }));
    }

    console.log("🟣 Drupal extraction complete.\n");
    return menus;
}

/* ======================================================================
   COMPARATOR
====================================================================== */
/* ======================================================================
   NEW COMPARATOR (REPLACES OLD ONE)
====================================================================== */
class MenuComparator {

    static normalizeSlug(slug) {
        return slug.replace(/\[term-id.*?\]/gi, "").replace(/-0$/, "").trim();
    }

    static normalizeHref(href) {
        return href
            ?.replace("http://localhost/drupal-geneseo/list_menus.php", "")
            ?.replace("http://localhost/wordpress-test", "")
            ?.replace("https://www.geneseo.edu", "")
            ?.replace("http://www.geneseo.edu", "")
            ?.replace(/\/$/, "")
            ?.trim();
    }

    static compareMenus(drupalMenus, wpMenus) {
        const rows = [];

        for (const dMenu of drupalMenus) {
            const slug = this.normalizeSlug(dMenu.menuId);
            const wpMenu = wpMenus.find(w => this.normalizeSlug(w.menuSlug) === slug);

            // Menu existence check
            rows.push({
                WhichMenu: slug,
                WhichItem: "MENU",
                DrupalValue: dMenu.menuTitle,
                WordPressValue: wpMenu?.menuTitle || "",
                Status: wpMenu ? "OK" : "Missing in WP",
            });

            if (!wpMenu) continue;

            this.compareItems(
                dMenu.items,
                wpMenu.items,
                slug,
                "ITEM",
                rows
            );
        }

        // EXTRA MENUS IN WORDPRESS
        const dIds = drupalMenus.map(m => this.normalizeSlug(m.menuId));

        for (const wpMenu of wpMenus) {
            const slug = this.normalizeSlug(wpMenu.menuSlug);
            if (!dIds.includes(slug)) {
                rows.push({
                    WhichMenu: slug,
                    WhichItem: "MENU",
                    DrupalValue: "",
                    WordPressValue: wpMenu.menuTitle,
                    Status: "Extra in WP",
                });
            }
        }

        return rows;
    }

    static compareItems(dItems, wItems, menuId, level, rows) {
        const used = new Set();

        for (const d of dItems) {
            const matchIndex = wItems.findIndex(
                (w, i) =>
                    !used.has(i) &&
                    (w.title?.trim() === d.title?.trim() ||
                     this.normalizeHref(w.href) === this.normalizeHref(d.href))
            );

            const nextLevel =
                level === "ITEM" ? "CHILD" :
                level === "CHILD" ? "SUBCHILD" :
                "SUBCHILD";

            if (matchIndex === -1) {
                // title missing
                rows.push({
                    WhichMenu: menuId,
                    WhichItem: `${level}_TITLE`,
                    DrupalValue: d.title,
                    WordPressValue: "",
                    Status: "Missing in WP",
                });
                // href missing
                rows.push({
                    WhichMenu: menuId,
                    WhichItem: `${level}_HREF`,
                    DrupalValue: this.normalizeHref(d.href),
                    WordPressValue: "",
                    Status: "Missing in WP",
                });
                continue;
            }

            const w = wItems[matchIndex];
            used.add(matchIndex);

            // TITLE
            rows.push({
                WhichMenu: menuId,
                WhichItem: `${level}_TITLE`,
                DrupalValue: d.title,
                WordPressValue: w.title,
                Status: d.title === w.title ? "OK" : "Title Mismatch",
            });

            // HREF
            const dHref = this.normalizeHref(d.href);
            const wHref = this.normalizeHref(w.href);

            rows.push({
                WhichMenu: menuId,
                WhichItem: `${level}_HREF`,
                DrupalValue: dHref,
                WordPressValue: wHref,
                Status: dHref === wHref ? "OK" : "URL Mismatch",
            });

            // now children
            this.compareItems(
                d.children || [],
                w.children || [],
                menuId,
                nextLevel,
                rows
            );
        }

        // EXTRA WORDPRESS ITEMS
        wItems.forEach((w, i) => {
            if (!used.has(i)) {
                rows.push({
                    WhichMenu: menuId,
                    WhichItem: `${level}_TITLE`,
                    DrupalValue: "",
                    WordPressValue: w.title,
                    Status: "Extra in WP",
                });
                rows.push({
                    WhichMenu: menuId,
                    WhichItem: `${level}_HREF`,
                    DrupalValue: "",
                    WordPressValue: this.normalizeHref(w.href),
                    Status: "Extra in WP",
                });
            }
        });
    }
}


/* ======================================================================
   MAIN TEST (UPDATED)
====================================================================== */
test.setTimeout(15 * 60 * 60 * 1000);

test("🔥 Full Drupal vs WordPress Menu Comparison", async ({ page }) => {

    const drupalFile = "file://" + path.resolve(__dirname, "Drupalv3.html");
    const wpFile = "file://" + path.resolve(__dirname, "WordpressV3.html");

    // console.log("📥 Extracting Drupal HTML menus...");
    // await page.goto(drupalFile);
    // const drupalMenusExtracted = await extractDrupalMenus(page);

    // console.log("📥 Extracting WordPress HTML menus...");
    // await page.goto(wpFile);
    // const wpMenusExtracted = await extractWordPressMenus(page);

    // SAVE JSONS
    // fs.writeFileSync("DrupalMenus.json", JSON.stringify(drupalMenusExtracted, null, 2));
    // fs.writeFileSync("WordPressMenus.json", JSON.stringify(wpMenusExtracted, null, 2));

    // console.log("💾 Saved extract JSONs, reloading from file...");

    // RE-LOAD for comparison
    const drupalMenus = JSON.parse(fs.readFileSync("DrupalMenus.json", "utf8"));
    const wpMenus = JSON.parse(fs.readFileSync("WordPressMenus.json", "utf8"));

    let results = [];

    for (const d of drupalMenus) {
        const wpMatch = wpMenus.find(w =>
            w.menuSlug.replace(/\[term-id.*?\]/gi, "").trim() === d.menuId.trim()
        );

        if (!wpMatch) {
            results.push({
                Node: d.menuTitle,
                Item: "",
                Issue: "WP menu missing",
                DrupalURL: "",
                WordPressURL: ""
            });
            continue;
        }

        results.push(...MenuComparator.compare(d.items, wpMatch.items));
    }

    fs.writeFileSync("MenuComparison.json", JSON.stringify(results, null, 2));
    await finalFactory.utility.saveToExcel("menuHtmlsComparison.xlsx", "menuHtmlsComparison", results, "comparison");

    console.log("🎉 DONE!");
});
