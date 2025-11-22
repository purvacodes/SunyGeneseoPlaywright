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
async function extractWpItems(ulLocator, depth = 0, page) {
    const items = [];
    const indent = "  ".repeat(depth);

    console.log(`${indent}📁 Reading WP items at depth ${depth}...`);

    // --- GET LI ELEMENTS SAFELY ---
    const liLocator = ulLocator.locator(":scope > li.menu-item-box");

    let liCount = 0;
    try {
        liCount = await liLocator.count();
    } catch (err) {
        console.error(`${indent}❌ ERROR counting <li>:`, err);
        return items;
    }

    if (liCount === 0) {
        console.warn(`${indent}⚠ No <li> found at depth ${depth}. Retrying...`);
        await page.waitForTimeout(50);

        try {
            liCount = await liLocator.count();
        } catch { }

        console.warn(`${indent}➡ After retry: ${liCount} nodes`);
    }

    const liNodes = await liLocator.all();

    console.log(`${indent}Found ${liNodes.length} WP <li> nodes`);

    // --- PROCESS EACH LI SAFE ---
    for (let index = 0; index < liNodes.length; index++) {
        const li = liNodes[index];

        console.log(`${indent}────────── ITEM ${index} ──────────`);

        // TITLE
        let title = "";
        try {
            title = (await li.locator(".menu-item-title strong").first().textContent()).trim();
        } catch {
            console.warn(`${indent}⚠ Missing title`);
        }

        // HREF (THIS IS WHERE YOUR ERROR OCCURRED)
        let href = "";
        try {
            const aTag = li.locator(".menu-item-meta a").first();
            const aCount = await aTag.count();

            console.log(`${indent}🔍 aTag count = ${aCount}`);

            if (aCount > 0) {
                href = await aTag.getAttribute("href") || "";
                console.log(`${indent}🔗 href = ${href}`);
            } else {
                console.warn(`${indent}⚠ No <a> tag inside .menu-item-meta`);
            }
        } catch (err) {
            console.error(`${indent}❌ ERROR reading href:`, err);
        }

        // TEXT
        let text = "";
        try {
            text = await li.locator(".menu-item-meta").innerText();
        } catch {
            console.warn(`${indent}⚠ Missing .menu-item-meta text`);
        }

        const menuItem = new MenuItem({ title, href, text, children: [] });

        // CHILDREN
        let hasChildren = false;
        try {
            const classAttr = await li.getAttribute("class") || "";
            hasChildren = classAttr.includes("has-children");
            console.log(`${indent}📂 hasChildren = ${hasChildren}`);
        } catch (err) {
            console.error(`${indent}❌ ERROR checking children:`, err);
        }

        if (hasChildren) {
            const childUl = li.locator(":scope > ul[class*='menu-level']");
            menuItem.children = await extractWpItems(childUl, depth + 1, page);
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

    console.log(`${indent}▶ extractDrupalItems(depth=${depth})`);

    // DEBUG: Check UL count
    let ulCount = 0;
    try {
        ulCount = await ulLocator.count();
        console.log(`${indent}UL count = ${ulCount}`);
    } catch (err) {
        console.error(`${indent}❌ ERROR: ulLocator.count() failed`, err);
        return items;
    }

    if (ulCount === 0) {
        console.warn(`${indent}⚠ No UL at this depth — skipping`);
        return items;
    }

    // Get the LI nodes
    let liNodes = [];
    try {
        liNodes = await ulLocator.locator(":scope > li[class*='menu-item-box']").all();
        console.log(`${indent}Found ${liNodes.length} <li.menu-item-box>`);
    } catch (err) {
        console.error(`${indent}❌ ERROR getting LI nodes`, err);
        return items;
    }

    // --- Iterate LI nodes ---
    for (let idx = 0; idx < liNodes.length; idx++) {
        const li = liNodes[idx];

        console.log(`${indent}── LI[${idx}] ──`);

        // 1. Status badge
        let status = "";
        try {

            status = await li.locator(".status-badge").textContent() || "";
            status = status.trim();
        } catch { }
        console.log(`${indent}status = "${status}"`);

        const isDisabled = status.includes("Disabled") ||
            await li.locator(".status-badge.status-disabled").count() > 0;

        if (isDisabled) {
            console.log("⏭ Skipping disabled item");
            continue;   // <-- THIS IS THE FIX
        }


        // 2. Title
        let title = "";
        try {
            title = (await li.locator(".menu-item-title strong").first().textContent()).trim();
        } catch {
            console.warn(`${indent}⚠ Missing title`);
        }
        console.log(`${indent}title = "${title}"`);

        // 3. HREF
        let href = "";
        try {
            const link = li.locator(".menu-item-meta a").first();
            const linkCount = await link.count();
            console.log(`${indent}linkCount = ${linkCount}`);

            if (linkCount > 0) {
                href = await link.getAttribute("href") || "";
            }
        } catch (err) {
            console.error(`${indent}❌ ERROR getting href`, err);
        }
        console.log(`${indent}href = "${href}"`);

        // 4. Meta text
        let text = "";
        try {
            text = await li.locator(".menu-item-meta").innerText();
        } catch {
            console.warn(`${indent}⚠ Missing .menu-item-meta text`);
        }
        console.log(`${indent}text = "${text}"`);

        const menuItem = new MenuItem({ title, href, text, children: [] });

        // 5. Children check (THIS IS WHERE YOUR TEST WAS FREEZING)
        let hasChildren = false;
        try {
            const classAttr = await li.getAttribute("class");
            hasChildren = classAttr?.includes("has-children");
            console.log(`${indent}hasChildren = ${hasChildren}`);
        } catch (err) {
            console.error(`${indent}❌ ERROR reading class attribute`, err);
        }

        // 6. Recurse if children
        if (hasChildren) {
            const subUl = li.locator(":scope > ul[class*='menu-level']");
            console.log(`${indent}↳ Extracting children…`);
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
            ?.replace("https://dev-suny-geneseo.pantheonsite.io", "") 
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

            const dHref = this.normalizeHref(d.href);
            const wHref = this.normalizeHref(w.href);

            // Log matches
            console.log(`      WP title: ${w.title}`);
            console.log(`      WP href: ${wHref}`);
            console.log(`      ✔ Matched item found at index ${matchIndex}\n`);

            if (dHref !== wHref) {
                rows.push({
                    WhichMenu: menuId,
                    WhichItem: `${level}_HREF`,
                    DrupalValue: dHref,
                    WordPressValue: wHref,
                    Status: "❗ HREF Mismatch",
                });
            }

            // Continue with children
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

    console.log("💾 Saved extract JSONs, reloading from file...");

    // RE-LOAD for comparison
    const drupalMenus = JSON.parse(fs.readFileSync("DrupalMenus.json", "utf8"));
    const wpMenus = JSON.parse(fs.readFileSync("WordPressMenus.json", "utf8"));

    console.log("\n\n============================");
    console.log("🔥 RUNNING MENU COMPARATOR");
    console.log("============================\n");

    const results = MenuComparator.compareMenus(drupalMenus, wpMenus);
    await finalFactory.utility.saveToExcel("menuHtmlsComparison.xlsx", "menuHtmlsComparison", results, "comparison");
});
