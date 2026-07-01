/**
 * APTO Pro — Scheduled Lead Scanner
 * Runs every hour via Netlify scheduled functions
 * Scans for leads and stores them in Supabase
 * 
 * Schedule: defined in netlify.toml
 */

const TRADE_TERMS = {
  plumbing:        ['plumber', 'plumbing', 'boiler', 'burst pipe', 'no hot water'],
  electrical:      ['electrician', 'electrical', 'fuse box', 'rewire'],
  decorating:      ['decorator', 'painter', 'decorating', 'painting'],
  gardening:       ['gardener', 'gardening', 'garden', 'landscaper', 'lawn'],
  building:        ['builder', 'building', 'extension', 'loft conversion'],
  'dog-grooming':  ['dog groomer', 'dog grooming', 'mobile groomer'],
  cleaning:        ['cleaner', 'cleaning', 'end of tenancy', 'carpet clean'],
  removals:        ['removal', 'removals', 'man and van', 'moving house'],
  hvac:            ['boiler engineer', 'gas engineer', 'central heating', 'air conditioning'],
  locksmith:       ['locksmith', 'locked out', 'lock change'],
  catering:        ['caterer', 'catering', 'wedding catering'],
  photography:     ['photographer', 'photography', 'wedding photographer'],
  'windows-doors': ['window fitter', 'double glazing', 'UPVC windows'],
  hairdressing:    ['hairdresser', 'mobile hairdresser', 'hair stylist'],
  general:         ['handyman', 'odd jobs', 'general help', 'home repairs'],
  carer:           ['carer', 'care worker', 'home help', 'elderly care'],
  clearance:       ['house clearance', 'rubbish removal', 'garden clearance'],
  roofing:         ['roofer', 'roofing', 'roof repair'],
  plastering:      ['plasterer', 'plastering', 'skim coat'],
  tiling:          ['tiler', 'tiling', 'tile fitting'],
};

const INTENT_PHRASES = ['looking for', 'can anyone recommend', 'need a', 'need someone', 'who can', 'anyone know', 'urgent', 'ASAP', 'help wanted', 'after a'];

async function searchAndAnalyse(trade, location) {
  const tradeTerms = TRADE_TERMS[trade] || [trade];
  const intentPart = INTENT_PHRASES.slice(0, 4).map(p => `"${p}"`).join(' OR ');
  const tradePart  = tradeTerms.slice(0, 4).map(t => `"${t}"`).join(' OR ');
  const query      = `(${intentPart}) AND (${tradePart}) ${location}`;

  const serpUrl = new URL('https://serpapi.com/search.json');
  serpUrl.searchParams.set('q',       query);
  serpUrl.searchParams.set('api_key', process.env.SERPAPI_KEY);
  serpUrl.searchParams.set('num',     '10');
  serpUrl.searchParams.set('hl',      'en');
  serpUrl.searchParams.set('gl',      'uk');
  serpUrl.searchParams.set('tbs',     'qdr:d1'); // last 24 hours

  const res  = await fetch(serpUrl.toString());
  const data = await res.json();

  if (data.error || !data.organic_results?.length) return [];

  const candidates = data.organic_results.slice(0, 5).map(item => ({
    title: item.title, snippet: item.snippet, link: item.link,
    source: (() => { try { return new URL(item.link).hostname; } catch { return item.link; } })()
  }));

  const prompt = `You are APTO Pro Lead Filter. From these search results find genuine service requests from people looking for a ${trade} service in ${location}. Be generous — include anything that MIGHT be a real person seeking help. JSON array only, no markdown:
[{"isGenuineLead":true,"score":85,"headline":"what they need","urgency":"High","detectedLocation":"Brighton","detectedTrade":"${trade}","reply":"Natural reply under 50 words","sourceUrl":"url","sourceName":"site"}]
RESULTS:${JSON.stringify(candidates)}`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  });

  const claudeData = await claudeRes.json();
  const rawText    = claudeData.content?.map(b => b.text || '').join('') || '[]';
  const cleaned    = rawText.replace(/```json|```/g, '').trim();

  try {
    const results = JSON.parse(cleaned);
    return results.filter(r => r.isGenuineLead);
  } catch { return []; }
}

async function saveLeadsToSupabase(leads, userId, trade, location) {
  if (!leads.length) return;

  const rows = leads.map(lead => ({
    user_id:          userId,
    trade:            lead.detectedTrade || trade,
    location:         lead.detectedLocation || location,
    headline:         lead.headline,
    score:            lead.score,
    urgency:          lead.urgency,
    reply:            lead.reply,
    source_url:       lead.sourceUrl,
    source_name:      lead.sourceName,
    is_read:          false,
    found_at:         new Date().toISOString(),
  }));

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        'return=minimal'
    },
    body: JSON.stringify(rows)
  });

  console.log(`Saved ${rows.length} leads for user ${userId}. Status: ${res.status}`);
}

exports.handler = async () => {
  console.log('Scheduled scan starting:', new Date().toISOString());

  try {
    // Get all users with alerts enabled from user_settings
    const settingsRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/user_settings?alerts_enabled=eq.true&select=user_id,trade,alert_email`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );

    const settings = await settingsRes.json();
    console.log(`Found ${settings.length} users with alerts enabled`);

    // For each user, scan for their trade
    for (const setting of settings) {
      const trade    = setting.trade || 'plumbing';
      const location = 'UK'; // Could personalise per user later

      console.log(`Scanning for user ${setting.user_id}: ${trade} in ${location}`);
      const leads = await searchAndAnalyse(trade, location);
      console.log(`Found ${leads.length} genuine leads`);

      if (leads.length > 0) {
        await saveLeadsToSupabase(leads, setting.user_id, trade, location);
      }

      // Small delay between users to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, usersScanned: settings.length })
    };

  } catch (err) {
    console.error('Scheduled scan error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
