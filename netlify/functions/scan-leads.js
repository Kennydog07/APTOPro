/**
 * APTO Pro — Lead Scanner v6 — Modular Multi-Source Architecture
 *
 * Runs independent collectors in parallel:
 *   Collector 1: Google — site:reddit.com
 *   Collector 2: Google — site:mumsnet.com + site:gumtree.com
 *   Collector 3: Google — unrestricted (catches Facebook public posts)
 *   Collector 4: Bing — different index, catches content Google misses
 *   Collector 5: Google News — recent service requests in news/community sites
 *   Collector 6: Google — site:forums.moneysavingexpert.com + other forums
 *
 * All results merged → deduped → 30 best sent to Claude → filtered → shown
 */

// ── TRADE CONFIGURATION ──────────────────────────────────────────────────────

const TRADE_TERMS = {
  plumbing:        ['plumber', 'plumbing', 'boiler repair', 'burst pipe', 'no hot water', 'leak fix'],
  electrical:      ['electrician', 'electrics', 'fuse box', 'rewire', 'electrical fault'],
  decorating:      ['decorator', 'painter decorator', 'painting decorating', 'wallpapering'],
  gardening:       ['gardener', 'garden maintenance', 'lawn care', 'landscaper', 'hedge trim'],
  building:        ['builder', 'building work', 'house extension', 'loft conversion', 'renovation'],
  'dog-grooming':  ['dog groomer', 'dog grooming', 'mobile dog groomer'],
  cleaning:        ['cleaner', 'domestic cleaning', 'end of tenancy clean', 'carpet cleaning'],
  removals:        ['removal company', 'man and van', 'house removals', 'moving company'],
  hvac:            ['boiler service', 'gas engineer', 'central heating repair', 'air conditioning'],
  locksmith:       ['locksmith', 'locked out', 'lock replacement'],
  catering:        ['caterer', 'event catering', 'wedding catering', 'buffet service'],
  photography:     ['photographer', 'wedding photographer', 'event photographer'],
  'windows-doors': ['window fitter', 'double glazing', 'UPVC windows', 'door replacement'],
  hairdressing:    ['mobile hairdresser', 'hairdresser', 'home hair stylist'],
  general:         ['handyman', 'odd jobs', 'home maintenance', 'DIY help'],
  carer:           ['carer', 'home help', 'elderly care', 'care worker'],
  clearance:       ['house clearance', 'rubbish removal', 'garden waste removal'],
  roofing:         ['roofer', 'roof repair', 'flat roof', 'roof leak'],
  plastering:      ['plasterer', 'plastering', 'skim plaster', 'ceiling repair'],
  tiling:          ['tiler', 'tile fitting', 'bathroom tiling', 'kitchen tiling'],
};

const JOB_TERMS = {
  plumbing:   ['plumber wanted', 'plumber needed', 'subcontractor plumber'],
  electrical: ['electrician wanted', 'electrician needed'],
  decorating: ['decorator wanted', 'painter wanted'],
  gardening:  ['gardener wanted', 'landscaper wanted'],
  building:   ['builder wanted', 'builder needed', 'subcontractor builder'],
  cleaning:   ['cleaner wanted', 'cleaner needed'],
  removals:   ['removal driver wanted', 'man and van wanted'],
  hvac:       ['gas engineer wanted', 'heating engineer wanted'],
  general:    ['handyman wanted', 'odd job man wanted'],
  carer:      ['carer wanted', 'care worker wanted'],
  clearance:  ['clearance driver wanted'],
  roofing:    ['roofer wanted', 'roofing subcontractor'],
  plastering: ['plasterer wanted'],
  tiling:     ['tiler wanted'],
};

// Broad intent phrases covering how real people actually post
const INTENTS = [
  'looking for a', 'can anyone recommend', 'need a', 'after a',
  'any recommendations for', 'does anyone know a good', 'looking to get',
  'need someone to', 'getting quotes for', 'any good', 'recommendations please',
  'need help with', 'who does', 'anyone used a', 'can someone recommend',
];

// ── COLLECTOR FUNCTIONS ───────────────────────────────────────────────────────

async function serpSearch(params, serpKey) {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('api_key', serpKey);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, String(v));
  }
  try {
    const res  = await fetch(url.toString());
    const data = await res.json();
    if (data.error) { console.error('SerpAPI:', data.error); return []; }
    return data.organic_results || data.news_results || [];
  } catch (err) {
    console.error('Fetch error:', err.message);
    return [];
  }
}

function normalise(items, source) {
  return items.map(item => ({
    title:   item.title   || '',
    snippet: item.snippet || item.description || '',
    link:    item.link    || item.url || '',
    source:  (() => { try { return new URL(item.link || item.url || '').hostname; } catch { return source; } })(),
    engine:  source,
  })).filter(item => item.link && item.title);
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

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
    const days       = params.days       || '7';
    const isJob      = searchType === 'jobs';
    const isAll      = trade === 'all';
    const tradeLabel = isAll ? 'any trade' : trade;
    const tbs        = days && days !== '0' ? `qdr:d${days}` : '';
    const areaCtx    = mode === 'national' ? 'anywhere in the UK' : `in or near ${location || 'the UK'}`;
    const serpKey    = process.env.SERPAPI_KEY;
    const loc        = location ? ` "${location}"` : '';

    // Build trade-specific terms
    const tradeTermList = isJob
      ? (JOB_TERMS[trade]   || [trade + ' wanted'])
      : (TRADE_TERMS[trade] || [trade]);

    const allTerms = isAll ? (isJob
      ? ['tradesperson wanted', 'subcontractor needed', 'tradesman wanted']
      : ['plumber', 'electrician', 'builder', 'cleaner', 'gardener', 'decorator', 'roofer', 'handyman']
    ) : tradeTermList;

    const term  = allTerms[0];
    const term2 = allTerms[1] || term;
    const term3 = allTerms[2] || term;
    const i1    = INTENTS[0];
    const i2    = INTENTS[1];
    const i3    = INTENTS[2];
    const i4    = INTENTS[3];
    const i5    = INTENTS[4];

    // ── PARALLEL COLLECTORS ──────────────────────────────────────────────────
    // All run simultaneously for speed
    const collectors = [];

    if (!isJob) {
      // C1: Google — Reddit (most reliable community posts)
      collectors.push(serpSearch({
        engine: 'google', q: `("${i1}" OR "${i2}" OR "${i3}") "${term}"${loc} site:reddit.com`,
        num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-reddit')));

      // C2: Google — Mumsnet (UK domestic trades gold mine)
      collectors.push(serpSearch({
        engine: 'google', q: `("${i1}" OR "${i2}" OR "${i5}") "${term}"${loc} site:mumsnet.com`,
        num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-mumsnet')));

      // C3: Google — Gumtree services wanted
      collectors.push(serpSearch({
        engine: 'google', q: `("${i1}" OR "${i3}" OR "wanted") "${term2}"${loc} site:gumtree.com`,
        num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-gumtree')));

      // C4: Google — MSE forums + other UK forums
      collectors.push(serpSearch({
        engine: 'google',
        q: `("${i2}" OR "${i1}") "${term}"${loc} (site:forums.moneysavingexpert.com OR site:diychatroom.com OR site:buildhub.org.uk OR site:pistonheads.com)`,
        num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-forums')));

      // C5: Google — Unrestricted (catches Facebook public posts, local blogs, etc.)
      collectors.push(serpSearch({
        engine: 'google',
        q: `("${i1}" OR "${i2}" OR "${i3}") "${term}"${loc} -"we offer" -"our services" -"call us today" -"get a quote from us" -"we specialise" -site:nextdoor.co.uk`,
        num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-open')));

      // C6: Google — Different intent phrases, unrestricted
      collectors.push(serpSearch({
        engine: 'google',
        q: `("${i4}" OR "${i5}" OR "need someone to" OR "any good" OR "getting quotes") "${term2}"${loc} -"we offer" -"our services" -site:nextdoor.co.uk`,
        num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-open2')));

      // C7: Bing — Different index, often surfaces different community content
      collectors.push(serpSearch({
        engine: 'bing',
        q: `("${i1}" OR "${i2}" OR "${i3}") "${term}"${loc ? loc : ' UK'} -"we offer" -"our services"`,
        count: 10, mkt: 'en-GB', freshness: tbs ? 'Week' : undefined
      }, serpKey).then(r => normalise(r, 'bing')));

      // C8: Google News — catches recent community posts indexed as news
      collectors.push(serpSearch({
        engine: 'google',
        q: `"${term}" "looking for" OR "need a" OR "can anyone recommend"${loc ? loc : ' UK'}`,
        tbm: 'nws', num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-news')));

    } else {
      // Job search collectors
      collectors.push(serpSearch({
        engine: 'google', q: `"${term}"${loc} site:reddit.com`, num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-reddit')));

      collectors.push(serpSearch({
        engine: 'google', q: `"${term}"${loc} site:gumtree.com`, num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-gumtree')));

      collectors.push(serpSearch({
        engine: 'google', q: `"${term2}"${loc} -"we offer" -"our services"`, num: 10, hl: 'en', gl: 'uk', tbs
      }, serpKey).then(r => normalise(r, 'google-open')));

      collectors.push(serpSearch({
        engine: 'bing', q: `"${term}"${loc ? loc : ' UK'}`, count: 10, mkt: 'en-GB'
      }, serpKey).then(r => normalise(r, 'bing')));
    }

    // Run all collectors in parallel
    console.log(`Running ${collectors.length} collectors in parallel...`);
    const results = await Promise.allSettled(collectors);

    // Merge all results
    let allItems = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        console.log(`Collector ${i + 1}: ${r.value.length} results`);
        allItems.push(...r.value);
      } else {
        console.error(`Collector ${i + 1} failed:`, r.reason?.message);
      }
    });

    // Deduplicate by URL
    const seen    = new Set();
    let   unique  = allItems.filter(item => {
      if (!item.link || seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    console.log(`Total unique items: ${unique.length} from ${allItems.length} raw`);

    // If nothing found with date filter, retry top 3 collectors without it
    if (unique.length === 0 && tbs) {
      console.log('No results — retrying without date filter');
      const retryCollectors = collectors.slice(0, 3);
      const retryResults    = await Promise.allSettled(
        [
          serpSearch({ engine:'google', q:`("${i1}" OR "${i2}" OR "${i3}") "${term}"${loc} site:reddit.com`, num:10, hl:'en', gl:'uk' }, serpKey).then(r => normalise(r,'google-reddit')),
          serpSearch({ engine:'google', q:`("${i1}" OR "${i2}") "${term}"${loc} -"we offer" -"our services"`, num:10, hl:'en', gl:'uk' }, serpKey).then(r => normalise(r,'google-open')),
          serpSearch({ engine:'bing', q:`("${i1}" OR "${i2}") "${term}"${loc ? loc : ' UK'}`, count:10, mkt:'en-GB' }, serpKey).then(r => normalise(r,'bing')),
        ]
      );
      retryResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });
      unique = allItems.filter(item => { if (!item.link || seen.has(item.link)) return false; seen.add(item.link); return true; });
    }

    if (unique.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ leads: [], totalSearched: 0, message: 'No results found — try UK-wide or Any time' }) };
    }

    // Send up to 30 candidates to Claude
    const candidates = unique.slice(0, 30).map(({ title, snippet, link, source, engine }) => ({
      title, snippet, link, source, engine
    }));

    // ── CLAUDE SCORING ───────────────────────────────────────────────────────
    const prompt = isJob
      ? `You are APTO Pro. Find genuine job/subcontract opportunities for a self-employed ${tradeLabel} working ${areaCtx}.

Include: homeowners, landlords, businesses, letting agents, cafes, offices needing a tradesperson for a specific job.
Exclude: businesses advertising their OWN services, pure recruitment for employed staff, completely unrelated results.

Return ONLY a valid JSON array, nothing else. Empty array if no leads: []

[{"isGenuineLead":true,"score":80,"headline":"brief description","urgency":"Normal","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"professional reply under 40 words","sourceUrl":"https://...","sourceName":"reddit.com"}]

RESULTS:
${JSON.stringify(candidates)}`

      : `You are APTO Pro Lead Filter. Find genuine posts from people SEEKING a ${tradeLabel} service ${areaCtx}.

Include broadly — all valid leads:
- Homeowners, tenants, landlords, businesses, cafes, schools, offices seeking a trade
- Anyone asking for recommendations, quotes, or someone to do a job
- Phrases: "can anyone recommend", "looking for", "need a", "any good", "getting quotes", "after a reliable", "who does"

Exclude only clear non-leads:
- A tradesperson or business advertising their OWN services ("we offer", "our services", "call us", "get a quote from us")
- Pure company/directory pages with no human request
- Completely off-topic content

When in doubt, INCLUDE — missing a borderline lead is worse than including one.
The "engine" field shows which search engine found it — use this as context only.

Return ONLY a valid JSON array, nothing else. Empty array if no leads: []

[{"isGenuineLead":true,"score":80,"headline":"what they need in 10 words","urgency":"High","detectedLocation":"Brighton","detectedTrade":"Plumbing","reply":"friendly reply as tradesperson under 40 words","sourceUrl":"https://...","sourceName":"reddit.com"}]

RESULTS:
${JSON.stringify(candidates)}`;

    const claudeRes  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{ role:'user', content:prompt }] })
    });

    const claudeData = await claudeRes.json();
    const rawText    = claudeData.content?.map(b => b.text||'').join('') || '[]';

    let analysed = [];
    try {
      analysed = JSON.parse(rawText.replace(/```json|```/g,'').trim());
    } catch {
      try {
        const s = rawText.indexOf('['), e = rawText.lastIndexOf(']');
        if (s !== -1 && e > s) analysed = JSON.parse(rawText.slice(s, e+1));
      } catch { console.error('JSON parse failed. Raw:', rawText.slice(0,200)); }
    }

    let genuineLeads = Array.isArray(analysed) ? analysed.filter(l => l?.isGenuineLead) : [];

    // Retry with no date filter if Claude found nothing
    if (genuineLeads.length === 0 && tbs && unique.length < 10) {
      console.log('Claude found nothing — retrying without date filter');
      const widerItems = [];
      const widerCollectors = await Promise.allSettled([
        serpSearch({ engine:'google', q:`("${i1}" OR "${i2}" OR "${i3}") "${term}"${loc} site:reddit.com`, num:10, hl:'en', gl:'uk' }, serpKey).then(r=>normalise(r,'google-reddit')),
        serpSearch({ engine:'google', q:`("${i1}" OR "${i2}") "${term}"${loc} -"we offer" -"our services"`, num:10, hl:'en', gl:'uk' }, serpKey).then(r=>normalise(r,'google-open')),
        serpSearch({ engine:'bing', q:`"${term}"${loc ? loc:' UK'} "${i1}" OR "${i2}"`, count:10, mkt:'en-GB' }, serpKey).then(r=>normalise(r,'bing')),
      ]);
      widerCollectors.forEach(r => { if (r.status==='fulfilled') widerItems.push(...r.value); });
      const widerUnique = widerItems.filter(item => { if (!item.link||seen.has(item.link)) return false; seen.add(item.link); return true; });
      if (widerUnique.length > 0) {
        const widerCandidates = widerUnique.slice(0,30).map(({title,snippet,link,source,engine})=>({title,snippet,link,source,engine}));
        const wRes = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST', headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{role:'user',content:prompt.replace(JSON.stringify(candidates),JSON.stringify(widerCandidates))}] })
        });
        const wData = await wRes.json();
        const wText = wData.content?.map(b=>b.text||'').join('')||'[]';
        try {
          const wArr = JSON.parse(wText.replace(/```json|```/g,'').trim());
          genuineLeads = Array.isArray(wArr) ? wArr.filter(l=>l?.isGenuineLead) : [];
        } catch {}
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        leads:         genuineLeads,
        totalSearched: candidates.length,
        totalGenuine:  genuineLeads.length,
        trade, location, searchType,
        daysSearched:  days,
        collectorsRun: collectors.length,
      })
    };

  } catch (err) {
    console.error('Scanner error:', err);
    return { statusCode:500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
