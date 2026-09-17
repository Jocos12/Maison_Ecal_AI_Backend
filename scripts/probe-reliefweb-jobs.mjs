import '../src/loadEnv.js';
import { searchReliefWebJobs } from '../src/scrapers/jobSources/reliefWebJobs.js';

const result = await searchReliefWebJobs();
console.log(
  JSON.stringify(
    {
      status: result.status,
      error: result.error,
      count: result.items?.length || 0,
      message: result.message || null,
      sampleTitle: result.items?.[0]?.title || null
    },
    null,
    2
  )
);
