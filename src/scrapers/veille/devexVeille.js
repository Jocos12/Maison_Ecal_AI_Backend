/**
 * DevEx — veille complémentaire RDC logistique (FR/EN).
 * Réutilise le scraper existant sans le modifier ; filtre au niveau veille uniquement.
 */
import { scrapeDevex } from '../devex.js';
import { filterDevexVeilleItems } from '../../config/veilleSourceFilters.js';
import logger from '../../utils/logger.js';

export async function scrapeDevexVeille() {
  const raw = await scrapeDevex();
  const items = filterDevexVeilleItems(raw);
  logger.info(`DevExVeille: ${raw.length} raw → ${items.length} après filtre RDC/logistique`);
  return items.map((item) => ({
    ...item,
    platform: 'DevEx',
    location: item.location || 'RDC — Democratic Republic of the Congo'
  }));
}
