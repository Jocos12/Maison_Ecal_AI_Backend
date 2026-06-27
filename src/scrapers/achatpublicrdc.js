import { scrapeArmpCategory, logScraperError } from './utils.js';

/** Avis d'appels d'offres — portail SIGMAP / ARMP (remplace achatpublic.cd, hors ligne). */
export async function scrapeAchatPublicRdc() {
  try {
    return await scrapeArmpCategory('avis-dappels-doffre', {
      platform: 'AchatPublicRDC',
      limit: 50,
      maxPages: 5
    });
  } catch (e) {
    logScraperError('AchatPublicRDC', e);
    return [];
  }
}
