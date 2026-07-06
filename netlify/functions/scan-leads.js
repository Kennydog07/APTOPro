/**
 * APTO Pro — Lead Scanner v4
 * Runs multiple targeted searches across proven community sources
 * Uses site-specific URL patterns to avoid business listing pages
 */

const TRADE_TERMS = {
  plumbing:        ['plumber', 'plumbing', 'boiler', 'leak', 'burst pipe'],
  electrical:      ['electrician', 'electrical', 'electrics', 'fuse box', 'rewire'],
  decorating:      ['decorator', 'painter', 'painting', 'decorating'],
  gardening:       ['gardener', 'gardening', 'garden', 'landscaper', 'lawn'],
  building:        ['builder', 'building work', 'extension', 'loft conversion'],
  'dog-grooming':  ['dog groomer', 'dog grooming', 'pet grooming'],
  cleaning:        ['cleaner', 'cleaning', 'domestic clean', 'end of tenancy'],
  removals:        ['removal', 'removals', 'man and van', 'moving house'],
  hvac:            ['boiler engineer', 'gas engineer', 'central heating', 'air conditioning'],
  locksmith:       ['locksmith', 'locked out', 'lock change'],
  catering:        ['caterer', 'catering', 'wedding catering'],
  photography:     ['photographer', 'photography'],
  'windows-doors': ['window fitter', 'double glazing', 'UPVC windows'],
  hairdressing:    ['hairdresser', 'mobile hairdresser', 'hair stylist'],
  general:         ['handyman', 'odd jobs', 'home repairs'],
  carer:           ['carer', 'care worker', 'home help'],
  clearance:       ['house clearance', 'rubbish removal', 'garden clearance'],
  roofing:         ['roofer', 'roofing', 'roof repair'],
  plastering:      ['plasterer', 'plastering'],
  tiling:          ['tiler', 'tiling', 'tile fitting'],
};

const JOB_TERMS = {
  plumbing:        ['plumber wanted', 'plumber needed', 'subcontractor plumber'],
  electrical:      ['electrician wanted', 'electrician needed', 'subcontractor electrician'],
  decorating:      ['decorator wanted', 'painter wanted'],
  gardening:       ['gardener wanted', 'landscaper wanted'],
  building:        ['builder wanted', 'builder needed', 'subcontractor builder'],
  'dog-grooming':  ['dog groomer wanted'],
  cleaning:        ['cleaner wanted', 'cleaner needed'],
  removals:        ['removal driver wanted', 'man and van wanted'],
  hvac:            ['gas engineer wanted', 'heating engineer wanted'],
  locksmith:       ['locksmith wanted'],
  catering:        ['caterer wanted', 'catering staff wanted'],
  photography:     ['photographer wanted'],
  'windows-doors': ['window fitter wanted', 'glazier wanted'],
  hairdressing:    ['hairdresser wanted', 'stylist wanted'],
  general:         ['handyman wanted', 'odd job man wanted'],
  carer:           ['carer wanted', 'care worker wanted'],
  clearance:       ['clearance driver wanted', 'rubbish removal driver wanted'],
  roofing:         ['roofer wanted', 'roofing subcontractor'],
  plastering:      ['plasterer wanted'],
  tiling:          ['tiler wanted'],
};

// Intent phrases that signal a person seeking help (not offering it)
const SEEK_INTENTS = [
  'looking for a', 'can anyone recommend', 'need a', 'need someone',
  'after a', 'recommendations please', 'anyone know a good',
  'does anyone know', 'who can recommend', 'recommendation for a',
  'can someone recommend', 'help wanted'
];

// Build search queries — one per source type for diversity
function buildQueries(tradeTerms, seekIntents, location, isJob) {
  const loc = location ? ` "${location}"` : '';
  const term = tradeTerms[0];
  const term2 = tradeTerms[1] || tradeTerms[0];
  const intent = seekIntents[0];
  const intent2 = seekIntents[1];

  if (isJob) {
    return [
      `"${term}" site:reddit.com${loc}`,
      `"${term}" site:gumtree.com${loc}`,
      `"${term2}" site:indeed.co.uk${loc}`,
      // Unrestricted — catches job boards and other sources
      `"${term}"${loc} -"we offer" -"our services" -inurl:company`,
    ];
  }

  return [
    // Tier 1: Nextdoor neighbourhood posts (exclude business /pages/)
    `"${intent}" "${term}"${loc} site:nextdoor.co.uk -site:nextdoor.co.uk/pages`,
    // Tier 2: Reddit
    `"${intent}" "${term}"${loc} site:reddit.com`,
    // Tier 3: Mumsnet
    `"${intent}" "${term}"${loc} site:mumsnet.com`,
    // Tier 4: Gumtree
    `"${intent}" "${term2}"${loc} site:gumtree.com`,
    // Tier 5: Unrestricted — catches Facebook public posts + any other high-ranking community content
    `"${intent}" "${term}"${loc} -"we offer" -"our services" -"call us today" -"get a quote from us" -"we specialise in"`,
    // Tier 6: Second intent phrase, unrestricted
    `"${intent2}" "${term}"${loc} -"we offer" -"our services" -"our team"`,
  ];
}

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
    const location   = mode === 'national' ? '' : (params.location || '');
    const searchType = params.searchType || 'customer';
    const days       = params.days       || '5';
    const tbs        = days && days !== '0' ? `qdr:d${days}` : '';

    const isAllTrades = trade === 'all';
    const isJob       = searchType === 'jobs';
    const tradeLabel  = isAllTrades ? 'any trade' : trade;

    // Get trade terms
    let tradeTerms, queries;

    if (isAllTrades) {
      const loc = location ? ` "${location}"` : '';
      queries = isJob ? [
        `("tradesperson wanted" OR "subcontractor needed" OR "tradesman wanted")${loc} site:reddit.com`,
        `("tradesperson wanted" OR "tradesman needed")${loc} site:gumtree.com`,
        `("tradesperson wanted" OR "tradesman needed")${loc}`,
      ] : [
        // Restricted — specific community sites
        `("looking for" OR "can anyone recommend" OR "need a") (plumber OR electrician OR builder OR cleaner OR gardener)${loc} site:nextdoor.co.uk -site:nextdoor.co.uk/pages`,
        `("looking for" OR "can anyone recommend" OR "need a") (plumber OR electrician OR builder OR cleaner OR gardener)${loc} site:reddit.com`,
        `("looking for" OR "can anyone recommend" OR "need a") (plumber OR electrician OR builder OR decorator OR gardener)${loc} site:mumsnet.com`,
        // Unrestricted — catches Facebook public posts and anything else Google ranks highly
        `("looking for" OR "can anyone recommend" OR "need a") (plumber OR electrician OR builder OR cleaner OR gardener)${loc} -"we offer" -"our services" -"get a quote from us"`,
        `("looking for" OR "need a") (roofer OR plasterer OR tiler OR handyman OR carer OR removals)${loc} -"we offer" -"our services"`,
      ];
    } else {
      tradeTerms = isJob ? (JOB_TERMS[trade] || [trade + ' wanted']) : (TRADE_TERMS[trade] || [trade]);
      queries    = buildQueries(tradeTerms, SEEK_INTENTS, location, isJob);
    }

    // Run each query and collect ALL results from ALL sources
    const allResults = [];
    const usedQueries = [];

    for (const query of queries) {
      const serpUrl = new URL('https://serpapi.com/search.json');
      serpUrl.searchParams.set('q',       query);
      serpUrl.searchParams.set('api_key', process.env.SERPAPI_KEY);
      serpUrl.searchParams.set('num',     '5'); // fewer per query, more queries = more diversity
      serpUrl.searchParams.set('hl',      'en');
      serpUrl.searchParams.set('gl',      'uk');
      if (tbs) serpUrl.searchParams.set('tbs', tbs);

      console.log('Query:', query.slice(0, 100));

      const res  = await fetch(serpUrl.toString());
      const data = await res.json();

      if (data.error) {
        console.error('SerpAPI error:', data.error);
        continue;
      }

      const items = data.organic_results || [];
      console.log(`  → ${items.length} results`);

      if (items.length > 0) {
        allResults.push(...items);
        usedQueries.push(query.slice(0, 60));
      }
    }

    // Deduplicate by URL
    const seen   = new Set();
    const unique = allResults.filter(item => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    // Retry without date filter if nothing found at all
    if (unique.length === 0 && tbs) {
      console.log('No results — retrying without date filter');
      const q       = queries[0];
      const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}&num=8&hl=en&gl=uk`;
      const res     = await fetch(serpUrl);
      const data    = await res.json();
      if (data.organic_results) unique.push(...data.organic_results);
    }

    if (unique.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ leads: [], totalSearched: 0, message: 'No results found — try UK-wide or a different time range' }) };
    }

    // Claude analysis — strict filtering
    const candidates = unique.slice(0, 10).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
    }));

    const areaContext = mode === 'national' ? 'anywhere in the UK' : `in or near ${location || 'UK'}`;

    const prompt = isJob
      ? `You are APTO Pro. From these search results find genuine job/subcontract opportunities for a self-employed ${tradeLabel} working ${areaContext}.

INCLUDE: Posts where someone needs a tradesperson hired for a specific job.
EXCLUDE: Businesses advertising their own services. Recruitment agencies. Unrelated content.

JSON array only — no markdown:
[{"isGenuineLead":true,"score":80,"headline":"brief job description","urgency":"Normal","detectedLocation":"town name","detectedTrade":"trade","reply":"professional reply under 40 words","sourceUrl":"url","sourceName":"site"}]`

      : `You are APTO Pro Lead Filter. From these search results find genuine posts from MEMBERS OF THE PUBLIC who are LOOKING FOR a ${tradeLabel} ${areaContext}.

A genuine lead is a post where a real person asks for recommendations, needs someone for a job, or is seeking a service.

INCLUDE: "looking for a plumber", "can anyone recommend", "need someone to", "after a reliable", "does anyone know a good"
EXCLUDE ALL of the following — set isGenuineLead:false:
• Any business or tradesperson advertising THEIR OWN services
• Business pages, company profiles, directories
• News articles, blog posts, how-to guides
• Any page where a tradesperson is describing what THEY offer
• Nextdoor /pages/ business profiles
• If a snippet says "we offer", "our services", "call us", "get a quote from us" — EXCLUDE

JSON array only — no markdown:
[{"isGenuineLead":true,"score":80,"headline":"what they need in 10 words","urgency":"High","detectedLocation":"town name","detectedTrade":"trade name","reply":"reply as the tradesperson, under 40 words, friendly and local","sourceUrl":"url","sourceName":"site name"}]

RESULTS:
${JSON.stringify(candidates)}`;

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
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData   = await claudeRes.json();
    const rawText      = claudeData.content?.map(b => b.text || '').join('') || '[]';
    const cleaned      = rawText.replace(/```json|```/g, '').trim();
    const analysed     = JSON.parse(cleaned);
    const genuineLeads = analysed.filter(l => l.isGenuineLead);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        leads:           genuineLeads,
        totalSearched:   candidates.length,
        totalGenuine:    genuineLeads.length,
        trade, location, searchType,
        sourcesSearched: usedQueries.length,
        daysSearched:    days
      })
    };

  } catch (err) {
    console.error('Scanner error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
