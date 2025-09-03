import {credentials} from "../data/credentials.js";

export class DrupalLogin {
  constructor(page) {
    this.page = page;
  }

  async loginToDrupal() {
    await this.page.goto(credentials.drupal.url, { waitUntil: "domcontentloaded" });
    await this.page.getByRole("textbox", { name: "Username" }).fill(credentials.drupal.username);
    await this.page.getByRole("textbox", { name: "Password" }).fill(credentials.drupal.password);
    await this.page.getByRole("button", { name: "Log in" }).click();
    await this.page.waitForSelector('#toolbar-bar', { state: 'visible', timeout: 40000 });
  }
}