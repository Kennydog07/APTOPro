/**
 * APTO Pro — Netlify Serverless Function
 * POST /api/analyse-lead
 *
 * Proxies requests to the Anthropic API, keeping the API key
 * server-side and never exposed to the browser.
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { leadText, trade, location } = JSON.parse(event.body || '{}');

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
