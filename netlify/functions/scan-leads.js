/**
 * APTO Pro — Lead Scanner v7 — Modular Multi-Source Architecture
 *
 * Runs independent collectors in parallel:
 *   Collector 1: Google — site:reddit.com
 *   Collector 2: Google — site:mumsnet.com + site:gumtree.com
 *   Collector 3: Google — unrestricted (catches Facebook public posts)
 *   Collector 4: Bing — different index, catches content Google misses
 *   Collector 5: Google News — recent service requests in news/community sites
 *   Collector 6: Google — site:forums.moneysavingexpert.com + other forums
 *
 * All results merged → deduped → 50 best sent to Claude → filtered → shown
 *
 * v7 changes (audit recommendations #1, #3, #4, #5, #6 — the fixes confined to
 * this file; #2 concerns scheduled-scan.js and is tracked separately):
 *   #1 Every configured trade/synonym term is now OR'd together (orGroup()) —
 *      previously only allTerms[0]/[1] were ever used, so "all trades" mode
 *      only searched 2 of 8 trades and single-trade searches used 2 of up to
 *      6 synonyms.
 *   #3 REVERTED after production testing. Originally: wide radii relaxed the
 *      location match from a strict quoted phrase to an unquoted relevance
 *      signal. In practice Google's unquoted matching isn't geo-aware — it
 *      just makes the word optional/fuzzy — and this let same-named towns in
 *      other countries through (e.g. "Brighton" started surfacing Brighton,
 *      USA posts). Reverted to always-quoted location. `radius` is still
 *      accepted/reported but no longer changes the query. Real radius-aware
 *      search needs postcode/distance data, not a query-string heuristic.
 *   #4 Collector results are merged round-robin (interleave()) instead of
 *      simple concatenation, so the 30-candidate cap doesn't systematically
 *      starve whichever collectors happen to run later in the array. Claude's
 *      output is also sorted by score (descending) before being returned, so
 *      the best leads render first instead of in whatever order the model
 *      happened to list them.
 *   #5 REVERTED after production testing. Originally: removed the
 *      promotional-phrase exclusions (-"we offer" -"our services" etc.) so
 *      Claude would filter self-promotion semantically instead. In practice
 *      this flooded the raw candidate pool with company adverts that crowded
 *      genuine leads out of the fixed 30-candidate cap — Claude's semantic
 *      filtering alone wasn't a strong enough substitute. Restored the
 *      keyword exclusions.
 *   #6 All outbound fetches (SerpAPI + Claude) now have a timeout via
 *      AbortController, so one hung upstream request can no longer stall the
 *      whole function indefinitely. SERP_TIMEOUT_MS raised 10s -> 20s after
 *      the first version cut off legitimately-slower SerpAPI/Bing responses.
 *
 * v8 changes (audit follow-up — search recall):
 *   #A INTENTS has 15 phrases, but every collector only ever referenced
 *      INTENTS[0..4] by name (as i1..i5) — the other 10 ("does anyone know a
 *      good", "who does", "need help with", "recommendations please", etc.)
 *      were configured but never actually searched. All collectors now use
 *      ALL_INTENTS = orGroup(INTENTS), so every configured phrase is live.
 *   #B num/count raised 10 -> 20 per collector (SerpAPI supports up to 100;
 *      10 meant Google/Bing chose which 10 of many matches you saw). The
 *      candidate cap sent to Claude raised 30 -> 50 to match. google-open2
 *      now pages Google results 11-20 (`start: 10`) for the open query
 *      instead of duplicating google-open's first page.
 *
 * DEBUG INSTRUMENTATION (added post-v7, no lead logic changed):
 *   Pass ?debug=true to get a `debug` block in the JSON response showing,
 *   per collector: the exact query sent, raw result count, and normalised
 *   count; the merged/deduped unique count; the candidates actually sent to
 *   Claude; Claude's raw response text; which candidates were NOT returned
 *   as genuine leads (with title/snippet, so you can see what got rejected
 *   and why); whether the date filter was active; and whether either retry
 *   path fired. This only changes what is *reported*, not what is searched,
 *   scored, or filtered — every value logged is a value the handler was
 *   already computing.
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

// Radius (miles) at or above which we stop requiring the location as an exact
// quoted phrase. A 10-mile search around a town should still require that
// town's name; a 50-100 mile search shouldn't discard a post just because it
// says a neighbouring town instead of the one the user typed.
const LOOSE_RADIUS_THRESHOLD_MILES = 20;

// Default timeout applied to every outbound fetch (see fetchWithTimeout).
// SERP_TIMEOUT_MS was 10000 — raised after real-world testing showed some
// SerpAPI/Bing calls legitimately take 10-15s under load, which the original
// value was aborting as false-timeout failures (silently returning 0 results
// for that collector instead of its real, slower answer). durationMs/isTimeout
// are now recorded per collector in debug so this can be tuned from evidence
// instead of guesswork next time.
const SERP_TIMEOUT_MS   = 20000;
const CLAUDE_TIMEOUT_MS = 25000;

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// Wraps fetch() with an AbortController timeout so a single hung upstream
// request (SerpAPI or Anthropic) can't stall the whole function invocation.
async function fetchWithTimeout(url, options = {}, timeoutMs = SERP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Round-robins multiple result arrays into one, e.g. [[a,b],[c],[d,e]] -> [a,c,d,b,e].
// Used when merging collector output so the 30-candidate cap applied later
// doesn't systematically favour whichever collectors happen to come first.
function interleave(lists) {
  const out = [];
  const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

// ── COLLECTOR FUNCTIONS ───────────────────────────────────────────────────────

// Note: this used to catch its own errors and always resolve to [] — which
// meant a genuine "SerpAPI found nothing" and "the request timed out/failed"
// were indistinguishable in the response and in debug output. It now lets
// errors (including AbortError from a timeout) propagate to the caller
// (runCollectorBatch), which handles them via Promise.allSettled exactly the
// same way — a failed collector still contributes zero items to the search —
// but the failure is now visible in `debug.mainCollectors[].error/isTimeout`
// instead of being silently indistinguishable from a true empty result.
async function serpSearch(params, serpKey) {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('api_key', serpKey);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, String(v));
  }
  const res  = await fetchWithTimeout(url.toString(), {}, SERP_TIMEOUT_MS);
  const data = await res.json();
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);
  return data.organic_results || data.news_results || [];
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

// Builds a quoted OR-group from every configured term, e.g. ["plumber","boiler repair"]
// -> ("plumber" OR "boiler repair"). Ensures every synonym/trade actually gets searched
// instead of only the first one or two array entries.
function orGroup(terms) {
  const list = (Array.isArray(terms) ? terms : [terms]).filter(Boolean);
  if (list.length <= 1) return `"${list[0] || ''}"`;
  return '(' + list.map(t => `"${t}"`).join(' OR ') + ')';
}

// Runs a batch of {label, params} collector defs in parallel via serpSearch,
// returning both the normalised results (for the actual search pipeline) and
// a parallel debug array (query used, raw/normalised count, timing, and
// whether it failed/timed out) so callers can report exactly what happened
// without duplicating any logic. A failed collector still contributes zero
// items to the search — same as before — only now that fact is observable.
async function runCollectorBatch(defs, serpKey) {
  const settled = await Promise.allSettled(defs.map(async def => {
    const startedAt = Date.now();
    try {
      const raw = await serpSearch(def.params, serpKey);
      return { raw, durationMs: Date.now() - startedAt };
    } catch (err) {
      err.durationMs = Date.now() - startedAt;
      throw err;
    }
  }));
  const perCollectorResults = [];
  const debugEntries = [];
  settled.forEach((r, i) => {
    const def = defs[i];
    if (r.status === 'fulfilled') {
      const { raw, durationMs } = r.value;
      const norm = normalise(raw, def.label);
      perCollectorResults.push(norm);
      debugEntries.push({
        label: def.label,
        engine: def.params.engine,
        query: def.params.q,
        rawCount: raw.length,
        normalisedCount: norm.length,
        durationMs,
      });
    } else {
      const durationMs = r.reason?.durationMs ?? null;
      const isTimeout  = r.reason?.name === 'AbortError';
      console.error(`Collector "${def.label}" failed after ${durationMs}ms${isTimeout ? ' (timed out)' : ''}:`, r.reason?.message);
      perCollectorResults.push([]);
      debugEntries.push({
        label: def.label,
        engine: def.params.engine,
        query: def.params.q,
        rawCount: 0,
        normalisedCount: 0,
        durationMs,
        isTimeout,
        error: r.reason?.message || 'unknown error',
      });
    }
  });
  return { perCollectorResults, debugEntries };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Populated throughout the run; only ever returned to the client when
  // ?debug=true is passed. Declared before the try body so it's safe to read
  // in the catch block even if something throws early.
  let debug = { debugEnabled: false };

  try {
    const params      = event.queryStringParameters || {};
    const debugEnabled = params.debug === 'true';
    debug.debugEnabled = debugEnabled;

    const trade      = params.trade      || 'plumbing';
    const mode       = params.mode       || 'local';
    const location   = mode === 'national' ? '' : (params.location || '');
    const searchType = params.searchType || 'customer';
    const days       = params.days       || '7';
    const radius     = parseInt(params.radius, 10) || 10;
    const isJob      = searchType === 'jobs';
    const isAll      = trade === 'all';
    const tradeLabel = isAll ? 'any trade' : trade;
    const tbs        = days && days !== '0' ? `qdr:d${days}` : '';
    const areaCtx    = mode === 'national' ? 'anywhere in the UK' : `in or near ${location || 'the UK'}`;
    const serpKey    = process.env.SERPAPI_KEY;

    // REVERTED: previously (v7 #3) wide radii dropped the quotes around location
    // to "loosen" the match. In production this let unrelated same-named towns in
    // other countries through (e.g. searching "Brighton" started surfacing
    // Brighton, USA posts) — Google's unquoted term matching is not geo-aware,
    // it just makes the word optional/fuzzy, which is much worse than the
    // narrow-recall problem it was meant to fix. Reverted to always-quoted.
    // `radius` is still accepted and reported in `debug` for now; true
    // radius-aware search needs real postcode/distance data, not a query hack.
    const looseLocation = false;
    const loc = location ? ` "${location}"` : '';

    // Build trade-specific terms
    const tradeTermList = isJob
      ? (JOB_TERMS[trade]   || [trade + ' wanted'])
      : (TRADE_TERMS[trade] || [trade]);

    const allTerms = isAll ? (isJob
      ? ['tradesperson wanted', 'subcontractor needed', 'tradesman wanted']
      : ['plumber', 'electrician', 'builder', 'cleaner', 'gardener', 'decorator', 'roofer', 'handyman']
    ) : tradeTermList;

    // OR every configured term together so no synonym (or, in "all trades" mode, no
    // trade) is silently dropped. `term`/`term2` are pre-quoted OR-groups now, not
    // single bare words — do not wrap them in extra quotes at the call sites below.
    const term  = orGroup(allTerms);
    const term2 = term;
    // v8 #A / v8.1 fix: INTENTS has 15 phrases. Originally only INTENTS[0..4]
    // (i1..i5) were ever referenced anywhere, so 10 phrases were configured
    // but never searched — that was a real bug. But OR'ing all 15 into every
    // collector query (ALL_INTENTS) made each query ~70+ words, which is far
    // outside what a search engine parses sensibly as one query; that caused
    // the "zero leads anywhere" regression. Fix: keep each *live* collector
    // query short (3-4 phrases, like the original), but use the full list
    // only in the retry paths below (retryDefs/widerDefs) that already exist
    // specifically for when a narrow search comes back empty — the one place
    // extra query weight is worth paying for.
    const i1 = INTENTS[0];  // 'looking for a'
    const i2 = INTENTS[1];  // 'can anyone recommend'
    const i3 = INTENTS[2];  // 'need a'
    const i4 = INTENTS[3];  // 'after a'
    const i5 = INTENTS[4];  // 'any recommendations for'
    const ALL_INTENTS = orGroup(INTENTS); // kept for reference/debug only — do not use directly in a query
    // Broader than any single main-flow query, but capped at 6 phrases so a
    // retry query still stays in normal search-engine range (~35-40 words
    // total incl. term/location) rather than the ~70-word ALL_INTENTS bloat
    // that caused the zero-leads regression.
    const MEDIUM_INTENTS = orGroup([INTENTS[0], INTENTS[1], INTENTS[2], INTENTS[5], INTENTS[10], INTENTS[11]]);

    // Record the inputs that decide *what* gets searched, so a report of "volume
    // didn't improve" can be checked against what this specific invocation
    // actually configured — e.g. confirming allTerms/term reflect the intended
    // trade config, rather than guessing whether a deploy went out.
    Object.assign(debug, {
      trade, isAll, searchType, isJob, mode, location, radius, looseLocation,
      days, tbs, dateFilterActive: !!tbs,
      allTermsConfigured: allTerms,
      termGroupUsed: term,
      mainCollectors: [],
      uniqueAfterDedupe: 0,
      retryNoDateFilter: { ran: false, collectors: [], uniqueAfterRetry: null },
      candidatesSentToClaude: [],
      claudeRawResponse: null,
      claudeDurationMs: null,
      claudeParseOk: null,
      rejectedByClaudeCount: null,
      rejectedByClaude: [],
      claudeEmptyRetry: { ran: false, collectors: [], candidatesSent: [], rawResponse: null, claudeDurationMs: null, rejected: [] },
    });

    // ── PARALLEL COLLECTORS ──────────────────────────────────────────────────
    // All run simultaneously for speed. Defined declaratively (label + params)
    // so the exact query sent by each collector can be reported in `debug`
    // without duplicating the query strings separately.
    const collectorDefs = [];

    if (!isJob) {
      collectorDefs.push({ label: 'google-reddit', params: {
        engine: 'google', q: `("${i1}" OR "${i2}" OR "${i3}") ${term}${loc} site:reddit.com`,
        num: 20, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'google-mumsnet', params: {
        engine: 'google', q: `("${i1}" OR "${i2}" OR "${i5}" OR "${INTENTS[5]}") ${term}${loc} site:mumsnet.com`,
        num: 20, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'google-gumtree', params: {
        engine: 'google', q: `("${i1}" OR "${i3}" OR "wanted") ${term2}${loc} site:gumtree.com`,
        num: 20, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'google-forums', params: {
        engine: 'google',
        q: `("${i2}" OR "${i1}" OR "${INTENTS[10]}" OR "${INTENTS[11]}") ${term}${loc} (site:forums.moneysavingexpert.com OR site:diychatroom.com OR site:buildhub.org.uk OR site:pistonheads.com)`,
        num: 20, hl: 'en', gl: 'uk', tbs
      }});
      // REVERTED (v7 #5 removed the promotional-phrase exclusions here; production
      // testing showed the raw pool got flooded with company adverts, and Claude's
      // semantic filtering alone wasn't enough to keep them from crowding out
      // genuine leads in the fixed candidate cap). Restored below.
      collectorDefs.push({ label: 'google-open', params: {
        engine: 'google',
        q: `("${i1}" OR "${i2}" OR "${i3}") ${term}${loc} -"we offer" -"our services" -"call us today" -"get a quote from us" -"we specialise" -site:nextdoor.co.uk`,
        num: 20, hl: 'en', gl: 'uk', tbs
      }});
      // v8 #B: pages Google's *next* 10 organic results (11-20) for a
      // differently-worded open query via `start`, instead of re-fetching
      // page 1 under a different label — this is the fix for "you never see
      // result 11+". Uses a short set of the previously-unused intents
      // (INTENTS[6..9]) so this collector also surfaces different phrasing,
      // without ballooning the query the way ALL_INTENTS did.
      collectorDefs.push({ label: 'google-open2', params: {
        engine: 'google',
        q: `("${i4}" OR "${INTENTS[6]}" OR "${INTENTS[7]}" OR "${INTENTS[8]}" OR "${INTENTS[9]}") ${term2}${loc} -"we offer" -"our services" -site:nextdoor.co.uk`,
        num: 10, start: 10, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'bing', params: {
        engine: 'bing',
        q: `("${i1}" OR "${i2}" OR "${i3}") ${term}${loc ? loc : ' UK'} -"we offer" -"our services"`,
        count: 20, mkt: 'en-GB', freshness: tbs ? 'Week' : undefined
      }});
      // News gets the remaining previously-unused phrases (12-14), keeping its
      // own query short rather than adding to an already-used group elsewhere.
      collectorDefs.push({ label: 'google-news', params: {
        engine: 'google',
        q: `${term} ("${INTENTS[12]}" OR "${INTENTS[13]}" OR "${INTENTS[14]}")${loc ? loc : ' UK'}`,
        tbm: 'nws', num: 20, hl: 'en', gl: 'uk', tbs
      }});
    } else {
      collectorDefs.push({ label: 'google-reddit', params: {
        engine: 'google', q: `${term}${loc} site:reddit.com`, num: 20, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'google-gumtree', params: {
        engine: 'google', q: `${term}${loc} site:gumtree.com`, num: 20, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'google-open', params: {
        engine: 'google', q: `${term2}${loc} -"we offer" -"our services"`, num: 20, hl: 'en', gl: 'uk', tbs
      }});
      collectorDefs.push({ label: 'bing', params: {
        engine: 'bing', q: `${term}${loc ? loc : ' UK'}`, count: 20, mkt: 'en-GB'
      }});
    }

    console.log(`Running ${collectorDefs.length} collectors in parallel...`);
    const { perCollectorResults, debugEntries } = await runCollectorBatch(collectorDefs, serpKey);
    // Failures are already logged inside runCollectorBatch (with duration + timeout flag).
    debugEntries.forEach((d, i) => {
      if (!d.error) console.log(`Collector ${i + 1} (${d.label}): ${d.normalisedCount} results in ${d.durationMs}ms`);
    });
    debug.mainCollectors = debugEntries;

    // Merge all results round-robin across collectors (v7 #4) so the 30-candidate
    // cap applied below doesn't systematically starve whichever collectors are
    // later in the array.
    let allItems = interleave(perCollectorResults);

    // Deduplicate by URL
    const seen    = new Set();
    let   unique  = allItems.filter(item => {
      if (!item.link || seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    console.log(`Total unique items: ${unique.length} from ${allItems.length} raw`);
    debug.uniqueAfterDedupe = unique.length;

    // If nothing found with date filter, retry top 3 collectors without it
    if (unique.length === 0 && tbs) {
      console.log('No results — retrying without date filter');
      debug.retryNoDateFilter.ran = true;
      const retryDefs = [
        { label: 'google-reddit-retry', params: { engine:'google', q:`${MEDIUM_INTENTS} ${term}${loc} site:reddit.com`, num:20, hl:'en', gl:'uk' } },
        { label: 'google-open-retry',   params: { engine:'google', q:`${MEDIUM_INTENTS} ${term}${loc} -"we offer" -"our services"`, num:20, hl:'en', gl:'uk' } },
        { label: 'bing-retry',          params: { engine:'bing',   q:`${MEDIUM_INTENTS} ${term}${loc ? loc : ' UK'}`, count:20, mkt:'en-GB' } },
      ];
      const { perCollectorResults: retryNorm, debugEntries: retryDebug } = await runCollectorBatch(retryDefs, serpKey);
      debug.retryNoDateFilter.collectors = retryDebug;
      retryNorm.forEach(list => allItems.push(...list));
      unique = allItems.filter(item => { if (!item.link || seen.has(item.link)) return false; seen.add(item.link); return true; });
      debug.retryNoDateFilter.uniqueAfterRetry = unique.length;
    }

    if (unique.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          leads: [], totalSearched: 0, message: 'No results found — try UK-wide or Any time',
          ...(debugEnabled ? { debug } : {})
        })
      };
    }

    // Send up to 50 candidates to Claude (v8 #B — raised from 30 now that
    // collectors return more raw results per query)
    const candidates = unique.slice(0, 50).map(({ title, snippet, link, source, engine }) => ({
      title, snippet, link, source, engine
    }));
    debug.candidatesSentToClaude = candidates;

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

    const claudeStartedAt = Date.now();
    const claudeRes  = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{ role:'user', content:prompt }] })
    }, CLAUDE_TIMEOUT_MS);
    debug.claudeDurationMs = Date.now() - claudeStartedAt;

    const claudeData = await claudeRes.json();
    const rawText    = claudeData.content?.map(b => b.text||'').join('') || '[]';
    debug.claudeRawResponse = rawText;

    let analysed = [];
    try {
      analysed = JSON.parse(rawText.replace(/```json|```/g,'').trim());
      debug.claudeParseOk = true;
    } catch {
      try {
        const s = rawText.indexOf('['), e = rawText.lastIndexOf(']');
        if (s !== -1 && e > s) analysed = JSON.parse(rawText.slice(s, e+1));
        debug.claudeParseOk = true;
      } catch {
        console.error('JSON parse failed. Raw:', rawText.slice(0,200));
        debug.claudeParseOk = false;
      }
    }

    let genuineLeads = Array.isArray(analysed) ? analysed.filter(l => l?.isGenuineLead) : [];
    // Best leads first (v7 #4) — Claude's array order isn't guaranteed to be score order.
    genuineLeads.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Diagnostics only — figure out which of the candidates sent to Claude did NOT
    // come back as a genuine lead, matched by URL. Doesn't affect what's returned.
    {
      const genuineUrls = new Set(genuineLeads.map(l => l.sourceUrl));
      const rejected = candidates.filter(c => !genuineUrls.has(c.link));
      debug.rejectedByClaudeCount = rejected.length;
      debug.rejectedByClaude = rejected.map(c => ({ title: c.title, snippet: c.snippet, link: c.link, source: c.source, engine: c.engine }));
    }

    // Retry with no date filter if Claude found nothing
    if (genuineLeads.length === 0 && tbs && unique.length < 10) {
      console.log('Claude found nothing — retrying without date filter');
      debug.claudeEmptyRetry.ran = true;
      const widerDefs = [
        { label: 'google-reddit-wider', params: { engine:'google', q:`${MEDIUM_INTENTS} ${term}${loc} site:reddit.com`, num:20, hl:'en', gl:'uk' } },
        { label: 'google-open-wider',   params: { engine:'google', q:`${MEDIUM_INTENTS} ${term}${loc} -"we offer" -"our services"`, num:20, hl:'en', gl:'uk' } },
        { label: 'bing-wider',          params: { engine:'bing',   q:`${term}${loc ? loc:' UK'} ${MEDIUM_INTENTS}`, count:20, mkt:'en-GB' } },
      ];
      const { perCollectorResults: widerNorm, debugEntries: widerDebug } = await runCollectorBatch(widerDefs, serpKey);
      debug.claudeEmptyRetry.collectors = widerDebug;
      const widerItems = [];
      widerNorm.forEach(list => widerItems.push(...list));
      const widerUnique = widerItems.filter(item => { if (!item.link||seen.has(item.link)) return false; seen.add(item.link); return true; });
      if (widerUnique.length > 0) {
        const widerCandidates = widerUnique.slice(0,50).map(({title,snippet,link,source,engine})=>({title,snippet,link,source,engine}));
        debug.claudeEmptyRetry.candidatesSent = widerCandidates;
        const wStartedAt = Date.now();
        const wRes = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method:'POST', headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{role:'user',content:prompt.replace(JSON.stringify(candidates),JSON.stringify(widerCandidates))}] })
        }, CLAUDE_TIMEOUT_MS);
        debug.claudeEmptyRetry.claudeDurationMs = Date.now() - wStartedAt;
        const wData = await wRes.json();
        const wText = wData.content?.map(b=>b.text||'').join('')||'[]';
        debug.claudeEmptyRetry.rawResponse = wText;
        try {
          const wArr = JSON.parse(wText.replace(/```json|```/g,'').trim());
          genuineLeads = Array.isArray(wArr) ? wArr.filter(l=>l?.isGenuineLead) : [];
          genuineLeads.sort((a, b) => (b.score || 0) - (a.score || 0));
          const genuineUrls = new Set(genuineLeads.map(l => l.sourceUrl));
          debug.claudeEmptyRetry.rejected = widerCandidates
            .filter(c => !genuineUrls.has(c.link))
            .map(c => ({ title: c.title, snippet: c.snippet, link: c.link, source: c.source, engine: c.engine }));
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
        trade, location, searchType, radius,
        daysSearched:  days,
        collectorsRun: collectorDefs.length,
        ...(debugEnabled ? { debug } : {})
      })
    };

  } catch (err) {
    console.error('Scanner error:', err);
    return {
      statusCode:500, headers,
      body: JSON.stringify({ error: err.message, ...(debug.debugEnabled ? { debug } : {}) })
    };
  }
};
