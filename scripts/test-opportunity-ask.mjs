import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Opportunity from '../src/models/Opportunity.js';
import { answerOpportunityQuestion } from '../src/services/opportunityAskService.js';

const uri = process.env.MONGODB_URI;
await connectDb(uri);

const opp = await Opportunity.findOne({ isArchived: { $ne: true } })
  .sort({ isRecommended: -1, createdAt: -1 })
  .select('_id title organization description platform')
  .lean();

if (!opp) {
  console.error('Aucune offre en base pour le test.');
  process.exit(1);
}

const question = 'Cette offre concerne-t-elle les services logistiques de Maison ECAL, et que faut-il envoyer pour postuler ?';
const result = await answerOpportunityQuestion({
  id: String(opp._id),
  message: question,
  messages: []
});

console.log(
  JSON.stringify(
    {
      opportunityId: result.opportunityId,
      title: result.title,
      warning: result.warning || null,
      question,
      replyPreview: String(result.reply || '').slice(0, 800)
    },
    null,
    2
  )
);

await mongoose.disconnect();
