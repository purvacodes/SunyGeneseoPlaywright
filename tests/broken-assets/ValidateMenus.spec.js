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
    return slug
        ?.replace(/-?\[term-id.*?\]/gi, "")   // remove prefix dash + term-id block
        ?.replace(/-0$/, "")                 // your previous rule
        ?.trim();
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
    console.log("🔍 Starting compareMenus -- Drupal:", drupalMenus.length, "WP:", wpMenus.length);

    const rows = [];

    for (const dMenu of drupalMenus) {

        const slug = this.normalizeSlug(dMenu.menuId);
        const wpMenu = wpMenus.find(w => this.normalizeSlug(w.menuSlug) === slug);

        console.log(`\n==============================`);
        console.log(`🔎 Comparing Menu: ${dMenu.menuTitle}`);
        console.log(`Drupal menuId: ${dMenu.menuId}`);
        console.log(`WordPress normalizedSlug: ${slug}`);
        console.log(`==============================\n`);

        rows.push({
            WhichMenu: slug,
            WhichItem: "MENU",
            DrupalValue: dMenu.menuTitle,
            WordPressValue: wpMenu?.menuTitle || "",
            Status: wpMenu ? "OK" : "Missing in WP",
        });

        if (!wpMenu) {
            console.log(`❌ WP menu missing: ${slug}`);
            continue;
        }

        this.compareItems(dMenu.items, wpMenu.items, slug, "ITEM", rows);
    }

    return rows;
}


static compareItems(dItems, wItems, menuId, level, rows) {

    if (!dItems || dItems.length === 0) {
        console.log(`⚠ No Drupal ${level}s.`);
    }
    if (!wItems || wItems.length === 0) {
        console.log(`⚠ No WordPress ${level}s.`);
    }

    const used = new Set();

    for (const d of dItems) {

        console.log(`  🔸 Compare ${level}:`);
        console.log(`      Drupal title: ${d.title}`);
        console.log(`      Drupal href: ${this.normalizeHref(d.href)}`);

        const matchIndex = wItems.findIndex(
            (w, i) =>
                !used.has(i) &&
                (w.title?.trim() === d.title?.trim() ||
                 this.normalizeHref(w.href) === this.normalizeHref(d.href))
        );

        if (matchIndex === -1) {
            console.log("      ❌ No match found in WP\n");

            rows.push({
                WhichMenu: menuId,
                WhichItem: `${level}_TITLE`,
                DrupalValue: d.title,
                WordPressValue: "",
                Status: "Missing in WP",
            });

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

        console.log(`      WP title: ${w.title}`);
        console.log(`      WP href: ${this.normalizeHref(w.href)}`);
        console.log(`      ✔ Match found at index ${matchIndex}\n`);

        const nextLevel =
            level === "ITEM" ? "CHILD" :
            level === "CHILD" ? "SUBCHILD" :
            "SUBCHILD";

        this.compareItems(d.children || [], w.children || [], menuId, nextLevel, rows);
    }
}


}


/* ======================================================================
   MAIN TEST (UPDATED)
====================================================================== */
test.setTimeout(15 * 60 * 60 * 1000);

test("🔥 Full Drupal vs WordPress Menu Comparison", async ({ page }) => {

    // const drupalFile = "file://" + path.resolve(__dirname, "Drupalv3.html");
    // const wpFile = "file://" + path.resolve(__dirname, "WordpressV3.html");

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

   console.log("\n\n============================");
console.log("🔥 RUNNING MENU COMPARATOR");
console.log("============================\n");

const results = MenuComparator.compareMenus(drupalMenus, wpMenus);
    await finalFactory.utility.saveToExcel("menuHtmlsComparison.xlsx", "menuHtmlsComparison", results, "comparison");
});
