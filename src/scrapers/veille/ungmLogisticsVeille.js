/**
 * UNGM — veille complémentaire logistique humanitaire RDC.
 * Réutilise le scraper existant sans le modifier ; filtre transport/entreposage/supply chain.
 */
import { scrapeUngm } from '../ungm.js';
import { filterUngmLogisticsVeilleItems } from '../../config/veilleSourceFilters.js';
import logger from '../../utils/logger.js';

export async function scrapeUngmLogisticsVeille() {
  const raw = await scrapeUngm();
  const items = filterUngmLogisticsVeilleItems(raw);
  logger.info(`UNGMVeille: ${raw.length} raw → ${items.length} après filtre logistique humanitaire RDC`);
  return items.map((item) => ({
    ...item,
    platform: 'UNGM',
    location: item.location || 'RDC — Democratic Republic of the Congo'
  }));
}
