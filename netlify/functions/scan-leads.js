/**
 * APTO Pro — Real Lead Scanner (SerpAPI)
 * Uses intent-based boolean search queries for maximum lead quality
 */

// Intent signal phrases — combined with trade keywords for high-quality queries
const INTENT_PHRASES = [
  'looking for', 'can anyone recommend', 'need a', 'need someone',
  'who can', 'anyone know', 'does anyone know', 'after recommendations',
  'recommendations please', 'any recommendations', 'urgent', 'ASAP',
  'available today', 'reliable', 'local', 'quote', 'help wanted'
];

// Build a boolean OR query combining intent + trade terms
function buildBooleanQuery(intentPhrases, tradeTerms, location) {
  const intentPart = intentPhrases.slice(0, 4).map(p => `"${p}"`).join(' OR ');
  const tradePart  = tradeTerms.slice(0, 5).map(t => `"${t}"`).join(' OR ');
  const loc        = location ? ` ${location}` : ' UK';
  return `(${intentPart}) AND (${tradePart})${loc}`;
}

// Trade-specific service terms
const TRADE_TERMS = {
  plumbing:        ['plumber', 'plumbing', 'boiler', 'burst pipe', 'no hot water', 'leak', 'heating engineer'],
  electrical:      ['electrician', 'electrical', 'fuse box', 'rewire', 'electrics', 'power'],
  decorating:      ['decorator', 'painter', 'decorating', 'painting', 'wallpaper', 'decorator'],
  gardening:       ['gardener', 'gardening', 'garden', 'landscaper', 'lawn', 'hedge', 'grass cutting'],
  building:        ['builder', 'building', 'extension', 'brickwork', 'loft conversion', 'construction'],
  'dog-grooming':  ['dog groomer', 'dog grooming', 'pet grooming', 'mobile groomer', 'puppy groom'],
  cleaning:        ['cleaner', 'cleaning', 'domestic clean', 'end of tenancy', 'carpet clean', 'house clean'],
  removals:        ['removal', 'removals', 'man and van', 'moving', 'house move', 'van hire', 'movers'],
  hvac:            ['boiler engineer', 'gas engineer', 'HVAC', 'air conditioning', 'central heating', 'boiler service'],
  locksmith:       ['locksmith', 'locked out', 'lock change', 'new locks', 'lock repair'],
  catering:        ['caterer', 'catering', 'buffet', 'wedding catering', 'event catering', 'party food'],
  photography:     ['photographer', 'photography', 'wedding photographer', 'portrait', 'event photographer'],
  'windows-doors': ['window fitter', 'double glazing', 'UPVC', 'new windows', 'bifold doors', 'glazier'],
  hairdressing:    ['hairdresser', 'mobile hairdresser', 'hair stylist', 'haircut', 'home visit hairdresser'],
  // NEW CATEGORIES
  general:         ['handyman', 'odd jobs', 'general help', 'odd job man', 'DIY help', 'home repairs'],
  carer:           ['carer', 'care worker', 'elderly care', 'home help', 'personal care', 'companion carer'],
  clearance:       ['house clearance', 'rubbish removal', 'waste clearance', 'garden clearance', 'junk removal', 'skip alternative'],
  roofing:         ['roofer', 'roofing', 'roof repair', 'roof leak', 'tiles replaced', 'flat roof'],
  plastering:      ['plasterer', 'plastering', 'skim coat', 'ceiling repair', 'plaster repair'],
  tiling:          ['tiler', 'tiling', 'tile fitting', 'bathroom tiles', 'kitchen tiles'],
};

// Fallback keyword lists for when boolean query returns nothing
const FALLBACK_KEYWORDS = {
  plumbing:        ['looking for a plumber', 'can anyone recommend a plumber', 'need a plumber urgent', 'plumber ASAP', 'after a plumber'],
  electrical:      ['looking for an electrician', 'can anyone recommend an electrician', 'need an electrician', 'electrician ASAP'],
  decorating:      ['looking for a decorator', 'can anyone recommend a decorator', 'need a painter', 'decorator available'],
  gardening:       ['looking for a gardener', 'can anyone recommend a gardener', 'need a gardener', 'gardener local'],
  building:        ['looking for a builder', 'can anyone recommend a builder', 'need a builder', 'builder quote'],
  'dog-grooming':  ['looking for a dog groomer', 'can anyone recommend dog groomer', 'need dog grooming', 'mobile dog groomer'],
  cleaning:        ['looking for a cleaner', 'can anyone recommend a cleaner', 'need a cleaner', 'cleaner available'],
  removals:        ['looking for removal company', 'can anyone recommend removals', 'need man and van', 'moving house help'],
  hvac:            ['looking for boiler engineer', 'need gas engineer', 'boiler not working help', 'central heating problem'],
  locksmith:       ['looking for a locksmith', 'locked out need help', 'can anyone recommend locksmith', 'need locksmith urgent'],
  catering:        ['looking for a caterer', 'can anyone recommend caterer', 'need catering', 'wedding caterer needed'],
  photography:     ['looking for a photographer', 'can anyone recommend photographer', 'need a photographer', 'wedding photographer'],
  'windows-doors': ['looking for window fitter', 'can anyone recommend window fitter', 'need new windows', 'double glazing quote'],
  hairdressing:    ['looking for a hairdresser', 'mobile hairdresser needed', 'can anyone recommend hairdresser', 'home hairdresser'],
  general:         ['looking for a handyman', 'need odd jobs done', 'can anyone recommend handyman', 'odd job man needed'],
  carer:           ['looking for a carer', 'need home help', 'can anyone recommend carer', 'elderly care needed'],
  clearance:       ['need house clearance', 'rubbish removal needed', 'can anyone recommend clearance', 'garden clearance urgent'],
  roofing:         ['looking for a roofer', 'roof repair needed', 'can anyone recommend roofer', 'roof leaking help'],
  plastering:      ['looking for a plasterer', 'need plastering done', 'can anyone recommend plasterer', 'ceiling repair needed'],
  tiling:          ['looking for a tiler', 'need tiling done', 'can anyone recommend tiler', 'bathroom tiling needed'],
};

const JOB_KEYWORDS = {
  plumbing:        ['plumber wanted', 'self employed plumber', 'subcontractor plumber', 'hiring plumber'],
  electrical:      ['electrician wanted', 'self employed electrician', 'subcontractor electrician', 'hiring electrician'],
  decorating:      ['decorator wanted', 'painter decorator wanted', 'self employed decorator', 'hiring decorator'],
  gardening:       ['gardener wanted', 'self employed gardener', 'landscaper wanted', 'hiring gardener'],
  building:        ['builder wanted', 'self employed builder', 'subcontractor builder', 'hiring builder'],
  'dog-grooming':  ['dog groomer wanted', 'groomer vacancy', 'hiring dog groomer'],
  cleaning:        ['cleaner wanted', 'self employed cleaner', 'cleaning staff wanted', 'hiring cleaner'],
  removals:        ['removal driver wanted', 'man and van wanted', 'self employed removal', 'hiring movers'],
  hvac:            ['gas engineer wanted', 'hvac engineer wanted', 'boiler engineer vacancy', 'hiring heating engineer'],
  locksmith:       ['locksmith wanted', 'self employed locksmith', 'hiring locksmith'],
  catering:        ['caterer wanted', 'self employed caterer', 'catering staff wanted', 'chef wanted'],
  photography:     ['photographer wanted', 'self employed photographer', 'freelance photographer wanted'],
  'windows-doors': ['window fitter wanted', 'self employed glazier', 'glazier wanted', 'hiring window fitter'],
  hairdressing:    ['hairdresser wanted', 'self employed hairdresser', 'mobile hairdresser wanted'],
  general:         ['handyman wanted', 'odd job man wanted', 'self employed handyman', 'general labourer wanted'],
  carer:           ['carer wanted', 'care worker wanted', 'home help wanted', 'self employed carer'],
  clearance:       ['clearance operative wanted', 'rubbish removal driver wanted', 'waste clearance staff'],
  roofing:         ['roofer wanted', 'self employed roofer', 'roofing subcontractor', 'hiring roofer'],
  plastering:      ['plasterer wanted', 'self employed plasterer', 'subcontractor plasterer'],
  tiling:          ['tiler wanted', 'self employed tiler', 'subcontractor tiler', 'hiring tiler'],
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
    const days       = params.days       || '5';

    const isAllTrades = trade === 'all';
    const isJobSearch = searchType === 'jobs';
    const tradeLabel  = isAllTrades ? 'any trade' : trade;

    // Build search queries
    let queries = [];

    if (isJobSearch) {
      const jobKws = isAllTrades
        ? ['tradesperson wanted UK', 'subcontractor needed UK', 'self employed tradesman wanted']
        : (JOB_KEYWORDS[trade] || JOB_KEYWORDS.plumbing);
      queries = jobKws.slice(0, 4).map(kw => location ? `${kw} ${location}` : kw);
    } else if (isAllTrades) {
      // All trades — use pure intent phrases
      queries = [
        `("looking for" OR "can anyone recommend" OR "need a" OR "need someone") AND (plumber OR electrician OR builder OR cleaner OR gardener OR decorator) ${location || 'UK'}`,
        `("help wanted" OR "urgent" OR "ASAP" OR "available today") AND (tradesman OR tradesperson OR handyman) ${location || 'UK'}`,
      ];
    } else {
      // Specific trade — build boolean intent query
      const tradeTerms = TRADE_TERMS[trade] || [trade];
      queries = [
        buildBooleanQuery(INTENT_PHRASES.slice(0, 4), tradeTerms, location || 'UK'),
        buildBooleanQuery(INTENT_PHRASES.slice(4, 8), tradeTerms, location || 'UK'),
        // Fallback to simple keyword list
        ...(FALLBACK_KEYWORDS[trade] || []).slice(0, 3).map(kw => location ? `${kw} ${location}` : kw),
      ];
    }

    // Date filter
    const tbs = days && days !== '0' ? `qdr:d${days}` : '';

    // ── Search via SerpAPI — try queries until results found ──
    let results   = [];
    let usedQuery = '';

    for (const query of queries) {
      const serpUrl = new URL('https://serpapi.com/search.json');
      serpUrl.searchParams.set('q',       query);
      serpUrl.searchParams.set('api_key', process.env.SERPAPI_KEY);
      serpUrl.searchParams.set('num',     '10');
      serpUrl.searchParams.set('hl',      'en');
      serpUrl.searchParams.set('gl',      'uk');
      if (tbs) serpUrl.searchParams.set('tbs', tbs);

      console.log('Query:', query);

      const res  = await fetch(serpUrl.toString());
      const data = await res.json();

      if (data.error) {
        return { statusCode: 200, headers, body: JSON.stringify({ leads: [], totalSearched: 0, message: `SerpAPI: ${data.error}` }) };
      }

      const items = data.organic_results || [];
      console.log(`${items.length} results`);

      if (items.length > 0) {
        results   = items;
        usedQuery = query;
        break;
      }
    }

    // Retry without date filter if nothing found
    if (results.length === 0 && tbs) {
      console.log('Retrying without date filter');
      const q = queries[0];
      const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}&num=10&hl=en&gl=uk`;
      const res  = await fetch(serpUrl);
      const data = await res.json();
      results    = data.organic_results || [];
      usedQuery  = q + ' (no date filter)';
    }

    if (results.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ leads: [], totalSearched: 0, message: 'No results found' }) };
    }

    // ── Claude filters genuine leads ──
    const candidates = results.slice(0, 8).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
    }));

    const areaContext = mode === 'national' ? 'UK-wide' : `within ${radius} miles of ${location}`;

    const prompt = isJobSearch
      ? `You are APTO Pro Job Finder. From these search results, identify genuine job/gig opportunities for a self-employed ${tradeLabel} covering ${areaContext}. Exclude permanent salaried roles, recruitment agencies, unrelated content. JSON array only, no markdown:
[{"isGenuineLead":true,"score":85,"headline":"job summary","urgency":"Normal","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Professional expression of interest under 50 words","sourceUrl":"url","sourceName":"site"}]
RESULTS:${JSON.stringify(candidates)}`
      : `You are APTO Pro Lead Filter. From these search results, identify genuine posts from people actively seeking a ${tradeLabel} service covering ${areaContext}. Exclude directories, articles, business listings, and anything not a genuine service request from a real person. JSON array only, no markdown:
[{"isGenuineLead":true,"score":85,"headline":"what they need in 8 words","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Natural friendly reply under 50 words ready to send","sourceUrl":"url","sourceName":"site"}]
Score 90-100=urgent+high value, 70-89=strong intent, 50-69=moderate, below 50=weak. Be generous — if it MIGHT be a real person seeking help, include it.
RESULTS:${JSON.stringify(candidates)}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
    });

    const claudeData   = await claudeRes.json();
    const rawText      = claudeData.content.map(b => b.text || '').join('');
    const cleaned      = rawText.replace(/```json|```/g, '').trim();
    const analysed     = JSON.parse(cleaned);
    const genuineLeads = analysed.filter(l => l.isGenuineLead);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ leads: genuineLeads, totalSearched: candidates.length, totalGenuine: genuineLeads.length, trade, location, searchType, searchQueryUsed: usedQuery, daysSearched: days })
    };

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
