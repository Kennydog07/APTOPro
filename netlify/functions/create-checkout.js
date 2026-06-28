/**
 * APTO Pro — Create Stripe Checkout Session
 * POST /api/create-checkout
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { planId, email, successUrl, cancelUrl } = JSON.parse(event.body || '{}');

    const priceMap = {
      starter:      process.env.STRIPE_STARTER_PRICE_ID,
      professional: process.env.STRIPE_PRO_PRICE_ID,
      agency:       process.env.STRIPE_AGENCY_PRICE_ID,
    };

    const priceId = priceMap[planId];
    if (!priceId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: successUrl || `${process.env.ALLOWED_ORIGIN}/app.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl  || `${process.env.ALLOWED_ORIGIN}/#pricing`,
      allow_promotion_codes: true,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url, sessionId: session.id }) };

  } catch (err) {
    console.error('Stripe error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
