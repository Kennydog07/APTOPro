/**
 * APTO Pro — Netlify Serverless Function
 * POST /api/analyse-lead
 *
 * Proxies requests to the Anthropic API, keeping the API key
 * server-side and never exposed to the browser.
 */

// ── AUTH ─────────────────────────────────────────────────────────────────────
// This endpoint spends money on every call (paid third-party APIs), so it only
// serves signed-in users. The browser sends the Supabase session JWT as
// "Authorization: Bearer <token>"; we verify it with Supabase exactly like
// get-unread-leads.js does. No/invalid token -> 401.
async function getAuthedUser(event) {
  const raw   = (event.headers && (event.headers['authorization'] || event.headers['Authorization'])) || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return { status: 401, error: 'Sign in required' };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return { status: 500, error: 'Auth is not configured on the server' };
  }
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_ANON_KEY }
    });
    if (!res.ok) return { status: 401, error: 'Invalid or expired session' };
    const user = await res.json();
    if (!user || !user.id) return { status: 401, error: 'Invalid or expired session' };
    return { user };
  } catch (err) {
    console.error('Auth check failed:', err.message);
    return { status: 503, error: 'Sign-in service unavailable — please try again later' };
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await getAuthedUser(event);
  if (auth.error) {
    return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };
  }

  try {
    const { leadText, trade, location } = JSON.parse(event.body || '{}');

    // Cap input size so a single request can't run up a large AI bill.
    if (typeof leadText === 'string' && leadText.length > 5000) {
      return { statusCode: 413, headers, body: JSON.stringify({ error: 'Lead text is too long (max 5,000 characters)' }) };
    }

    if (!leadText || !trade) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: 'leadText and trade are required' })
      };
    }

    const prompt = `You are the APTO Pro AI Lead Analysis Engine. Analyse the following social media post or community message and determine if it represents a genuine lead for a local UK tradesperson.

LEAD TEXT:
"${leadText}"

SUBSCRIBER TRADE: ${trade}
SUBSCRIBER COVERAGE AREA: ${location || 'the local area'}

Respond ONLY with valid JSON — no markdown, no backticks:
{
  "isLead": true,
  "score": 87,
  "trade": "${trade}",
  "detectedLocation": "Brighton",
  "urgency": "High",
  "urgencyLabel": "Needs someone this week",
  "intentScore": 85,
  "intentLabel": "Ready to hire",
  "estimatedValue": "£150-300",
  "timeline": "This week",
  "headline": "Short 6-word headline",
  "insight": "2-3 sentence analysis of why this is a good lead",
  "reply": "Natural friendly professional reply under 60 words tailored to this specific request",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "confidence": 94
}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const raw = data.content.map(b => b.text || '').join('');
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
