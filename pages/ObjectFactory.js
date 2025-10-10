import { DrupalLogin } from "./DrupalLogin.js";
import { WordPressLogin } from "./WordPressLogin.js";
import { Taxonomy } from "./Taxonomy.js";
import { SiteScanner } from "./SiteScanner.js";
import { SiteAudit } from "./SiteAudit.js";
import { CPTHandler } from "./CPTHandler.js";
import { Utility } from "./Utility.js";

export const createObjects = (page, browser) => {
  const drupal = new DrupalLogin(page);
  const wordPress = new WordPressLogin(page);
  const taxonomy = new Taxonomy(page, drupal, wordPress);
  const utility = new Utility(wordPress, page);
  const siteScanner = new SiteScanner(utility);
  const siteAudit = new SiteAudit(utility);
  const cptHandler = new CPTHandler(wordPress, page);
 
  return { drupal, wordPress, taxonomy, siteScanner, siteAudit, cptHandler, utility };
};