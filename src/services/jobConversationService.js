import JobAssistantConversation from '../models/JobAssistantConversation.js';
import {
  generateJobDocument,
  processConversationMessage
} from './jobAssistantService.js';

const WELCOME =
  "Bonjour ! Je suis votre Assistant Emploi M-ECAL. Décrivez le poste logistique recherché en RDC (ex. « Magasinier à Kinshasa »). Les offres affichées proviennent uniquement de sources réelles (ReliefWeb, MediaCongo, UNjobnet).";

function generateTitle(firstUserMessage) {
  const cleaned = (firstUserMessage || 'Nouvelle conversation')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'Nouvelle conversation';
}

function toClientConversation(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id,
    title: obj.title,
    messages: obj.messages || [],
    selectedOffer: obj.selectedOffer || null,
    pendingDocument: obj.pendingDocument || null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

export async function createConversation(userId) {
  const conv = await JobAssistantConversation.create({
    userId,
    title: 'Nouvelle conversation',
    messages: [
      {
        role: 'assistant',
        content: WELCOME,
        timestamp: new Date()
      }
    ]
  });
  return toClientConversation(conv);
}

export async function listConversations(userId) {
  const rows = await JobAssistantConversation.find({ userId })
    .sort({ updatedAt: -1 })
    .select('title updatedAt createdAt')
    .lean();
  return rows.map((r) => ({
    id: r._id,
    title: r.title,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt
  }));
}

export async function getConversation(userId, conversationId) {
  const conv = await JobAssistantConversation.findOne({ _id: conversationId, userId });
  if (!conv) {
    const err = new Error('Conversation introuvable.');
    err.status = 404;
    throw err;
  }
  return toClientConversation(conv);
}

export async function deleteConversation(userId, conversationId) {
  const result = await JobAssistantConversation.deleteOne({ _id: conversationId, userId });
  if (result.deletedCount === 0) {
    const err = new Error('Conversation introuvable.');
    err.status = 404;
    throw err;
  }
  return { success: true };
}

export async function updateSelectedOffer(userId, conversationId, selectedOffer) {
  const conv = await JobAssistantConversation.findOneAndUpdate(
    { _id: conversationId, userId },
    { $set: { selectedOffer } },
    { new: true }
  );
  if (!conv) {
    const err = new Error('Conversation introuvable.');
    err.status = 404;
    throw err;
  }
  return toClientConversation(conv);
}

export async function appendAndProcessMessage(userId, conversationId, userMessage, options = {}) {
  const conv = await JobAssistantConversation.findOne({ _id: conversationId, userId });
  if (!conv) {
    const err = new Error('Conversation introuvable.');
    err.status = 404;
    throw err;
  }

  const isFirstUserMessage = !conv.messages.some((m) => m.role === 'user');

  conv.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date()
  });

  const result = await processConversationMessage({
    messages: conv.messages,
    userMessage,
    sources: options.sources || null,
    locale: options.locale || null,
    systemPrompt: options.systemPrompt || null
  });

  conv.messages.push({
    role: 'assistant',
    content: result.content,
    timestamp: new Date(),
    jobs: result.jobs || null,
    document: result.document || null,
    noResults: result.noResults || false,
    suggestions: result.suggestions || null,
    manualLinks: result.manualLinks || null,
    diagnosis: result.diagnosis || null
  });

  if (result.jobs?.length) {
    conv.selectedOffer = result.jobs[0];
  }

  if (isFirstUserMessage) {
    conv.title = generateTitle(userMessage);
  }

  await conv.save();

  return {
    conversation: toClientConversation(conv),
    ...result
  };
}

export async function persistDocumentInConversation(userId, conversationId, docResult, job) {
  const conv = await JobAssistantConversation.findOne({ _id: conversationId, userId });
  if (!conv) return null;

  conv.selectedOffer = job;
  conv.pendingDocument = docResult;
  conv.messages.push({
    role: 'assistant',
    content: docResult.message,
    timestamp: new Date(),
    document: docResult
  });
  await conv.save();
  return toClientConversation(conv);
}

export async function syncConversationMessages(userId, conversationId, { messages = [], title } = {}) {
  const conv = await JobAssistantConversation.findOne({ _id: conversationId, userId });
  if (!conv) {
    const err = new Error('Conversation introuvable.');
    err.status = 404;
    throw err;
  }

  conv.messages = messages.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
    document: m.document || null,
    provider: m.provider || null,
    jobs: m.jobs || null,
    suggestions: m.suggestions || null,
    manualLinks: m.manualLinks || null,
    diagnosis: m.diagnosis || null
  }));

  const firstUser = messages.find((m) => m.role === 'user');
  if (title) {
    conv.title = title;
  } else if (firstUser && (!conv.title || conv.title === 'Nouvelle conversation')) {
    conv.title = generateTitle(firstUser.content);
  }

  await conv.save();
  return toClientConversation(conv);
}

export { generateJobDocument };
