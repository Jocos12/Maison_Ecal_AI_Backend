import { scrapeArmpCategory, logScraperError } from './utils.js';

/** Manifestations d'intérêt / consultances — portail ARMP (profilrdc.com n'existe plus). */
export async function scrapeProfilRdc() {
  try {
    return await scrapeArmpCategory('avis-a-manifestations-dinterets', {
      platform: 'ProfilRDC',
      limit: 50,
      maxPages: 5
    });
  } catch (e) {
    logScraperError('ProfilRDC', e);
    return [];
  }
}
