/**
 * APTO Pro — Lead Scanner (SerpAPI)
 * Searches public community sites for genuine service requests
 * Excludes businesses offering services — only people seeking them
 */

const TRADE_TERMS = {
  plumbing:        ['plumber', 'plumbing', 'boiler', 'burst pipe', 'no hot water', 'leak'],
  electrical:      ['electrician', 'electrical', 'fuse box', 'rewire', 'electrics'],
  decorating:      ['decorator', 'painter', 'decorating', 'painting', 'wallpaper'],
  gardening:       ['gardener', 'gardening', 'garden', 'landscaper', 'lawn', 'hedge'],
  building:        ['builder', 'building work', 'extension', 'loft conversion'],
  'dog-grooming':  ['dog groomer', 'dog grooming', 'pet grooming'],
  cleaning:        ['cleaner', 'cleaning', 'end of tenancy', 'carpet clean'],
  removals:        ['removal', 'removals', 'man and van', 'moving house'],
  hvac:            ['boiler engineer', 'gas engineer', 'central heating', 'air conditioning'],
  locksmith:       ['locksmith', 'locked out', 'lock change'],
  catering:        ['caterer', 'catering', 'wedding catering', 'event catering'],
  photography:     ['photographer', 'photography', 'wedding photographer'],
  'windows-doors': ['window fitter', 'double glazing', 'UPVC windows', 'new windows'],
  hairdressing:    ['hairdresser', 'mobile hairdresser', 'hair stylist'],
  general:         ['handyman', 'odd jobs', 'general help', 'home repairs'],
  carer:           ['carer', 'care worker', 'home help', 'elderly care'],
  clearance:       ['house clearance', 'rubbish removal', 'garden clearance'],
  roofing:         ['roofer', 'roofing', 'roof repair', 'roof leak'],
  plastering:      ['plasterer', 'plastering', 'skim coat', 'ceiling repair'],
  tiling:          ['tiler', 'tiling', 'tile fitting', 'bathroom tiles'],
};

const JOB_KEYWORDS = {
  plumbing:        ['plumber wanted', 'self employed plumber', 'subcontractor plumber'],
  electrical:      ['electrician wanted', 'self employed electrician', 'subcontractor electrician'],
  decorating:      ['decorator wanted', 'painter decorator wanted', 'self employed decorator'],
  gardening:       ['gardener wanted', 'self employed gardener', 'landscaper wanted'],
  building:        ['builder wanted', 'self employed builder', 'subcontractor builder'],
  'dog-grooming':  ['dog groomer wanted', 'groomer vacancy'],
  cleaning:        ['cleaner wanted', 'self employed cleaner', 'cleaning staff wanted'],
  removals:        ['removal driver wanted', 'man and van wanted', 'self employed removal'],
  hvac:            ['gas engineer wanted', 'hvac engineer wanted', 'heating engineer wanted'],
  locksmith:       ['locksmith wanted', 'self employed locksmith'],
  catering:        ['caterer wanted', 'self employed caterer', 'catering staff wanted'],
  photography:     ['photographer wanted', 'self employed photographer'],
  'windows-doors': ['window fitter wanted', 'self employed glazier'],
  hairdressing:    ['hairdresser wanted', 'self employed hairdresser'],
  general:         ['handyman wanted', 'odd job man wanted', 'general labourer wanted'],
  carer:           ['carer wanted', 'care worker wanted', 'home help wanted'],
  clearance:       ['clearance operative wanted', 'rubbish removal driver wanted'],
  roofing:         ['roofer wanted', 'self employed roofer', 'roofing subcontractor'],
  plastering:      ['plasterer wanted', 'self employed plasterer'],
  tiling:          ['tiler wanted', 'self employed tiler'],
};

// Sites that have genuine community posts from real people
// Ordered by likelihood of genuine local service requests
const COMMUNITY_SITES = [
  'site:reddit.com',
  'site:mumsnet.com',
  'site:moneysavingexpert.com',
  'site:gumtree.com',
  'site:nextdoor.co.uk',
  'site:boards.ie',
  'site:pistonheads.com',
  'site:buildhub.org.uk',
  'site:diychatroom.com',
  'site:houzz.co.uk',
];

// Build a query targeting specific community sites
function buildSiteQuery(intentPhrase, tradeTerm, location, siteGroup) {
  const sitePart = siteGroup.join(' OR ');
  const loc = location ? ` ${location}` : ' UK';
  return `"${intentPhrase}" "${tradeTerm}"${loc} (${sitePart})`;
}

// Simple query without site restriction as fallback
function buildSimpleQuery(intentPhrase, tradeTerm, location) {
  const loc = location ? ` ${location}` : ' UK';
  return `"${intentPhrase}" "${tradeTerm}"${loc} -"we offer" -"our services" -"contact us" -"get a quote from us" -"we provide" -"our team"`;
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
    const location   = mode === 'national' ? '' : (params.location || 'UK');
    const searchType = params.searchType || 'customer';
    const days       = params.days       || '5';

    const isAllTrades = trade === 'all';
    const isJobSearch = searchType === 'jobs';
    const tradeLabel  = isAllTrades ? 'any trade' : trade;
    const tbs         = days && days !== '0' ? `qdr:d${days}` : '';

    // Build query list — try community sites first, then broader search
    let queries = [];

    if (isJobSearch) {
      const jobKws = isAllTrades
        ? ['tradesperson wanted', 'subcontractor needed', 'self employed tradesman wanted']
        : (JOB_KEYWORDS[trade] || ['tradesperson wanted']);
      // Job searches work fine without site restrictions
      queries = jobKws.slice(0, 4).map(kw => buildSimpleQuery(kw, '', location).replace('""', ''));

    } else if (isAllTrades) {
      const intents = ['looking for', 'can anyone recommend', 'need a', 'recommendations please'];
      const trades  = ['plumber', 'electrician', 'builder', 'cleaner', 'gardener', 'decorator'];
      const sitePart = COMMUNITY_SITES.slice(0, 5).join(' OR ');
      queries = [
        `("looking for" OR "can anyone recommend" OR "need a" OR "need someone") AND (plumber OR electrician OR builder OR cleaner OR gardener) ${location || 'UK'} (${sitePart})`,
        `("looking for" OR "can anyone recommend" OR "need a") AND (roofer OR plasterer OR tiler OR handyman OR carer OR removals) ${location || 'UK'} (${sitePart})`,
        // Fallback without site restriction
        `("looking for" OR "can anyone recommend" OR "need a") AND (plumber OR electrician OR builder OR cleaner OR gardener) ${location || 'UK'} -"we offer" -"our services" -"contact us"`,
      ];

    } else {
      const tradeTerms = TRADE_TERMS[trade] || [trade];
      const intents    = ['looking for a', 'can anyone recommend', 'need a', 'after a', 'recommendations please', 'anyone know a good'];
      const sitePart   = COMMUNITY_SITES.slice(0, 5).join(' OR ');

      queries = [
        // Tier 1: Community sites + intent + trade term
        `("${intents[0]}" OR "${intents[1]}" OR "${intents[2]}") "${tradeTerms[0]}"${location ? ' ' + location : ' UK'} (${sitePart})`,
        // Tier 2: More intent phrases + community sites
        `("${intents[3]}" OR "${intents[4]}" OR "${intents[5]}") "${tradeTerms[0]}"${location ? ' ' + location : ' UK'} (${sitePart})`,
        // Tier 3: Second trade term + community sites
        ...(tradeTerms.slice(1, 3).map(t =>
          `("looking for" OR "can anyone recommend" OR "need") "${t}"${location ? ' ' + location : ' UK'} (${sitePart})`
        )),
        // Tier 4: Broader search with negative keywords to filter out businesses
        `("looking for" OR "can anyone recommend" OR "need a") "${tradeTerms[0]}"${location ? ' ' + location : ' UK'} -"we offer" -"our services" -"get a quote from us" -"we provide" -"call us today" -"visit our website"`,
      ];
    }

    // Search via SerpAPI
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
      console.log(`${items.length} results for: ${query.slice(0,80)}`);

      if (items.length > 0) {
        results   = items;
        usedQuery = query;
        break;
      }
    }

    // Retry without date filter if nothing found
    if (results.length === 0 && tbs) {
      console.log('Retrying without date filter');
      const q       = queries[0];
      const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}&num=10&hl=en&gl=uk`;
      const res     = await fetch(serpUrl);
      const data    = await res.json();
      results       = data.organic_results || [];
      usedQuery     = q + ' (no date filter)';
    }

    if (results.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ leads: [], totalSearched: 0, message: 'No results found' }) };
    }

    // Claude analysis — strict prompt to exclude businesses offering services
    const candidates = results.slice(0, 8).map(item => ({
      title:   item.title,
      snippet: item.snippet,
      link:    item.link,
      source:  (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
    }));

    const areaContext = mode === 'national' ? 'UK-wide' : `in or near ${location}`;

    const prompt = isJobSearch
      ? `You are APTO Pro Job Finder. From these search results, identify genuine job or subcontract opportunities for a self-employed ${tradeLabel} tradesperson working ${areaContext}.

INCLUDE: Posts where a homeowner, business or contractor is hiring a tradesperson for a specific job or ongoing work.
EXCLUDE: Recruitment agency listings, permanent salaried roles, unrelated content, businesses advertising their own services.

Respond ONLY with a JSON array, no markdown, no explanation:
[{"isGenuineLead":true,"score":85,"headline":"brief job description","urgency":"Normal","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Professional expression of interest under 50 words","sourceUrl":"url","sourceName":"site name"}]

RESULTS:
${JSON.stringify(candidates)}`

      : `You are APTO Pro Lead Filter. From these search results, identify genuine posts from MEMBERS OF THE PUBLIC who are LOOKING FOR someone to do ${tradeLabel} work ${areaContext}.

INCLUDE ONLY: Posts where a real person is asking for recommendations, looking for someone to hire, or requesting a service. Phrases like "can anyone recommend", "looking for", "need a", "does anyone know a good", "after a reliable" are strong signals.

STRICTLY EXCLUDE — mark isGenuineLead as false for ALL of these:
- Any business or tradesperson advertising THEIR OWN services ("we offer", "our team", "call us", "get a quote from us", "we specialise in")
- Directory listings, review sites, company websites
- News articles, blog posts, guides or how-to content
- Job adverts from businesses hiring staff
- Any content where someone is OFFERING a service rather than SEEKING one

If you are unsure whether it is a person seeking help or a business offering help, mark it as false.

Respond ONLY with a JSON array, no markdown, no explanation:
[{"isGenuineLead":true,"score":85,"headline":"what they need in 10 words","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"Natural reply under 50 words as if you are the tradesperson responding directly","sourceUrl":"url","sourceName":"site name"}]

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
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
