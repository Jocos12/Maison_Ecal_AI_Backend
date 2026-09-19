import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { fetchBuffer, fetchHtml, fetchJson } from './utils.js';
import { extractDatesFromText, parseLooseDate } from './dateExtract.js';

/**
 * Norwegian Refugee Council: tenders (nrc.no/procurement) and job vacancies (NRC careers portal, Oracle HCM).
 *
 * nrc.no asks crawlers for a 20 second pause between requests (robots.txt, Crawl-delay: 20), so every request to
 * nrc.no goes through `politeGet`. The job portal is a separate host with a public JSON API.
 */
export const NRC_ORIGIN = 'https://www.nrc.no';
export const NRC_CRAWL_DELAY_MS = Math.max(0, Number(process.env.NRC_CRAWL_DELAY_MS ?? 20000));

const JOBS_ORIGIN = 'https://ekum.fa.em2.oraclecloud.com';
const JOBS_SITE = 'CX_2019';
const JOBS_DELAY_MS = 700;

let lastNrcRequestAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeGet(fn) {
  const wait = lastNrcRequestAt + NRC_CRAWL_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await fn();
  } finally {
    lastNrcRequestAt = Date.now();
  }
}

const abs = (href) => {
  try {
    return new URL(href, NRC_ORIGIN).toString();
  } catch {
    return '';
  }
};

/** A calendar day (as parsed on this server) stored as noon UTC, so it shows the same day in every time zone. */
function dayNoonUtc(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
}

const clean = (value) => String(value || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();

/** HTML fragment to readable text: paragraphs and list items each on their own line. */
export function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false);
  $('br').replaceWith('\n');
  $('p,li,h1,h2,h3,h4,h5,h6,tr,div').each((_, el) => {
    $(el).append('\n');
  });
  $('li').each((_, el) => {
    $(el).prepend('• ');
  });
  return $('#root')
    .text()
    .split('\n')
    .map((line) => clean(line))
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------- tenders

/** The 15 latest tenders of nrc.no/procurement: title, slug, publication date and country. */
export function parseTenderList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('a.article-list-view-model__wrapper[href^="/tender/"]').each((_, a) => {
    const href = $(a).attr('href');
    const title = clean($(a).find('h2').first().text());
    const tags = clean($(a).find('.article-list-view-model__tags').text());
    const [datePart, ...rest] = tags.split('|');
    if (!href || !title) return;
    out.push({
      slug: href.split('/').filter(Boolean).pop(),
      url: abs(href),
      title,
      postedDate: dayNoonUtc(parseLooseDate(clean(datePart))),
      country: clean(rest.join('|'))
    });
  });
  return out;
}

const TYPE_RULES = [
  [/expression of interest|\beoi\b/i, 'EoI'],
  [/request for proposals?|\brfp\b/i, 'RFP'],
  [/request for quotations?|\brfq\b/i, 'RFQ'],
  [/invitation to (bid|tender)|\bitb\b|\bitt\b/i, 'ITB'],
  [/call for (proposals?|applications?|expressions)/i, 'Call'],
  [/consultanc|consultant/i, 'Consultancy']
];

export function detectTenderType(...parts) {
  const text = parts.filter(Boolean).join(' ');
  for (const [pattern, label] of TYPE_RULES) if (pattern.test(text)) return label;
  return 'Tender';
}

const MONTH_DATE =
  '(\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?[A-Za-z]{3,9}\\.?,?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4})';
const DEADLINE_RE = new RegExp(
  `(?:deadline|no later than|closing date|closing|submission date|submit(?:ted)?[^.\\n]{0,40}?(?:by|before|until)|due (?:date|by)|before|until)[^.\\n]{0,70}?${MONTH_DATE}`,
  'i'
);

export function extractTenderDeadline(text, postedDate) {
  const m = DEADLINE_RE.exec(text);
  if (m) {
    const d = dayNoonUtc(parseLooseDate(m[1]));
    if (d) return d;
  }
  const { deadline } = extractDatesFromText(text);
  if (deadline && (!postedDate || deadline.getTime() > new Date(postedDate).getTime())) return dayNoonUtc(deadline);
  return null;
}

function extractReference(text, boldTexts) {
  for (const b of boldTexts) {
    const m = /[“"']([^”"']{4,60})[”"']/.exec(b);
    if (m && /\d/.test(m[1]) && /[A-Z/-]/.test(m[1])) return clean(m[1]);
  }
  const m =
    /\b(\d{1,4}\/NRC[-\w/]*\d{2,4})\b/i.exec(text) ||
    /\b(?:ref(?:erence)?(?:\s*(?:no\.?|number|n°))?|tender\s*(?:no\.?|number)|rfq|rfp|itb|eoi)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/._-]{4,40})/i.exec(text);
  return m ? clean(m[1]) : '';
}

function extractSubject(text) {
  const m =
    /(?:titled|entitled|subject(?:\s*line)?(?:\s*of the email)?|email subject)[^“"'\n]{0,50}[“"']([^”"'\n]{6,200})[”"']/i.exec(text) ||
    /[“"']((?:EoI|RFP|RFQ|ITB|Tender|Bid|Application)[^”"'\n]{6,200})[”"']/.exec(text);
  return m ? clean(m[1]) : '';
}

export function parseTenderDetail(html, url) {
  const $ = cheerio.load(html);
  const title = clean($('h1').first().text());
  const intro = clean($('.article-page__intro').first().text());
  const publishedText = clean($('.article-page__author-history').first().text());
  const postedDate = dayNoonUtc(parseLooseDate(publishedText.replace(/^published\s*/i, '')));
  const rich = $('.article-page__rich-text').first();
  const boldTexts = rich
    .find('strong,b')
    .map((_, el) => clean($(el).text()))
    .get();
  const text = htmlToText(rich.html() || '');
  const emails = [
    ...new Set(
      rich
        .find('a[href^="mailto:"]')
        .map((_, el) => clean($(el).attr('href').replace(/^mailto:/i, '').split('?')[0]).toLowerCase())
        .get()
        .filter(Boolean)
    )
  ];
  const documents = [];
  $('.file-download__wrapper a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    documents.push({
      label: clean($(a).find('.filename').text()) || decodeURIComponent(href.split('/').pop() || ''),
      url: abs(href),
      size: clean($(a).find('.size').text())
    });
  });
  return {
    title,
    url,
    postedDate,
    noticeType: detectTenderType(intro, title, text.slice(0, 400)),
    description: text,
    contactEmails: emails,
    submissionSubject: extractSubject(text),
    reference: extractReference(text, boldTexts),
    deadline: extractTenderDeadline(text, postedDate),
    documents
  };
}

export async function fetchTenderList() {
  const html = await politeGet(() => fetchHtml(`${NRC_ORIGIN}/procurement`));
  return parseTenderList(html);
}

export async function fetchTenderDetail(url) {
  const html = await politeGet(() => fetchHtml(url));
  return parseTenderDetail(html, url);
}

/** Text of an attached tender document (.docx or .pdf), capped: it feeds the brief and the draft. */
export async function fetchAttachmentText(doc, { maxChars = 14000 } = {}) {
  const url = doc?.url;
  if (!url) return '';
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  if (!['docx', 'pdf'].includes(ext)) return '';
  try {
    const { buffer } = await politeGet(() => fetchBuffer(url, { timeout: 60000 }));
    if (buffer.length > 12 * 1024 * 1024) return '';
    if (ext === 'docx') {
      const mod = await import('mammoth');
      const mammoth = mod.default || mod;
      const { value } = await mammoth.extractRawText({ buffer });
      return clean(value).length ? value.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars) : '';
    }
    const mod = await import('pdf-parse');
    const pdfParse = mod.default || mod;
    const { text } = await pdfParse(buffer);
    return String(text || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  } catch (e) {
    logger.warn(`NRC: pièce jointe illisible (${url}): ${e.message}`);
    return '';
  }
}

// ---------------------------------------------------------------- jobs

const jobsApi = (path) => `${JOBS_ORIGIN}/hcmRestApi/resources/latest/${path}`;
export const jobPublicUrl = (id) => `${JOBS_ORIGIN}/hcmUI/CandidateExperience/en/sites/${JOBS_SITE}/job/${id}`;

/** Every open vacancy of the NRC careers portal (public JSON API of the portal). */
export async function fetchJobList({ pageSize = 25, maxJobs = 400 } = {}) {
  const out = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && out.length < maxJobs) {
    const url = jobsApi(
      `recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${JOBS_SITE},limit=${pageSize},offset=${offset},sortBy=POSTING_DATES_DESC`
    );
    const data = await fetchJson(url, { headers: { Accept: 'application/json' } });
    const head = data?.items?.[0] || {};
    total = Number(head.TotalJobsCount ?? 0);
    const rows = head.requisitionList || [];
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        id: String(r.Id),
        title: clean(r.Title),
        postedDate: r.PostedDate ? new Date(r.PostedDate) : null,
        location: clean(r.PrimaryLocation),
        countryCode: clean(r.PrimaryLocationCountry).toUpperCase(),
        workplace: clean(r.WorkplaceType),
        schedule: clean(r.JobSchedule)
      });
    }
    offset += rows.length;
    await sleep(JOBS_DELAY_MS);
  }
  return out;
}

export async function fetchJobDetail(id) {
  const url = jobsApi(
    `recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(id)}%22,siteNumber=${JOBS_SITE}`
  );
  const data = await fetchJson(url, { headers: { Accept: 'application/json' } });
  const r = data?.items?.[0];
  await sleep(JOBS_DELAY_MS);
  if (!r) return null;
  const parts = [r.ExternalDescriptionStr, r.ExternalResponsibilitiesStr, r.ExternalQualificationsStr]
    .filter(Boolean)
    .map((html) => htmlToText(html));
  return {
    title: clean(r.Title),
    postedDate: r.ExternalPostedStartDate ? new Date(r.ExternalPostedStartDate) : null,
    deadline: r.ExternalPostedEndDate ? new Date(r.ExternalPostedEndDate) : null,
    location: clean(r.PrimaryLocation),
    countryCode: clean(r.PrimaryLocationCountry).toUpperCase(),
    reference: clean(r.Id || r.RequisitionId),
    description: parts.join('\n\n'),
    contactName: clean(r.ExternalContactName),
    contactEmails: r.ExternalContactEmail ? [clean(r.ExternalContactEmail).toLowerCase()] : [],
    jobInfo: {
      category: clean(r.Category),
      schedule: clean(r.JobSchedule),
      workplace: clean(r.WorkplaceType),
      grade: clean(r.JobGrade),
      level: clean(r.JobLevel),
      contract: clean(r.ContractType)
    }
  };
}
