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

    const keywords = TRADE_KEYWORDS[trade] || TRADE_KEYWORDS.plumbing;

    // Build search query — national mode searches broadly across the UK,
    // local mode includes the specific location plus nearby-area language
    const query = mode === 'national'
      ? `"${keywords[0]}" UK`
      : `"${keywords[0]}" ${location} OR near ${location}`;

    // ── Step 1: Search via Google Custom Search API ──
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=10`;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.items || searchData.items.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ leads: [], message: 'No results found for this search' })
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

    const analysisPrompt = `You are the APTO Pro Lead Filter. Below are real search results that may or may not be genuine leads for a ${trade} business covering ${areaContext}.

For EACH result, determine if it's a genuine person asking for this service (not a business advert, directory listing, or unrelated content). Respond ONLY with a JSON array, no markdown:

[
  {
    "isGenuineLead": true,
    "score": 85,
    "headline": "short summary",
    "urgency": "High",
    "detectedLocation": "Brighton",
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
        trade, location
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
