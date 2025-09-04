import { credentials } from "../data/credentials.js";

export class WordPressLogin {
  constructor(page) {
    this.page = page;
  }

  async loginToWordPress() {
    await this.page.goto(credentials.wordPress.url, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await this.page.getByRole('textbox', { name: 'Username' }).click();
    await this.page.getByRole('textbox', { name: 'Username' }).fill(credentials.wordPress.username);
    await this.page.getByRole('textbox', { name: 'Password' }).click();
    await this.page.getByRole('textbox', { name: 'Password' }).fill(credentials.wordPress.password);
    await this.page.getByRole('button', { name: 'Log in' }).click();
    await this.page.waitForSelector('#wpadminbar', { state: 'visible', timeout: 30000 });
    
  }
}