/**
 * APTO Pro — Verify Supabase Session + Subscription Status
 * POST /api/verify-session
 * Called on dashboard load to check auth + active subscription
 */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const authHeader = event.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };

    // Verify with Supabase
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    });

    if (!res.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

    const user = await res.json();

    // Check subscription in Supabase DB
    const subRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,status,trial_ends_at`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );

    const subs = await subRes.json();
    const activeSub = subs?.[0];

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        user: { id: user.id, email: user.email, name: user.user_metadata?.full_name },
        subscription: activeSub || null,
        hasAccess: activeSub?.status === 'active' || activeSub?.status === 'trialing'
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
