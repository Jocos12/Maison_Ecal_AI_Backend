import '../src/loadEnv.js';
import mongoose from 'mongoose';
import { answerInLocalMode } from '../src/services/localModeAssistant.js';

const uri = process.env.MONGODB_URI?.trim() || 'mongodb://127.0.0.1:27017/mecal_monitor';
await mongoose.connect(uri);

const scenarios = [
  {
    id: 'count',
    lastUser: "combien d'offres actives",
    messages: []
  },
  {
    id: 'city',
    lastUser: 'Quelles offres à Bukavu ?',
    messages: []
  },
  {
    id: 'followup',
    lastUser: 'oui',
    messages: [
      { role: 'user', content: 'Je cherche des offres à Bukavu' },
      { role: 'assistant', content: 'Voici ce que la base contenait pour Bukavu.' }
    ]
  },
  {
    id: 'complex',
    lastUser:
      'Rédige une stratégie commerciale comparative sur 12 mois avec analyse des tendances logistiques',
    messages: []
  }
];

for (const s of scenarios) {
  const result = await answerInLocalMode({
    messages: s.messages,
    lastUser: s.lastUser,
    locale: 'fr'
  });
  const echo = /Votre question\s*:/i.test(result.reply);
  console.log(`\n===== ${s.id} =====`);
  console.log('echoForbidden:', echo);
  console.log(result.reply.slice(0, 900));
}

await mongoose.disconnect();
