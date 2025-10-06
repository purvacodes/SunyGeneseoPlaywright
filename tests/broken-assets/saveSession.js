import { chromium } from 'playwright';
import { credentials } from '../../data/credentials.js';
const STORAGE_FILE = './test-artifacts/session.json';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(credentials.hostinger.url);
  await page.getByRole('textbox', { name: 'Username' }).fill(credentials.hostinger.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(credentials.hostinger.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('#wpadminbar', { state: 'visible' });

  await context.storageState({ path: STORAGE_FILE });
  console.log('✅ Session saved');

  await browser.close();
})();
