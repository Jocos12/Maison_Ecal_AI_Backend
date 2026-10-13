import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { fetchHtml } from '../src/scrapers/utils.js';
import { extractDeadlineFromArmpAttachments } from '../src/scrapers/pdfDeadline.js';
import { extractDatesFromHtml, isDeadlineExpired } from '../src/scrapers/dateExtract.js';
import { archiveInactiveOpportunities, activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

const ARMP_PLATFORMS = ['ProfilRDC', 'AchatPublicRDC'];

await connectDb(process.env.MONGODB_URI);

const offers = await Opportunity.find({
  platform: { $in: ARMP_PLATFORMS },
  $or: [{ deadline: null }, { deadline: { $exists: false } }, { deadlineUnspecified: true }]
})
  .select('title platform sourceUrl deadline isArchived deadlineUnspecified postedDate')
  .lean();

const stats = {
  scanned: offers.length,
  htmlDeadline: 0,
  pdfFiles: 0,
  pdfDateExtracted: 0,
  imageScans: 0,
  ocrNeeded: 0,
  ocrDateExtracted: 0,
  datesRecovered: 0,
  archivedExpiredFromOcr: 0,
  manualReview: 0,
  errors: 0
};
const reviewSamples = [];

for (const offer of offers) {
  if (!offer.sourceUrl) continue;
  try {
    const html = await fetchHtml(offer.sourceUrl);
    const htmlDates = extractDatesFromHtml(html);
    let deadline = htmlDates.deadline;
    let provider = deadline ? 'html' : null;
    if (deadline) stats.htmlDeadline += 1;

    const att = await extractDeadlineFromArmpAttachments(html, offer.sourceUrl, {
      maxImages: 4,
      postedDate: offer.postedDate
    });
    stats.pdfFiles += att.pdfCount;
    stats.imageScans += att.imageCount;
    if (att.ocrNeeded) stats.ocrNeeded += 1;
    if (att.review) {
      stats.manualReview += 1;
      if (reviewSamples.length < 25) {
        reviewSamples.push({
          title: offer.title?.slice(0, 120),
          reason: att.review.reason,
          guessed: att.review.deadline,
          url: att.review.url
        });
      }
    }
    if (!deadline && att.deadline) {
      deadline = att.deadline;
      provider = att.provider || 'ocr';
      if (provider === 'pdf-text') stats.pdfDateExtracted += 1;
      else stats.ocrDateExtracted += 1;
    }

    if (deadline) {
      stats.datesRecovered += 1;
      const expired = isDeadlineExpired(deadline);
      if (expired) stats.archivedExpiredFromOcr += 1;
      await Opportunity.updateOne(
        { _id: offer._id },
        {
          $set: {
            deadline,
            deadlineUnspecified: false,
            ...(expired
              ? {
                  isArchived: true,
                  isNew: false,
                  isRecommended: false,
                  expiredReason: 'deadline_passed'
                }
              : {})
          }
        }
      );
    }
  } catch (e) {
    stats.errors += 1;
    console.warn(offer.title?.slice(0, 80), e.message);
  }
}

const archived = await archiveInactiveOpportunities();
const remainingUnspecified = await Opportunity.countDocuments({
  platform: { $in: ARMP_PLATFORMS },
  isArchived: false,
  $or: [{ deadline: null }, { deadline: { $exists: false } }, { deadlineUnspecified: true }]
});

const kalambaActive = await Opportunity.countDocuments({
  $and: [{ title: /kalamba\s*mbuji/i }, activeOpportunityFilter()]
});
const pactActive = await Opportunity.countDocuments({
  $and: [{ title: /drones?\s+civils/i }, activeOpportunityFilter()]
});

console.log(
  JSON.stringify(
    {
      stats,
      archivedAfterRule: archived,
      remainingUnspecifiedActive: remainingUnspecified,
      kalambaActive,
      pactDronesActive: pactActive,
      reviewSamples
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(0);
