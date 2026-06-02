import logger from '../utils/logger.js';
import { callAIForJSON, callAIText } from './aiService.js';

export async function callClaudeJson(prompt, fallback) {
  try {
    const result = await callAIForJSON(prompt);
    return { ...result.data, source: result.provider };
  } catch (e) {
    logger.warn(`IA JSON indisponible: ${e.message}`);
    return { ...fallback, source: 'fallback_local' };
  }
}

export async function callClaudeText(prompt, fallback) {
  try {
    return await callAIText(prompt, undefined, 2600);
  } catch (e) {
    logger.warn(`IA texte indisponible: ${e.message}`);
    return fallback;
  }
}
