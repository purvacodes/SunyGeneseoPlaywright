import { test } from "@playwright/test";
import { createObjects } from "../../pages/ObjectFactory.js";
import { credentials } from "../../data/credentials.js";

test.setTimeout(60 * 60 * 1000);

test("Extract all Role Mapping input values", async ({ page }) => {
  const objectFactory = createObjects(page);

  // ---- STEP 1: Login to WordPress ----
   await page.goto(
    "https://dev-suny-geneseo.pantheonsite.io/wp-admin/admin.php?page=mo_saml_settings&tab=role_mapping", { timeout: 60000, waitUntil: "domcontentloaded" }
  );

  //await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Username" }).fill(credentials.wordPress.username);
  await page.getByRole("textbox", { name: "Password" }).fill(credentials.wordPress.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForSelector("#wpadminbar", { state: "visible", timeout: 100000 });

   //---- STEP 2: Navigate to Role Mapper page ----

  await page.waitForSelector("tr.mo-saml-role-row");

  // ---- STEP 3: Extract and print all input values ----
  const inputs = await page.locator("tr.mo-saml-role-row input[type='text']");
  const count = await inputs.count();

  console.log(`✅ Found ${count} role mapping input fields:\n`);

  for (let i = 0; i < count; i++) {
    const name = await inputs.nth(i).getAttribute("name");
    const value = await inputs.nth(i).inputValue();
    console.log(value);
  }

  console.log("\n✅ Extraction complete.");
  // await page.goto(
  //  "https://whatismyipaddress.com/", { timeout: 60000, waitUntil: "domcontentloaded" }
  // );
  // await new Promise(() => { });
});
