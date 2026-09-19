/** Country names used by NRC (English) turned into ISO codes, and detection of the DR Congo in free text. */

const norm = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9()]+/g, ' ')
    .trim();

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const BY_NAME = new Map();
for (let a = 65; a <= 90; a += 1) {
  for (let b = 65; b <= 90; b += 1) {
    const code = String.fromCharCode(a, b);
    let name;
    try {
      name = regionNames.of(code);
    } catch {
      continue;
    }
    if (name && name !== code) BY_NAME.set(norm(name), code);
  }
}

const ALIASES = {
  'dr congo': 'CD',
  drc: 'CD',
  'd r c': 'CD',
  'democratic republic of the congo': 'CD',
  'democratic republic of congo': 'CD',
  'dr congo kinshasa': 'CD',
  'congo kinshasa': 'CD',
  'congo (kinshasa)': 'CD',
  'republic of the congo': 'CG',
  'congo brazzaville': 'CG',
  'occupied palestinian territory': 'PS',
  opt: 'PS',
  palestine: 'PS',
  'state of palestine': 'PS',
  syria: 'SY',
  iran: 'IR',
  russia: 'RU',
  'south korea': 'KR',
  'ivory coast': 'CI',
  'cote d ivoire': 'CI',
  turkey: 'TR',
  turkiye: 'TR',
  burma: 'MM',
  swaziland: 'SZ',
  'car': 'CF',
  uk: 'GB',
  usa: 'US',
  'south sudan': 'SS',
  'cabo verde': 'CV'
};

export function countryCodeFrom(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = norm(raw);
  if (ALIASES[key]) return ALIASES[key];
  if (BY_NAME.has(key)) return BY_NAME.get(key);
  // "Goma, DR Congo-Kinshasa": try the part after the last comma, then the part before a dash
  const tail = key.includes(',') ? norm(raw.split(',').pop()) : '';
  if (tail && (ALIASES[tail] || BY_NAME.has(tail))) return ALIASES[tail] || BY_NAME.get(tail);
  const beforeDash = norm(raw.split(/\s[-–]\s/)[0]);
  if (beforeDash && (ALIASES[beforeDash] || BY_NAME.has(beforeDash))) return ALIASES[beforeDash] || BY_NAME.get(beforeDash);
  return '';
}

/** True for a real country code; false for codes such as "WW" (worldwide) that NRC uses for remote roles. */
export function isRealCountryCode(code) {
  if (!/^[A-Z]{2}$/.test(String(code || ''))) return false;
  try {
    const name = regionNames.of(code);
    return Boolean(name) && name !== code && !/unknown/i.test(name);
  } catch {
    return false;
  }
}

export function countryNameFrom(code, fallback = '') {
  if (code === 'CD') return 'DR Congo';
  if (!isRealCountryCode(code)) return fallback;
  return regionNames.of(code) || fallback;
}

const DRC_PATTERN =
  /\b(dr\.?\s*congo|d\.?\s?r\.?\s?c\.?|democratic republic of (the )?congo|congo[- ]kinshasa|rdc|r[ée]publique d[ée]mocratique du congo|kinshasa|goma|bukavu|lubumbashi|kalemie|bunia|uvira|kolwezi|kisangani|mbuji[- ]mayi|kananga|kikwit|tanganyika|(north|south|nord|sud)[- ]kivu|ituri)\b/i;

export function isDrcNotice({ countryCode = '', country = '', location = '', title = '', text = '' } = {}) {
  if (countryCode === 'CD') return true;
  if (countryCode && countryCode !== 'CD') return DRC_PATTERN.test(`${title} ${location}`);
  return DRC_PATTERN.test(`${country} ${location} ${title} ${String(text).slice(0, 1500)}`);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COUNTRY_MATCHERS = [...BY_NAME.entries()]
  .filter(([name, code]) => name.length >= 4 && code !== 'NO' && code !== 'CG')
  .map(([name, code]) => ({ code, re: new RegExp(`\\b${escapeRe(name)}\\b`, 'gi') }));
COUNTRY_MATCHERS.push({ code: 'CD', re: /\b(dr congo|d\.?r\.?c\.?|democratic republic of the congo|rdc)\b/gi });
COUNTRY_MATCHERS.push({ code: 'PS', re: /\b(oPt|occupied palestinian territory|gaza|west bank)\b/gi });

/**
 * The country a tender is about when the list does not say it: the country code of the reference
 * ("NRC-NAT/NG/2026" is Nigeria) or the country named most often in the title and text.
 */
export function inferCountryCode({ title = '', reference = '', text = '' } = {}) {
  const ref = /NRC[-_/]?[A-Z]*[-_/]([A-Z]{2})[-_/]/i.exec(reference) || /\/([A-Z]{2})\/\d{4}/.exec(reference);
  if (ref && countryCodeFrom(ref[1]) && norm(regionNames.of(ref[1].toUpperCase()) || '') !== norm(ref[1])) {
    const code = ref[1].toUpperCase();
    if (regionNames.of(code) && regionNames.of(code) !== code) return code;
  }
  const scores = new Map();
  const blob = `${title}\n${title}\n${title}\n${String(text).slice(0, 6000)}`;
  for (const { code, re } of COUNTRY_MATCHERS) {
    re.lastIndex = 0;
    const hits = blob.match(re);
    if (hits) scores.set(code, (scores.get(code) || 0) + hits.length);
  }
  let best = '';
  let bestScore = 0;
  for (const [code, n] of scores) {
    if (n > bestScore) {
      best = code;
      bestScore = n;
    }
  }
  return best;
}
