import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

await connectDb(process.env.MONGODB_URI);

const offer = await Opportunity.findOne({
  $or: [
    { title: /drones?\s+civils/i },
    { title: /Plan de Gestion de l['’]Utilisation des Drones/i },
    { title: /AMI\s*N[°º]?\s*041.*PACT/i },
    { sourceUrl: /drones|pact.*041/i }
  ]
}).lean();

if (!offer) {
  const loose = await Opportunity.find({
    platform: { $in: ['ProfilRDC', 'AchatPublicRDC'] },
    title: /consultant firme|PACT/i
  })
    .select('title sourceUrl isArchived deadline')
    .limit(20)
    .lean();
  console.log(JSON.stringify({ error: 'introuvable', candidates: loose }, null, 2));
  await mongoose.disconnect();
  process.exit(1);
}

await Opportunity.updateOne(
  { _id: offer._id },
  {
    $set: {
      isArchived: true,
      isNew: false,
      isRecommended: false,
      deadlineUnspecified: false,
      deadline: new Date('2026-08-21T13:00:00.000Z'),
      expiredReason: 'deadline_passed'
    }
  }
);

const after = await Opportunity.findById(offer._id)
  .select('title isArchived deadline isRecommended expiredReason')
  .lean();
const stillActive = await Opportunity.countDocuments({
  $and: [{ _id: offer._id }, activeOpportunityFilter()]
});

console.log(JSON.stringify({ before: { id: offer._id, title: offer.title, isArchived: offer.isArchived }, after, stillActive }, null, 2));
await mongoose.disconnect();
