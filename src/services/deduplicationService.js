import Opportunity from '../models/Opportunity.js';

export async function existsByUrl(sourceUrl) {
  const doc = await Opportunity.findOne({ sourceUrl }).select('_id').lean();
  return Boolean(doc);
}

export async function upsertOpportunity(data) {
  const existing = await Opportunity.findOne({ sourceUrl: data.sourceUrl });
  if (existing) {
    await Opportunity.updateOne(
      { _id: existing._id },
      {
        $set: {
          title: data.title,
          description: data.description,
          organization: data.organization,
          deadline: data.deadline,
          postedDate: data.postedDate,
          location: data.location,
          category: data.category,
          rawKeywords: data.rawKeywords,
          scrapedAt: new Date(),
          ...(data.aiRelevanceScore != null ? { aiRelevanceScore: data.aiRelevanceScore } : {})
        }
      }
    );
    return { created: false, doc: await Opportunity.findById(existing._id) };
  }
  const doc = await Opportunity.create(data);
  return { created: true, doc };
}
