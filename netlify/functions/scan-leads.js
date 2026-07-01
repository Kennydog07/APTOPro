/**
 * APTO Pro — Real Lead Scanner (SerpAPI)
 * GET /api/scan-leads?trade=plumbing&location=Brighton&mode=local&radius=10&searchType=customer
 */

const TRADE_KEYWORDS = {
  plumbing:        ['need a plumber', 'looking for a plumber', 'plumber recommendation', 'emergency plumber'],
  electrical:      ['need an electrician', 'looking for an electrician', 'electrician recommendation'],
  decorating:      ['need a decorator', 'looking for a painter', 'decorator recommendation'],
  gardening:       ['need a gardener', 'looking for a gardener', 'gardener recommendation'],
  building:        ['need a builder', 'looking for a builder', 'builder recommendation'],
  'dog-grooming':  ['need a dog groomer', 'looking for a dog groomer', 'mobile dog groomer'],
  cleaning:        ['need a cleaner', 'looking for a cleaner', 'cleaning recommendation'],
  removals:        ['need a removal company', 'looking for movers', 'man and van recommendation'],
  hvac:            ['need an HVAC engineer', 'boiler engineer needed', 'looking for air conditioning engineer'],
  locksmith:       ['need a locksmith', 'locked out need help', 'locksmith recommendation'],
  catering:        ['need a caterer', 'looking for catering', 'catering recommendation'],
  photography:     ['need a photographer', 'looking for a photographer', 'photographer recommendation'],
  'windows-doors': ['need new windows', 'window fitter recommendation', 'double glazing quote'],
  hairdressing:    ['need a hairdresser', 'mobile hairdresser', 'hair stylist recommendation'],
};

const JOB_KEYWORDS = {
  plumbing:        ['plumber wanted', 'subcontractor plumber needed', 'hiring plumber'],
  electrical:      ['electrician wanted', 'subcontractor electrician needed', 'hiring electrician'],
  decorating:      ['decorator wanted', 'painter wanted', 'hiring decorator'],
  gardening:       ['gardener wanted', 'landscaper wanted', 'hiring gardener'],
  building:        ['builder wanted', 'subcontractor builder needed', 'hiring builder'],
  'dog-grooming':  ['dog groomer wanted', 'groomer job vacancy', 'hiring dog groomer'],
  cleaning:        ['cleaner wanted', 'cleaning job vacancy', 'hiring cleaner'],
  removals:        ['removal driver wanted', 'man and van wanted', 'hiring movers'],
  hvac:            ['hvac engineer wanted', 'gas engineer wanted', 'hiring hvac engineer'],
  locksmith:       ['locksmith wanted', 'hiring locksmith'],
  catering:        ['caterer wanted', 'catering staff wanted', 'hiring caterer'],
  photography:     ['photographer wanted', 'hiring photographer'],
  'windows-doors': ['window fitter wanted', 'glazier wanted', 'hiring window fitter'],
  hairdressing:    ['hairdresser wanted', 'stylist wanted', 'hiring hairdresser'],
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
    const trade      = params.trade      || 'plumbing';
    const mode       = params.mode       || 'local';
    const radius     = params.radius     || '10';
    const location   = mode === 'national' ? '' : (params.location || 'UK');
    const searchType = params.searchType || 'customer';

    const isAllTrades = trade === 'all';
    const isJobSearch = searchType === 'jobs';

    let keywords;
    if (isAllTrades) {
      keywords = isJobSearch
        ? ['tradesperson wanted', 'subcontractor needed', 'hiring tradesman']
        : ['need a tradesperson UK', 'looking for a local tradesman', 'recommend a tradesperson'];
    } else {
      keywords = (isJobSearch ? JOB_KEYWORDS : TRADE_KEYWORDS)[trade] || TRADE_KEYWORDS.plumbing;
    }

    const tradeLabel = isAllTrades ? 'any trade' : trade;

    // ── Step 1: Search via SerpAPI ──
    let results = [];
    let usedQuery = '';

    for (const kw of keywords) {
      const query = location ? `${kw} ${location}` : kw;
      const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERPAPI_KEY}&num=10&hl=en&gl=uk`;

      console.log('SerpAPI query:', query);

      const res  = await fetch(serpUrl);
      const data = await res.json();

      if (data.error) {
        console.error('SerpAPI error:', data.error);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            leads: [], totalSearched: 0,
            message: `SerpAPI error: ${data.error}`
          })
        };
      }

      const items = data.organic_results || [];
      console.log(`Found ${items.length} results for: ${query}`);

      if (items.length > 0) {
        results = items;
        usedQuery = query;
        break;
      }
    }

    if (results.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          leads: [], totalSearched: 0,
          message: 'No results found — try a different trade, location or search type'
        })
      };
    }

    // ── Step 2: Claude filters and scores genuine leads ──
    const candidates = results.slice(0, 6).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
    }));

    const areaContext = mode === 'national'
      ? 'UK-wide'
      : `within ${radius} miles of ${location}`;

    const isJobPrompt = isJobSearch;

    const analysisPrompt = isJobPrompt
      ? `You are the APTO Pro Job Finder. Analyse these search results for genuine job/gig opportunities for a ${tradeLabel} tradesperson covering ${areaContext}. Filter out permanent salaried roles, recruitment agency spam, and irrelevant content. Respond ONLY with a JSON array — no markdown:

[{"isGenuineLead":true,"score":85,"headline":"short job summary","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Professional message of interest under 50 words","sourceUrl":"link","sourceName":"site name"}]

RESULTS: ${JSON.stringify(candidates)}`
      : `You are the APTO Pro Lead Filter. Analyse these search results for genuine service requests from people looking for a ${tradeLabel} covering ${areaContext}. Filter out business directories, ads, articles, and irrelevant content. Only include genuine person-seeking-service posts. Respond ONLY with a JSON array — no markdown:

[{"isGenuineLead":true,"score":85,"headline":"short summary","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Natural personalised reply under 50 words","sourceUrl":"link","sourceName":"site name"}]

RESULTS: ${JSON.stringify(candidates)}`;

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
