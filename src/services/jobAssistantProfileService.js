import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { normalizeProfile } from './jobCvParseService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const JOB_CV_UPLOAD_DIR = path.join(__dirname, '../../uploads/job-assistant/cv');

const EMPTY_PROFILE = {
  fullName: '',
  email: '',
  phone: '',
  education: '',
  experience: '',
  skills: '',
  languages: '',
  cvFileName: '',
  cvUploadedAt: null
};

export function serializeJobProfile(user) {
  const p = user?.jobAssistantProfile || {};
  return normalizeProfile({
    fullName: p.fullName || user?.name || '',
    email: p.email || user?.email || '',
    phone: p.phone || user?.whatsappNumber || '',
    education: p.education || '',
    experience: p.experience || '',
    skills: p.skills || '',
    languages: p.languages || ''
  });
}

export async function getJobAssistantProfile(userId) {
  const user = await User.findById(userId).select('name email whatsappNumber jobAssistantProfile').lean();
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
  const meta = user.jobAssistantProfile || {};
  return {
    profile: serializeJobProfile(user),
    cv: meta.cvFileName
      ? {
          fileName: meta.cvFileName,
          uploadedAt: meta.cvUploadedAt || null
        }
      : null
  };
}

export async function saveJobAssistantProfile(userId, profilePatch = {}) {
  const normalized = normalizeProfile(profilePatch);
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });

  user.jobAssistantProfile = {
    ...(user.jobAssistantProfile?.toObject?.() || user.jobAssistantProfile || {}),
    ...normalized
  };
  await user.save();
  return getJobAssistantProfile(userId);
}

export async function saveCvFileForUser(userId, { buffer, originalName }) {
  const userDir = path.join(JOB_CV_UPLOAD_DIR, String(userId));
  await fs.mkdir(userDir, { recursive: true });
  const safeName = originalName.replace(/[^\w.\-()+\s]/g, '_').slice(0, 120);
  const filePath = path.join(userDir, safeName);
  await fs.writeFile(filePath, buffer);

  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
  user.jobAssistantProfile = {
    ...(user.jobAssistantProfile?.toObject?.() || user.jobAssistantProfile || {}),
    cvFileName: safeName,
    cvFilePath: filePath,
    cvUploadedAt: new Date()
  };
  await user.save();
  return safeName;
}

export function getEmptyProfile() {
  return { ...EMPTY_PROFILE };
}
