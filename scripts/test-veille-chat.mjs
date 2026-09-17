import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { chatAboutRdcOffer } from '../src/services/rdcOfferAdviceService.js';

await connectDb(process.env.MONGODB_URI);

const questions = [
  "J'ai combien d'offres actives ?",
  'Quelles sont les 3 offres les plus pertinentes pour Maison ECAL cette semaine et pourquoi ?',
  'Aide-moi à comprendre pourquoi UNGM remonte plus d’offres que ARSP'
];

for (const message of questions) {
  console.log('\n==== USER ====\n', message);
  const result = await chatAboutRdcOffer({ message, offers: [], history: [] });
  console.log('provider:', result.provider);
  console.log(result.reply);
}

await mongoose.disconnect();
process.exit(0);
