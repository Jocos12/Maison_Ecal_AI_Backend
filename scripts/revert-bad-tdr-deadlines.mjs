import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { activeOpportunityFilter } from '../src/services/opportunityLifecycle.js';

await connectDb(process.env.MONGODB_URI);

const bad = await Opportunity.updateMany(
  {
    platform: { $in: ['ProfilRDC', 'AchatPublicRDC'] },
    $or: [
      { deadline: { $gte: new Date('2029-01-01') } },
      { deadline: { $lt: new Date('2024-01-01') } }
    ]
  },
  { $set: { deadline: null, deadlineUnspecified: true } }
);

const kalamba = await Opportunity.findOne({ title: /kalamba\s*mbuji/i })
  .select('isArchived deadline isRecommended expiredReason title')
  .lean();
const activeKalamba = await Opportunity.countDocuments({
  $and: [{ _id: kalamba._id }, activeOpportunityFilter()]
});

console.log(
  JSON.stringify(
    { revertedBadTdrDates: bad.modifiedCount, kalamba, activeKalambaCount: activeKalamba },
    null,
    2
  )
);
await mongoose.disconnect();
