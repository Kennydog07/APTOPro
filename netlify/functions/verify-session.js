/**
 * APTO Pro — Verify Supabase Session + Subscription Status
 * POST /api/verify-session
 * Called on dashboard load to check auth + active subscription.
 *
 * Response (200):
 *   { user: { id, email, name },
 *     subscription: { plan, status, current_period_end, trial, trial_ends_at } | null,
 *     hasAccess: boolean }
 * No / invalid token -> 401.
 *
 * Schema note: the `subscriptions` table has NO user_id and NO trial_ends_at
 * columns. It is keyed by Stripe ids and the customer's email, exactly as
 * stripe-webhook.js writes it: email, plan, status, stripe_customer_id,
 * stripe_subscription_id, current_period_end, updated_at. So we look the row up
 * by the verified user's email. A trial is Stripe status 'trialing'; while
 * trialing, Stripe's current_period_end is the trial end, so trial_ends_at in
 * the response is derived from it (it is not a DB column).
 */

const ACTIVE_STATUSES = ['active', 'trialing'];
// Allow a short grace period after current_period_end in case a renewal
// webhook is late, so paying users are not locked out by a delayed event.
const PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

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

// Escape LIKE wildcards so an email containing "_" or "%" matches literally.
function likeLiteral(s) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function isActive(sub, now = Date.now()) {
  if (!sub || !ACTIVE_STATUSES.includes(sub.status)) return false;
  if (!sub.current_period_end) return true; // checkout.session.completed stores null until the subscription event arrives
  const end = Date.parse(sub.current_period_end);
  return Number.isNaN(end) ? true : end + PERIOD_GRACE_MS > now;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await getAuthedUser(event);
  if (auth.error) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };
  const user = auth.user;

  try {
    const email = (user.email || '').trim().toLowerCase();
    let rows = [];

    if (email) {
      if (!process.env.SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server is not configured' }) };
      }
      // Case-insensitive match: the webhook stores whatever email Stripe sends,
      // which may differ in case from the Supabase auth email.
      const qs = new URLSearchParams({
        select: 'plan,status,current_period_end,updated_at,email',
        email:  `ilike.${likeLiteral(email)}`,
        order:  'updated_at.desc.nullslast',
        limit:  '10',
      });
      const subRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscriptions?${qs}`, {
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      });
      if (!subRes.ok) {
        console.error('verify-session subscription lookup failed:', subRes.status, await subRes.text());
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not check subscription' }) };
      }
      const data = await subRes.json();
      rows = Array.isArray(data)
        ? data.filter((r) => (r.email || '').trim().toLowerCase() === email)
        : [];
    }

    // Prefer a currently-active row; otherwise the most recently updated one.
    const now = Date.now();
    const sub = rows.find((r) => isActive(r, now)) || rows[0] || null;
    const hasAccess = isActive(sub, now);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        user: { id: user.id, email: user.email, name: user.user_metadata?.full_name },
        subscription: sub ? {
          plan:               sub.plan,
          status:             sub.status,
          current_period_end: sub.current_period_end,
          trial:              sub.status === 'trialing',
          trial_ends_at:      sub.status === 'trialing' ? sub.current_period_end : null,
        } : null,
        hasAccess
      })
    };

  } catch (err) {
    console.error('verify-session error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};

exports._test = { isActive, likeLiteral };
