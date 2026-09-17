import './src/loadEnv.js';
import nodemailer from 'nodemailer';

// Remplace directement ici (sans espaces) pour un test 100% isolé de ton .env
const USER = 'comairassistance8@gmail.com';
const PASS = 'sewpgwqjvtgixhzd'; // <-- colle ici SANS espaces

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: USER, pass: PASS }
});

try {
  await transport.verify();
  console.log('✅ Connexion SMTP OK — les identifiants fonctionnent.');

  const info = await transport.sendMail({
    from: USER,
    to: USER, // s'envoyer à soi-même pour le test
    subject: 'Test SMTP M-ECAL',
    text: 'Ceci est un test.'
  });
  console.log('✅ E-mail envoyé:', info.messageId);
} catch (e) {
  console.error('❌ Échec:', e.message);
}
