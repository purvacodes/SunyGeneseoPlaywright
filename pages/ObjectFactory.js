import { DrupalLogin } from "./DrupalLogin.js";
import { WordPressLogin } from "./WordPressLogin.js";
import { Taxonomy } from "./Taxonomy.js";

export const createObjects = (page) => {
  const drupal = new DrupalLogin(page);
  const wordPress = new WordPressLogin(page);
  const taxonomy = new Taxonomy(page, drupal, wordPress);
  return { drupal, wordPress, taxonomy };
};