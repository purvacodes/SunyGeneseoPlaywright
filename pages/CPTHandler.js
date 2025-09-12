import { contentPostTypesUrls } from '../data/contentPostTypesUrls.js';
import { credentials } from '../data/credentials.js';
import { Utility } from './Utility.js';

export class CPTHandler {
  constructor(wordPress, page) {
    this.env = credentials.env.wordPress;
    this.postTypeBasePath = contentPostTypesUrls.wordPress.postTypeBasePath;
    this.wordPress = wordPress; 
    this.page = page;
  }

  async navigateToCPTPagesListing(cpt) {
    await this.wordPress.loginToWordPress();
    const cptUrl = `${this.env}${this.postTypeBasePath}${cpt}`;
    await this.page.goto(cptUrl, { timeout: 60000 });
    await this.page.waitForLoadState('networkidle', { timeout: 60000 });
  }

  async getCPTUrls(cpt) {
    await this.navigateToCPTPagesListing(cpt);
    await this.utility.setItemsPerPage();
    const allUrls = await this.utility.scrapePaginatedUrls(this.page);

    const fileName = `${cpt}TotalUrlsListing.xlsx`;
    const sheetName = `${cpt}-urls`;
    const subfolder = "broken-media";
    this.utility.saveToExcel(fileName, sheetName, allUrls, subfolder);
  }
}
