import { DrupalLogin } from "./DrupalLogin.js";
import { wordPressLogin } from "./wordPressLogin.js";
import { Taxonomy } from "./Taxonomy.js";

export const createObjects = (page) => {
  const drupal = new DrupalLogin(page);
  const wordPress = new wordPressLogin(page);
  const taxonomy = new Taxonomy(page, drupal, wordPress);
  return { drupal, wordPress, taxonomy };
};