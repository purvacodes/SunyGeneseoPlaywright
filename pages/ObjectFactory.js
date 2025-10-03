import { DrupalLogin } from "./DrupalLogin.js";
import { WordPressLogin } from "./WordPressLogin.js";
import { Taxonomy } from "./Taxonomy.js";
import { SiteScannerOld } from "./SiteScannerOld.js";
import { SiteScanner } from "./SiteScanner.js";
import { CPTHandler } from "./CPTHandler.js";
import { Utility } from "./Utility.js";

export const createObjects = (page, browser) => {
  const drupal = new DrupalLogin(page);
  const wordPress = new WordPressLogin(page);
  const taxonomy = new Taxonomy(page, drupal, wordPress);
  const utility = new Utility(wordPress, page);
  const siteScannerOld = new SiteScannerOld(utility);
  const siteScanner = new SiteScanner(utility);
  const cptHandler = new CPTHandler(wordPress, page);
 
  return { drupal, wordPress, taxonomy, siteScannerOld, siteScanner, cptHandler, utility };
};