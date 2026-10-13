import '../src/loadEnv.js';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import User from '../src/models/User.js';
import Opportunity from '../src/models/Opportunity.js';

await connectDb(process.env.MONGODB_URI);

const user = await User.findOne({
  email: String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase()
}).lean();
if (!user) {
  console.error('Admin bootstrap introuvable.');
  process.exit(1);
}

const opp = await Opportunity.findOne({ isArchived: { $ne: true } })
  .sort({ isRecommended: -1, createdAt: -1 })
  .select('_id title')
  .lean();
if (!opp) {
  console.error('Aucune offre.');
  process.exit(1);
}

const token = jwt.sign(
  { sub: user._id.toString(), email: user.email, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: '15m' }
);

const question = 'Quels documents faut-il envoyer pour postuler, selon le texte de cette offre ?';
const res = await fetch(`http://127.0.0.1:5000/api/opportunities/${opp._id}/ask`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ message: question, messages: [] })
});

const raw = await res.text();
let body;
try {
  body = JSON.parse(raw);
} catch {
  body = { raw };
}

console.log(
  JSON.stringify(
    {
      httpStatus: res.status,
      path: `/api/opportunities/${opp._id}/ask`,
      title: opp.title,
      warning: body.warning || null,
      replyPreview: String(body.reply || body.message || raw).slice(0, 900)
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(res.status >= 200 && res.status < 300 ? 0 : 1);
