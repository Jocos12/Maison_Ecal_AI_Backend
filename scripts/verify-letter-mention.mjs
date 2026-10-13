import '../src/loadEnv.js';
import { ensureMaisonEcalMention, hasMaisonEcalMention, MAISON_ECAL_LETTER_MENTION } from '../src/utils/maisonEcalLetter.js';
import { generateMotivationLetter } from '../src/services/aiClassifierService.js';

const samples = [
  `Madame, Monsieur,\n\nJe candidate au poste A.\n\nSignature`,
  `**Objet** : AMI NRC\n\nCompétences logistique RDC.\n\nCordialement`,
  MAISON_ECAL_LETTER_MENTION
];

const opps = [
  { title: 'Offre test Kinshasa logistique', organization: 'NRC', ville: 'Kinshasa', description: 'Magasinier' },
  { title: 'AMI formation chauffeurs Goma', organization: 'KCC', ville: 'Goma', description: 'Formation' },
  { title: 'Consultance inventaire Lubumbashi', organization: 'OMS', ville: 'Lubumbashi', description: 'Inventaire' }
];

for (let i = 0; i < samples.length; i += 1) {
  const out = ensureMaisonEcalMention(samples[i]);
  if (!hasMaisonEcalMention(out)) {
    console.error('FAIL helper', i);
    process.exit(1);
  }
}
console.log('helper: 3/3 OK');

const letters = [];
for (const opp of opps) {
  const letter = await generateMotivationLetter(opp, { fullName: 'Test COURBON', email: 'maisonecal@gmail.com' });
  letters.push(letter);
  const ok = hasMaisonEcalMention(letter);
  console.log(`letter « ${opp.title.slice(0, 40)} » : ${ok ? 'OK' : 'FAIL'} (${letter.length} car.)`);
  if (!ok) process.exit(1);
}
console.log('generated: 3/3 OK');
