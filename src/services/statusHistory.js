/** Append a status only when it actually changes. Never fills in steps that were not recorded. */
export function rememberStatus(doc, status, at = new Date()) {
  if (!doc || !status) return;
  if (!Array.isArray(doc.statusEvents)) doc.statusEvents = [];
  const last = doc.statusEvents[doc.statusEvents.length - 1];
  if (last && last.status === status) return;
  doc.statusEvents.push({ status, at });
}

/**
 * Recorded changes, oldest first.
 * If nothing was logged yet, one point: the status stored today, dated at the document's last update.
 * That point is marked recorded:false so the UI does not present it as a tracked change.
 */
export function knownTimeline(doc) {
  const events = (Array.isArray(doc?.statusEvents) ? doc.statusEvents : [])
    .filter((event) => event?.status && event?.at)
    .map((event) => ({ status: event.status, at: event.at, recorded: true }));
  if (events.length) return events;
  const at = doc?.updatedAt || doc?.createdAt || null;
  if (!doc?.status || !at) return [];
  return [{ status: doc.status, at, recorded: false }];
}
