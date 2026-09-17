const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SKIP = /noreply|no-reply|donotreply|example\.com|sentry\.|wixpress|placeholder/i;

export function extractContactEmails(text = '') {
  const found = String(text || '').match(EMAIL_RE) || [];
  const unique = [];
  for (const raw of found) {
    const email = raw.toLowerCase();
    if (SKIP.test(email)) continue;
    if (!unique.includes(email)) unique.push(email);
  }
  return unique;
}

export function extractOpportunityContactEmail(opp = {}) {
  if (opp.contactPerson?.email) return String(opp.contactPerson.email).trim();
  const blobs = [
    opp.contactEmail,
    opp.email,
    opp.description,
    opp.title,
    opp.organization,
    opp.notes
  ]
    .filter(Boolean)
    .join('\n');
  return extractContactEmails(blobs)[0] || '';
}
