import * as cheerio from 'cheerio';

const FR_MONTHS = {
  janvier: 0,
  janv: 0,
  january: 0,
  jan: 0,
  fevrier: 1,
  février: 1,
  fevr: 1,
  févr: 1,
  february: 1,
  feb: 1,
  mars: 2,
  march: 2,
  mar: 2,
  avril: 3,
  avr: 3,
  april: 3,
  apr: 3,
  mai: 4,
  may: 4,
  juin: 5,
  june: 5,
  jun: 5,
  juillet: 6,
  juil: 6,
  july: 6,
  jul: 6,
  aout: 7,
  août: 7,
  august: 7,
  aug: 7,
  septembre: 8,
  sept: 8,
  september: 8,
  sep: 8,
  octobre: 9,
  oct: 9,
  october: 9,
  novembre: 10,
  nov: 10,
  november: 10,
  decembre: 11,
  décembre: 11,
  dec: 11,
  december: 11
};

const DEADLINE_HINT =
  /date\s*(de\s*)?(cl[oô]ture|limite|limite\s+de\s+(d[ée]p[ôo]t|soumission|remise)|d['’]expiration)|cl[oô]ture|deadline|closing(\s+date)?|due\s+date|submission\s+deadline|expiry|expiration|avis\s+valable\s+jusqu|au plus tard|avant le|jusqu['’]au|d[ée]p[ôo]t des (offres|plis)|remise des offres/i;

const POSTED_HINT =
  /date\s*(de\s*)?(publication|parution|mise\s+en\s+ligne)|publi[ée]e?\s+le|posted(\s+on)?|published(\s+on)?|issu(ed)?(\s+on)?|date\s+de\s+l['’]avis/i;

function collapse(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 2005 || y > 2040) return null;
  return d;
}

function fromParts(day, month, year) {
  const y = Number(year);
  const d = Number(day);
  const m = Number(month);
  if (!y || !d || Number.isNaN(m) || m < 0 || m > 11 || d < 1 || d > 31) return null;
  return validDate(new Date(Date.UTC(y, m, d, 12, 0, 0)));
}

export function parseLooseDate(raw) {
  const text = collapse(raw);
  if (!text) return null;

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2})?/);
  if (iso) {
    return fromParts(iso[3], Number(iso[2]) - 1, iso[1]);
  }

  const dmy = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    if (a > 12) return fromParts(a, b - 1, dmy[3]);
    if (b > 12) return fromParts(b, a - 1, dmy[3]);
    return fromParts(a, b - 1, dmy[3]);
  }

  const named = text.match(
    /(\d{1,2})\s+([A-Za-zÀ-ÿ.]{3,12})\.?\s+(\d{4})|([A-Za-zÀ-ÿ.]{3,12})\.?\s+(\d{1,2}),?\s+(\d{4})/
  );
  if (named) {
    if (named[1]) {
      const month = FR_MONTHS[named[2].toLowerCase().replace(/\./g, '')];
      if (month != null) return fromParts(named[1], month, named[3]);
    } else {
      const month = FR_MONTHS[named[4].toLowerCase().replace(/\./g, '')];
      if (month != null) return fromParts(named[5], month, named[6]);
    }
  }

  const ungm = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (ungm) {
    const month = FR_MONTHS[ungm[2].toLowerCase()];
    if (month != null) return fromParts(ungm[1], month, ungm[3]);
  }

  const fallback = new Date(text);
  return validDate(fallback);
}

function pickNearHint(text, hintRe) {
  const matches = [];
  const re = new RegExp(hintRe.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const slice = text.slice(m.index, m.index + 140);
    const parsed = parseLooseDate(slice);
    if (parsed) matches.push(parsed);
  }
  return matches[0] || null;
}

function collectAllDates(text) {
  const found = [];
  const patterns = [
    /(\d{4}-\d{2}-\d{2})/g,
    /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/g,
    /(\d{1,2}\s+[A-Za-zÀ-ÿ.]{3,12}\.?\s+\d{4})/g,
    /(\d{1,2}-[A-Za-z]{3}-\d{4})/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const d = parseLooseDate(m[1]);
      if (d) found.push(d);
    }
  }
  return found;
}

export function extractDatesFromText(raw) {
  const text = collapse(raw);
  if (!text) return { deadline: null, postedDate: null };

  let deadline = pickNearHint(text, DEADLINE_HINT);
  let postedDate = pickNearHint(text, POSTED_HINT);

  const all = collectAllDates(text);
  if (!deadline && all.length >= 2) {
    deadline = all.reduce((a, b) => (a > b ? a : b));
  } else if (!deadline && all.length === 1 && DEADLINE_HINT.test(text)) {
    deadline = all[0];
  }

  if (!postedDate && all.length >= 2) {
    postedDate = all.reduce((a, b) => (a < b ? a : b));
  } else if (!postedDate && all.length === 1 && POSTED_HINT.test(text)) {
    postedDate = all[0];
  }

  if (deadline && postedDate && deadline.getTime() === postedDate.getTime() && all.length < 2) {
    if (POSTED_HINT.test(text) && !DEADLINE_HINT.test(text)) deadline = null;
    if (DEADLINE_HINT.test(text) && !POSTED_HINT.test(text)) postedDate = null;
  }

  const uniqueDays = [...new Set(all.map((d) => d.toISOString().slice(0, 10)))];
  if (uniqueDays.length <= 1 && POSTED_HINT.test(text) && !DEADLINE_HINT.test(text)) {
    deadline = null;
  }

  return { deadline: deadline || null, postedDate: postedDate || null };
}

export function extractDatesFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  let postedDate = null;
  let deadline = null;

  $('time[datetime]').each((_, el) => {
    const parsed = parseLooseDate($(el).attr('datetime') || $(el).text());
    if (parsed && !postedDate) postedDate = parsed;
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      const posted = parseLooseDate(json?.datePosted);
      const through = parseLooseDate(json?.validThrough);
      if (posted && !postedDate) postedDate = posted;
      if (through && through.getUTCFullYear() < 2090) deadline = through;
    } catch {
      /* ignore invalid JSON-LD */
    }
  });

  $('script, style, noscript').remove();
  const labeled = $('[class*="deadline"], [class*="cloture"], [class*="closing"]').text();
  const fromLabel = extractDatesFromText(labeled);
  if (fromLabel.deadline) deadline = fromLabel.deadline;
  if (!postedDate) {
    postedDate = extractDatesFromText($('.job-published-date, time').text()).postedDate;
  }

  return {
    deadline: deadline && deadline.getUTCFullYear() < 2090 ? deadline : null,
    postedDate: postedDate || null
  };
}

export function enrichItemDates(item, extraText = '') {
  const blob = `${item.title || ''}\n${item.description || ''}\n${extraText}`;
  const found = extractDatesFromText(blob);
  return {
    ...item,
    deadline: item.deadline || found.deadline || null,
    postedDate: item.postedDate || found.postedDate || null
  };
}

export function startOfTodayKinshasa() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return new Date(`${y}-${m}-${d}T00:00:00+01:00`);
}

export function isDeadlineExpired(deadline, now = startOfTodayKinshasa()) {
  if (!deadline) return false;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now.getTime();
}
