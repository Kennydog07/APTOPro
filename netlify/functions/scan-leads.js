/**
 * APTO Pro — Real Lead Scanner
 * GET /api/scan-leads?trade=plumbing&location=Brighton
 *
 * Searches real public sites via Google Custom Search API for posts
 * matching trade service requests, then uses Claude to analyse,
 * score, and filter genuine leads from noise.
 */

const TRADE_KEYWORDS = {
  plumbing:       ['need a plumber', 'looking for a plumber', 'plumber recommendation', 'emergency plumber'],
  electrical:     ['need an electrician', 'looking for an electrician', 'electrician recommendation'],
  decorating:     ['need a decorator', 'looking for a painter', 'decorator recommendation'],
  gardening:      ['need a gardener', 'looking for a gardener', 'gardener recommendation'],
  building:       ['need a builder', 'looking for a builder', 'builder recommendation'],
  'dog-grooming': ['need a dog groomer', 'looking for a dog groomer', 'mobile dog groomer'],
  cleaning:       ['need a cleaner', 'looking for a cleaner', 'cleaning recommendation'],
  removals:       ['need a removal company', 'looking for movers', 'man and van recommendation'],
  hvac:           ['need an HVAC engineer', 'looking for air conditioning', 'boiler engineer needed'],
  locksmith:      ['need a locksmith', 'locked out', 'locksmith recommendation'],
  catering:       ['need a caterer', 'looking for catering', 'catering recommendation'],
  photography:    ['need a photographer', 'looking for a photographer'],
  'windows-doors':['need new windows', 'window fitter recommendation', 'double glazing quote'],
  hairdressing:   ['need a hairdresser', 'mobile hairdresser', 'hair stylist recommendation'],
};

// Job/gig ad keywords — for finding work opportunities posted by businesses
// or homeowners hiring a tradesperson for a specific job (subcontract work,
// one-off jobs, gig postings) rather than casual "does anyone know a..." asks
const JOB_KEYWORDS = {
  plumbing:       ['plumber wanted', 'subcontractor plumber needed', 'plumbing job vacancy', 'hiring plumber'],
  electrical:     ['electrician wanted', 'subcontractor electrician needed', 'electrical job vacancy', 'hiring electrician'],
  decorating:     ['decorator wanted', 'painter wanted', 'decorating job vacancy', 'hiring decorator'],
  gardening:      ['gardener wanted', 'landscaper wanted', 'gardening job vacancy', 'hiring gardener'],
  building:       ['builder wanted', 'subcontractor builder needed', 'building job vacancy', 'hiring builder'],
  'dog-grooming': ['dog groomer wanted', 'groomer job vacancy', 'hiring dog groomer'],
  cleaning:       ['cleaner wanted', 'cleaning job vacancy', 'hiring cleaner'],
  removals:       ['removal driver wanted', 'man and van wanted', 'hiring movers'],
  hvac:           ['hvac engineer wanted', 'gas engineer wanted', 'hiring hvac engineer'],
  locksmith:      ['locksmith wanted', 'hiring locksmith'],
  catering:       ['caterer wanted', 'catering staff wanted', 'hiring caterer'],
  photography:    ['photographer wanted', 'hiring photographer'],
  'windows-doors':['window fitter wanted', 'glazier wanted', 'hiring window fitter'],
  hairdressing:   ['hairdresser wanted', 'stylist wanted', 'hiring hairdresser'],
};


exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = event.queryStringParameters || {};
    const trade = params.trade || 'plumbing';
    const mode = params.mode || 'local';
    const radius = params.radius || '10';
    const location = mode === 'national' ? 'UK' : (params.location || 'UK');
    const searchType = params.searchType || 'customer'; // 'customer' or 'jobs'

    // "All Industries" — search across multiple trades by picking a broad
    // generic phrase covering tradespeople rather than one specific trade
    const isAllTrades = trade === 'all';

    let keywords;
    if (isAllTrades) {
      keywords = searchType === 'jobs'
        ? ['tradesperson wanted', 'subcontractor needed', 'hiring tradesman']
        : ['need a tradesperson', 'looking for a local tradesman', 'can anyone recommend a tradesperson'];
    } else {
      const sourceMap = searchType === 'jobs' ? JOB_KEYWORDS : TRADE_KEYWORDS;
      keywords = sourceMap[trade] || sourceMap.plumbing;
    }

    const tradeLabel = isAllTrades ? 'any trade' : trade;

    // Build search query — try the phrase without forcing exact quotes on
    // the whole thing (too restrictive against a 50-domain set), and run
    // multiple keyword variants if the first one returns nothing
    function buildQuery(keyword) {
      if (mode === 'national') {
        return `${keyword} UK`;
      }
      return `${keyword} ${location}`;
    }

    // ── Step 1: Search via Google Custom Search API — try each keyword variant until results are found ──
    let searchData = null;
    let usedQuery = '';

    for (const kw of keywords) {
      const query = buildQuery(kw);
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=10`;
      const searchRes = await fetch(searchUrl);
      const data = await searchRes.json();

      if (data.items && data.items.length > 0) {
        searchData = data;
        usedQuery = query;
        break;
      }
    }

    if (!searchData) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          leads: [],
          totalSearched: 0,
          message: 'No results found across any keyword variant for this search',
          queriesTriedCount: keywords.length
        })
      };
    }

    // ── Step 2: Analyse each result with Claude to filter genuine leads ──
    const candidates = searchData.items.slice(0, 5).map(item => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
      source: new URL(item.link).hostname
    }));

    const areaContext = mode === 'national'
      ? `a UK-wide search (the business covers the whole country)`
      : `a ${radius}-mile radius around ${location}`;

    const isJobSearch = searchType === 'jobs';

    const analysisPrompt = isJobSearch
      ? `You are the APTO Pro Job Finder. Below are real search results that may be genuine job/gig opportunities for a ${tradeLabel} tradesperson covering ${areaContext}.${isAllTrades ? ' This search covers ALL trades, so identify the specific trade needed for each job and include it as "detectedTrade" in your response.' : ''}

For EACH result, determine if it's a genuine work opportunity (a homeowner, business, or agency hiring a tradesperson for a specific job or subcontract work) — not a generic recruitment agency listing, unrelated content, or a permanent employee job description requiring an employment contract. Respond ONLY with a JSON array, no markdown:

[
  {
    "isGenuineLead": true,
    "score": 85,
    "headline": "short summary of the job",
    "urgency": "High",
    "detectedLocation": "Brighton",
    "detectedTrade": "Plumbing",
    "reply": "a natural professional message expressing interest in the job, under 50 words",
    "sourceUrl": "the link",
    "sourceName": "the site name"
  }
]

Set isGenuineLead to false for permanent salaried job listings, recruitment agency spam, or irrelevant results — only include genuine one-off job/gig/subcontract opportunities suitable for an independent tradesperson.

SEARCH RESULTS:
${JSON.stringify(candidates, null, 2)}`
      : `You are the APTO Pro Lead Filter. Below are real search results that may or may not be genuine leads for a ${tradeLabel} business covering ${areaContext}.${isAllTrades ? ' This search covers ALL trades, so identify the specific trade needed for each lead (plumbing, electrical, gardening, etc.) and include it as "detectedTrade" in your response.' : ''}

For EACH result, determine if it's a genuine person asking for this service (not a business advert, directory listing, or unrelated content). Respond ONLY with a JSON array, no markdown:

[
  {
    "isGenuineLead": true,
    "score": 85,
    "headline": "short summary",
    "urgency": "High",
    "detectedLocation": "Brighton",
    "detectedTrade": "Plumbing",
    "reply": "a natural personalised reply under 50 words",
    "sourceUrl": "the link",
    "sourceName": "the site name"
  }
]

Set isGenuineLead to false for business directories, ads, or irrelevant results — only include genuine person-seeking-service posts.

SEARCH RESULTS:
${JSON.stringify(candidates, null, 2)}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: analysisPrompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content.map(b => b.text || '').join('');
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const analysed = JSON.parse(cleaned);

    const genuineLeads = analysed.filter(l => l.isGenuineLead);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        leads: genuineLeads,
        totalSearched: candidates.length,
        totalGenuine: genuineLeads.length,
        trade, location, searchType,
        searchQueryUsed: usedQuery
      })
    };

  } catch (err) {
    console.error('Scanner error:', err);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Scanner error', detail: err.message })
    };
  }
};
