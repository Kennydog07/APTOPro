/**
 * APTO Pro — Real Lead Scanner (SerpAPI)
 * GET /api/scan-leads?trade=plumbing&location=Brighton&mode=local&radius=10&searchType=customer&days=5
 */

const TRADE_KEYWORDS = {
  plumbing: [
    'need a plumber', 'looking for a plumber', 'plumber recommendation',
    'emergency plumber', 'can anyone recommend a plumber', 'boiler broken need help',
    'burst pipe need plumber', 'no hot water plumber', 'toilet leaking need plumber',
    'plumbing problem help'
  ],
  electrical: [
    'need an electrician', 'looking for an electrician', 'electrician recommendation',
    'can anyone recommend electrician', 'electrical fault help', 'power cut house electrician',
    'need rewire electrician', 'fuse box problem electrician', 'lights not working electrician'
  ],
  decorating: [
    'need a decorator', 'looking for a painter decorator', 'decorator recommendation',
    'can anyone recommend decorator', 'need painting done', 'looking for painter',
    'house needs decorating', 'interior decorator needed', 'painting and decorating quote'
  ],
  gardening: [
    'need a gardener', 'looking for a gardener', 'gardener recommendation',
    'can anyone recommend gardener', 'garden needs tidying', 'lawn care needed',
    'hedge trimming needed', 'garden clearance', 'landscaper needed', 'garden maintenance'
  ],
  building: [
    'need a builder', 'looking for a builder', 'builder recommendation',
    'can anyone recommend builder', 'extension builder needed', 'building work quote',
    'brickwork needed', 'wall repair builder', 'loft conversion builder'
  ],
  'dog-grooming': [
    'need a dog groomer', 'looking for dog groomer', 'dog groomer recommendation',
    'can anyone recommend dog groomer', 'mobile dog grooming', 'dog needs grooming',
    'puppy grooming needed', 'dog wash trim needed'
  ],
  cleaning: [
    'need a cleaner', 'looking for a cleaner', 'cleaner recommendation',
    'can anyone recommend cleaner', 'house cleaning needed', 'end of tenancy cleaner',
    'domestic cleaner needed', 'office cleaner wanted', 'carpet cleaning needed'
  ],
  removals: [
    'need a removal company', 'looking for removal firm', 'removal company recommendation',
    'can anyone recommend removals', 'man and van needed', 'moving house need help',
    'furniture removal needed', 'house move help', 'van hire with driver'
  ],
  hvac: [
    'boiler engineer needed', 'need HVAC engineer', 'air conditioning installation',
    'boiler service needed', 'central heating problem', 'gas engineer recommendation',
    'boiler not working', 'heating engineer needed', 'air con unit installation'
  ],
  locksmith: [
    'need a locksmith', 'locked out of house', 'locksmith recommendation',
    'can anyone recommend locksmith', 'lost keys locksmith', 'lock change needed',
    'locked out help', 'new locks fitted needed'
  ],
  catering: [
    'need a caterer', 'looking for catering', 'catering recommendation',
    'can anyone recommend caterer', 'wedding catering needed', 'party catering quote',
    'event catering needed', 'buffet catering needed'
  ],
  photography: [
    'need a photographer', 'looking for a photographer', 'photographer recommendation',
    'can anyone recommend photographer', 'wedding photographer needed', 'family photos photographer',
    'event photographer needed', 'portrait photographer local'
  ],
  'windows-doors': [
    'need new windows', 'window fitter recommendation', 'double glazing quote',
    'can anyone recommend window fitter', 'new front door needed', 'window replacement quote',
    'UPVC windows needed', 'bifold doors installation', 'patio doors fitting'
  ],
  hairdressing: [
    'need a hairdresser', 'looking for mobile hairdresser', 'hairdresser recommendation',
    'can anyone recommend hairdresser', 'mobile hair stylist needed', 'home visit hairdresser',
    'hair cut at home needed', 'local hairdresser recommendation'
  ],
};

const JOB_KEYWORDS = {
  plumbing:        ['plumber wanted', 'subcontractor plumber needed', 'hiring plumber', 'self employed plumber wanted'],
  electrical:      ['electrician wanted', 'subcontractor electrician', 'hiring electrician', 'self employed electrician'],
  decorating:      ['decorator wanted', 'painter decorator wanted', 'hiring decorator', 'self employed decorator'],
  gardening:       ['gardener wanted', 'landscaper wanted', 'hiring gardener', 'garden maintenance staff'],
  building:        ['builder wanted', 'subcontractor builder', 'hiring builder', 'self employed builder'],
  'dog-grooming':  ['dog groomer wanted', 'groomer vacancy', 'hiring dog groomer'],
  cleaning:        ['cleaner wanted', 'cleaning staff wanted', 'hiring cleaner', 'domestic cleaner wanted'],
  removals:        ['removal driver wanted', 'man and van wanted', 'hiring movers', 'removal porter wanted'],
  hvac:            ['gas engineer wanted', 'hvac engineer wanted', 'boiler engineer vacancy', 'heating engineer wanted'],
  locksmith:       ['locksmith wanted', 'hiring locksmith', 'locksmith vacancy'],
  catering:        ['caterer wanted', 'catering staff wanted', 'chef wanted', 'event catering staff'],
  photography:     ['photographer wanted', 'hiring photographer', 'freelance photographer wanted'],
  'windows-doors': ['window fitter wanted', 'glazier wanted', 'hiring window fitter'],
  hairdressing:    ['hairdresser wanted', 'stylist wanted', 'mobile hairdresser wanted'],
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params     = event.queryStringParameters || {};
    const trade      = params.trade      || 'plumbing';
    const mode       = params.mode       || 'local';
    const radius     = params.radius     || '10';
    const location   = mode === 'national' ? '' : (params.location || 'UK');
    const searchType = params.searchType || 'customer';
    const days       = params.days       || '5'; // date range in days

    const isAllTrades = trade === 'all';
    const isJobSearch = searchType === 'jobs';

    let keywords;
    if (isAllTrades) {
      keywords = isJobSearch
        ? ['tradesperson wanted UK', 'subcontractor needed UK', 'hiring tradesman UK']
        : ['need a tradesperson', 'recommend a local tradesman', 'looking for local tradesperson'];
    } else {
      keywords = (isJobSearch ? JOB_KEYWORDS : TRADE_KEYWORDS)[trade] || TRADE_KEYWORDS.plumbing;
    }

    const tradeLabel = isAllTrades ? 'any trade' : trade;

    // Date filter — tbs=qdr:d5 = last 5 days, qdr:w = last week, qdr:m = last month
    const dateFilter = `qdr:d${days}`;

    // ── Search via SerpAPI — try keyword variants until we get results ──
    let results  = [];
    let usedQuery = '';

    // Try up to 4 keyword variants
    for (const kw of keywords.slice(0, 4)) {
      const query = location ? `${kw} ${location}` : kw;

      const serpUrl = new URL('https://serpapi.com/search.json');
      serpUrl.searchParams.set('q',       query);
      serpUrl.searchParams.set('api_key', process.env.SERPAPI_KEY);
      serpUrl.searchParams.set('num',     '10');
      serpUrl.searchParams.set('hl',      'en');
      serpUrl.searchParams.set('gl',      'uk');
      serpUrl.searchParams.set('tbs',     dateFilter); // date restriction

      console.log('Searching:', query, '| Last', days, 'days');

      const res  = await fetch(serpUrl.toString());
      const data = await res.json();

      if (data.error) {
        console.error('SerpAPI error:', data.error);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ leads: [], totalSearched: 0, message: `SerpAPI error: ${data.error}` })
        };
      }

      const items = data.organic_results || [];
      console.log(`${items.length} results for: ${query}`);

      if (items.length > 0) {
        results   = items;
        usedQuery = query;
        break;
      }
    }

    // If no results in last N days, try without date filter as fallback
    if (results.length === 0) {
      console.log('No recent results — retrying without date filter');
      const query    = location ? `${keywords[0]} ${location}` : keywords[0];
      const serpUrl  = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERPAPI_KEY}&num=10&hl=en&gl=uk`;
      const res      = await fetch(serpUrl);
      const data     = await res.json();
      const items    = data.organic_results || [];

      if (items.length > 0) {
        results   = items;
        usedQuery = query + ' (no date filter)';
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

    // ── Claude filters and scores genuine leads ──
    const candidates = results.slice(0, 6).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
    }));

    const areaContext = mode === 'national' ? 'UK-wide' : `within ${radius} miles of ${location}`;

    const analysisPrompt = isJobSearch
      ? `You are the APTO Pro Job Finder. Analyse these search results for genuine job/gig opportunities for a ${tradeLabel} tradesperson covering ${areaContext}. Filter out permanent salaried roles, recruitment agency spam, and irrelevant content. Respond ONLY with a JSON array, no markdown:
[{"isGenuineLead":true,"score":85,"headline":"short job summary","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Professional message of interest under 50 words","sourceUrl":"link","sourceName":"site"}]
RESULTS: ${JSON.stringify(candidates)}`
      : `You are the APTO Pro Lead Filter. Analyse these search results for genuine service requests from people looking for a ${tradeLabel} covering ${areaContext}. Filter out business directories, ads, articles, and irrelevant content. Only include genuine person-seeking-service posts. Respond ONLY with a JSON array, no markdown:
[{"isGenuineLead":true,"score":85,"headline":"short summary","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Natural personalised reply under 50 words","sourceUrl":"link","sourceName":"site"}]
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

    const claudeData  = await claudeRes.json();
    const rawText     = claudeData.content.map(b => b.text || '').join('');
    const cleaned     = rawText.replace(/```json|```/g, '').trim();
    const analysed    = JSON.parse(cleaned);
    const genuineLeads = analysed.filter(l => l.isGenuineLead);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        leads: genuineLeads,
        totalSearched: candidates.length,
        totalGenuine: genuineLeads.length,
        trade, location, searchType,
        searchQueryUsed: usedQuery,
        daysSearched: days
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
