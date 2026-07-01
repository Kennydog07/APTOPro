/**
 * APTO Pro — Get Unread Leads
 * GET /api/get-unread-leads
 * Returns unread leads for the authenticated user
 */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const token = (event.headers['authorization'] || '').replace('Bearer ', '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };

    // Verify user with Supabase
    const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_ANON_KEY }
    });

    if (!userRes.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
    const user = await userRes.json();

    // Fetch unread leads for this user
    const leadsRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/leads?user_id=eq.${user.id}&is_read=eq.false&order=found_at.desc&limit=20`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );

    const leads = await leadsRes.json();

    return { statusCode: 200, headers, body: JSON.stringify({ leads: leads || [], count: leads?.length || 0 }) };

  } catch (err) {
    console.error('get-unread-leads error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
