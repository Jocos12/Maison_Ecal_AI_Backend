import { countryCodeFrom, countryNameFrom, isRealCountryCode } from './nrcCountries.js';

/** African states. A workplace anywhere else stays out of /veille. */
const AFRICA = new Set(
  'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW EH'.split(
    ' '
  )
);

const REGION =
  /\b(east(?:ern)? africa|west(?:ern)? africa|central africa|southern africa|north(?:ern)? africa|sahel|horn of africa|afrique de l['’ ]est|afrique de l['’ ]ouest|afrique centrale|afrique australe|afrique du nord|corne de l['’]afrique)\b/i;

const VAGUE = /^(global( roving)?|remote|home[ -]?based|multiple locations?|\d+ locations?|worldwide|international|various|open to remote|fully remote)$/i;

function asReal(code) {
  const value = code === 'UK' ? 'GB' : code;
  return value && isRealCountryCode(value) ? value : '';
}

function codeOf(text) {
  const raw = String(text || '').trim();
  if (!raw || VAGUE.test(raw)) return '';
  const direct = asReal(countryCodeFrom(raw));
  if (direct) return direct;
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const fromPart = asReal(countryCodeFrom(parts[i]));
    if (fromPart) return fromPart;
    const lastWord = parts[i].split(/\s+/).pop();
    const fromWord = asReal(countryCodeFrom(lastWord));
    if (fromWord) return fromWord;
  }
  return '';
}

/**
 * Decide whether the real workplace is in Africa.
 * Country codes come from the structured location, not from the generic introduction of the offer.
 * One non-African workplace is enough to exclude the offer, even if another city is in Africa.
 */
export function classifyWorkplaces({ country = '', countryCode = '', location = '', additionalLocations = [] } = {}) {
  const labels = [location, ...additionalLocations].map((value) => String(value || '').trim()).filter(Boolean);
  const codes = [];
  const given = String(countryCode || '').toUpperCase();
  if (isRealCountryCode(given) || given === 'UK') codes.push(given === 'UK' ? 'GB' : given);
  const fromCountry = codeOf(country);
  if (fromCountry) codes.push(fromCountry);
  for (const label of labels) {
    if (VAGUE.test(label)) continue;
    const code = codeOf(label);
    if (code) codes.push(code);
  }
  const unique = [...new Set(codes)];
  const outside = unique.find((code) => !AFRICA.has(code));
  if (outside) {
    return {
      locationScope: 'outside',
      countryCode: outside,
      country: countryNameFrom(outside, country),
      isAfrica: false
    };
  }
  const inside = unique.find((code) => AFRICA.has(code));
  if (inside) {
    return {
      locationScope: 'africa',
      countryCode: inside,
      country: countryNameFrom(inside, country),
      isAfrica: true
    };
  }
  if (labels.some((label) => REGION.test(label))) {
    return { locationScope: 'africa', countryCode: '', country: country || 'Afrique', isAfrica: true };
  }
  return { locationScope: 'unverified', countryCode: '', country: '', isAfrica: false };
}
