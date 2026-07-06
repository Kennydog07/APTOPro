/**
 * APTO Pro — Lead Scanner v5
 * Fixes: num=10, candidates=30, broader intents, looser Claude filter,
 * retry on zero genuine leads (not just zero results), expanded phrase list
 */

const TRADE_TERMS = {
  plumbing:        ['plumber', 'plumbing', 'boiler', 'leak', 'burst pipe', 'no hot water', 'heating'],
  electrical:      ['electrician', 'electrical', 'electrics', 'fuse box', 'rewire', 'power'],
  decorating:      ['decorator', 'painter', 'painting', 'decorating', 'wallpaper', 'paint job'],
  gardening:       ['gardener', 'gardening', 'garden', 'landscaper', 'lawn', 'hedge', 'grass'],
  building:        ['builder', 'building work', 'extension', 'loft conversion', 'renovation', 'brickwork'],
  'dog-grooming':  ['dog groomer', 'dog grooming', 'pet grooming', 'dog wash'],
  cleaning:        ['cleaner', 'cleaning', 'domestic clean', 'end of tenancy', 'carpet clean', 'house clean'],
  removals:        ['removal', 'removals', 'man and van', 'moving house', 'house move', 'van hire'],
  hvac:            ['boiler engineer', 'gas engineer', 'central heating', 'air conditioning', 'boiler service', 'boiler repair'],
  locksmith:       ['locksmith', 'locked out', 'lock change', 'new locks'],
  catering:        ['caterer', 'catering', 'wedding catering', 'event catering', 'buffet'],
  photography:     ['photographer', 'photography', 'wedding photographer', 'event photographer'],
  'windows-doors': ['window fitter', 'double glazing', 'UPVC windows', 'new windows', 'bifold doors'],
  hairdressing:    ['hairdresser', 'mobile hairdresser', 'hair stylist', 'haircut at home'],
  general:         ['handyman', 'odd jobs', 'home repairs', 'odd job man', 'DIY help'],
  carer:           ['carer', 'care worker', 'home help', 'elderly care', 'personal care'],
  clearance:       ['house clearance', 'rubbish removal', 'garden clearance', 'waste removal', 'junk removal'],
  roofing:         ['roofer', 'roofing', 'roof repair', 'roof leak', 'flat roof', 'guttering'],
  plastering:      ['plasterer', 'plastering', 'skim coat', 'ceiling repair', 'plaster crack'],
  tiling:          ['tiler', 'tiling', 'tile fitting', 'bathroom tiles', 'kitchen tiles'],
};

const JOB_TERMS = {
  plumbing:        ['plumber wanted', 'plumber needed', 'subcontractor plumber', 'self employed plumber'],
  electrical:      ['electrician wanted', 'electrician needed', 'subcontractor electrician'],
  decorating:      ['decorator wanted', 'painter wanted', 'decorator needed'],
  gardening:       ['gardener wanted', 'landscaper wanted', 'gardener needed'],
  building:        ['builder wanted', 'builder needed', 'subcontractor builder'],
  'dog-grooming':  ['dog groomer wanted', 'groomer needed'],
  cleaning:        ['cleaner wanted', 'cleaner needed', 'cleaning staff wanted'],
  removals:        ['removal driver wanted', 'man and van wanted', 'movers needed'],
  hvac:            ['gas engineer wanted', 'heating engineer wanted', 'boiler engineer needed'],
  locksmith:       ['locksmith wanted', 'locksmith needed'],
  catering:        ['caterer wanted', 'catering staff wanted', 'chef wanted'],
  photography:     ['photographer wanted', 'photographer needed'],
  'windows-doors': ['window fitter wanted', 'glazier wanted'],
  hairdressing:    ['hairdresser wanted', 'stylist wanted'],
  general:         ['handyman wanted', 'odd job man wanted', 'labourer wanted'],
  carer:           ['carer wanted', 'care worker wanted', 'home help wanted'],
  clearance:       ['clearance driver wanted', 'rubbish removal driver wanted'],
  roofing:         ['roofer wanted', 'roofing subcontractor', 'roofer needed'],
  plastering:      ['plasterer wanted', 'plasterer needed'],
  tiling:          ['tiler wanted', 'tiler needed'],
};

// Broad intent phrases — covers how real people actually phrase requests
const SEEK_INTENTS = [
  'looking for a',
  'can anyone recommend',
  'need a',
  'after a',
  'recommendations please',
  'anyone know a good',
  'does anyone know',
  'any recommendations for',
  'looking to get',
  'need someone to',
  'who can',
  'recommendation for',
  'can someone recommend',
  'help wanted',
  'looking for someone',
  'need help with',
  'getting quotes for',
  'any good',
];

function buildQueries(tradeTerms, location, isJob) {
  const loc   = location ? ` "${location}"` : '';
  const term  = tradeTerms[0];
  const term2 = tradeTerms[1] || term;
  const term3 = tradeTerms[2] || term;

  if (isJob) {
    return [
      `"${term}" site:reddit.com${loc}`,
      `"${term}" site:gumtree.com${loc}`,
      `"${term2}" site:indeed.co.uk${loc}`,
      `"${term}"${loc} -"we offer" -"our services"`,
    ];
  }

  // Use varied intent phrases across queries for maximum coverage
  return [
    // Reddit — most consistent source of real posts
    `("looking for a" OR "can anyone recommend" OR "need a" OR "anyone know a good") "${term}"${loc} site:reddit.com`,
    // Mumsnet — great for domestic trades
    `("looking for a" OR "can anyone recommend" OR "any recommendations" OR "does anyone know") "${term}"${loc} site:mumsnet.com`,
    // Gumtree services wanted
    `("looking for" OR "need a" OR "wanted") "${term}"${loc} site:gumtree.com`,
    // MSE forums
    `("looking for a" OR "can anyone recommend" OR "need a") "${term}"${loc} site:forums.moneysavingexpert.com`,
    // Unrestricted #1 — Google top results, varied intent phrases, neg business signals
    `("looking for a" OR "can anyone recommend" OR "need a" OR "recommendations please") "${term}"${loc} -"we offer" -"our services" -"call us today" -"get a quote from us" -site:nextdoor.co.uk`,
    // Unrestricted #2 — different phrasing catches different posts
    `("after a" OR "looking to get" OR "need someone to" OR "any good" OR "getting quotes") "${term2}"${loc} -"we offer" -"our services" -"our team" -site:nextdoor.co.uk`,
    // Unrestricted #3 — third trade term, catches edge cases
    `("does anyone know" OR "who can" OR "looking for someone" OR "need help with") "${term3}"${loc} -"we offer" -"our services" -site:nextdoor.co.uk`,
  ];
}

async function runSearch(query, tbs, serpKey, num) {
  const serpUrl = new URL('https://serpapi.com/search.json');
  serpUrl.searchParams.set('q',       query);
  serpUrl.searchParams.set('api_key', serpKey);
  serpUrl.searchParams.set('num',     String(num));
  serpUrl.searchParams.set('hl',      'en');
  serpUrl.searchParams.set('gl',      'uk');
  if (tbs) serpUrl.searchParams.set('tbs', tbs);

  console.log(`Searching [num=${num}]:`, query.slice(0, 100));
  const res  = await fetch(serpUrl.toString());
  const data = await res.json();

  if (data.error) {
    console.error('SerpAPI error:', data.error);
    return [];
  }
  const items = data.organic_results || [];
  console.log(`  → ${items.length} results`);
  return items;
}

function dedup(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

async function runClaude(candidates, tradeLabel, areaContext, isJob, anthropicKey) {
  const prompt = isJob
    ? `You are APTO Pro. From these search results find genuine job or subcontract opportunities for a self-employed ${tradeLabel} working ${areaContext}.

Include: Posts where a homeowner, landlord, business, or contractor needs a tradesperson for a specific job.
Include commercial customers too — cafes, offices, landlords, letting agents are all valid clients.
Exclude: Businesses advertising their own services. Recruitment agencies for employed roles. Completely unrelated content.

Return ONLY a valid JSON array. No explanation, no markdown, no extra text.
If no genuine leads: []

[{"isGenuineLead":true,"score":80,"headline":"brief job description","urgency":"Normal","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"professional reply under 40 words","sourceUrl":"https://example.com","sourceName":"reddit.com"}]

RESULTS:
${JSON.stringify(candidates)}`

    : `You are APTO Pro Lead Filter. From these search results find genuine posts from people SEEKING a ${tradeLabel} service ${areaContext}.

Include BROADLY — all of these are valid leads:
- Homeowners, tenants, landlords, letting agents, businesses, cafes, offices, schools asking for trade help
- Anyone asking for recommendations, quotes, or someone to do a job
- Commercial customers are fine — a cafe needing a plumber is a real lead
- Phrases like "can anyone recommend", "looking for", "need a", "any good", "getting quotes", "after a reliable"

Exclude only clear non-leads:
- Tradespeople advertising their own services ("we offer", "our services", "call us", "get a quote from us")
- Pure directory listings with no human request
- Completely irrelevant content unrelated to the trade

When in doubt, INCLUDE it — it is better to show a borderline lead than miss a real one.

Return ONLY a valid JSON array. No explanation, no markdown, no extra text.
If no genuine leads: []

[{"isGenuineLead":true,"score":80,"headline":"what they need in 10 words","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"friendly reply as tradesperson under 40 words","sourceUrl":"https://example.com","sourceName":"reddit.com"}]

RESULTS:
${JSON.stringify(candidates)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }]
    })
  });

  const data    = await res.json();
  const rawText = data.content?.map(b => b.text || '').join('') || '[]';

  // Robust JSON extraction
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    try {
      const start = rawText.indexOf('[');
      const end   = rawText.lastIndexOf(']');
      if (start !== -1 && end > start) {
        return JSON.parse(rawText.slice(start, end + 1));
      }
    } catch {}
    console.error('Claude JSON parse failed. Raw:', rawText.slice(0, 300));
    return [];
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
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
    const isJob      = searchType === 'jobs';
    const isAll      = trade === 'all';
    const tradeLabel = isAll ? 'any trade' : trade;
    const tbs        = days && days !== '0' ? `qdr:d${days}` : '';
    const areaContext = mode === 'national' ? 'anywhere in the UK' : `in or near ${location || 'the UK'}`;
    const serpKey    = process.env.SERPAPI_KEY;
    const claudeKey  = process.env.ANTHROPIC_API_KEY;

    // Build queries
    let queries;
    const loc = location ? ` "${location}"` : '';

    if (isAll) {
      queries = isJob ? [
        `("tradesperson wanted" OR "subcontractor needed" OR "tradesman wanted")${loc} site:reddit.com`,
        `("tradesperson wanted" OR "tradesman needed")${loc} site:gumtree.com`,
        `("tradesperson wanted" OR "tradesman needed")${loc} -"we offer" -"our services"`,
      ] : [
        `("looking for" OR "can anyone recommend" OR "need a" OR "any recommendations") (plumber OR electrician OR builder OR cleaner OR gardener OR decorator)${loc} site:reddit.com`,
        `("looking for" OR "can anyone recommend" OR "need a") (plumber OR electrician OR builder OR cleaner OR decorator OR gardener)${loc} site:mumsnet.com`,
        `("looking for" OR "need a") (plumber OR electrician OR builder OR cleaner OR decorator)${loc} site:gumtree.com`,
        `("looking for" OR "can anyone recommend" OR "need a" OR "any recommendations") (plumber OR electrician OR builder OR cleaner OR gardener)${loc} -"we offer" -"our services" -site:nextdoor.co.uk`,
        `("after a" OR "looking to get" OR "getting quotes" OR "any good") (roofer OR plasterer OR tiler OR handyman OR carer OR removals)${loc} -"we offer" -"our services" -site:nextdoor.co.uk`,
      ];
    } else {
      const tradeTerms = isJob ? (JOB_TERMS[trade] || [trade + ' wanted']) : (TRADE_TERMS[trade] || [trade]);
      queries = buildQueries(tradeTerms, location, isJob);
    }

    // Run ALL queries with num=10 and collect everything
    const allResults = [];
    for (const q of queries) {
      const items = await runSearch(q, tbs, serpKey, 10);
      allResults.push(...items);
    }

    let unique = dedup(allResults);
    console.log(`Total unique results: ${unique.length}`);

    // If still nothing, retry without date filter
    if (unique.length === 0 && tbs) {
      console.log('No results at all — retrying without date filter');
      for (const q of queries.slice(0, 3)) {
        const items = await runSearch(q, '', serpKey, 10);
        allResults.push(...items);
      }
      unique = dedup(allResults);
    }

    if (unique.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ leads: [], totalSearched: 0, message: 'No results found — try UK-wide or Any time' })
      };
    }

    // Send up to 30 candidates to Claude (was 10 before)
    const candidates = unique.slice(0, 30).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
    }));

    // First Claude pass
    let analysed     = await runClaude(candidates, tradeLabel, areaContext, isJob, claudeKey);
    let genuineLeads = Array.isArray(analysed) ? analysed.filter(l => l && l.isGenuineLead) : [];

    // Fix 7: Retry without date filter if Claude found nothing genuine
    if (genuineLeads.length === 0 && tbs) {
      console.log('Claude found nothing genuine — retrying without date filter');
      const widerResults = [];
      for (const q of queries.slice(0, 4)) {
        const items = await runSearch(q, '', serpKey, 10);
        widerResults.push(...items);
      }
      const widerUnique = dedup([...allResults, ...widerResults]);
      const widerCandidates = widerUnique.slice(0, 30).map(item => ({
        title:   item.title,
        snippet: item.snippet,
        link:    item.link,
        source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
      }));
      analysed     = await runClaude(widerCandidates, tradeLabel, areaContext, isJob, claudeKey);
      genuineLeads = Array.isArray(analysed) ? analysed.filter(l => l && l.isGenuineLead) : [];
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        leads:         genuineLeads,
        totalSearched: candidates.length,
        totalGenuine:  genuineLeads.length,
        trade, location, searchType,
        daysSearched:  days
      })
    };

  } catch (err) {
    console.error('Scanner error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
