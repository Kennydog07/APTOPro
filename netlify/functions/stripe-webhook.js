/**
 * APTO Pro — Stripe Webhook Handler
 * POST /api/stripe-webhook
 *
 * Listens for Stripe events and updates Supabase accordingly.
 * Events handled:
 *   checkout.session.completed  — new subscriber
 *   customer.subscription.updated — plan change
 *   customer.subscription.deleted — cancellation
 *   invoice.payment_failed        — payment failure
 */

const crypto = require('crypto');

// Verify the request genuinely came from Stripe
function verifyStripeSignature(payload, signature, secret) {
  const parts      = signature.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});

  const timestamp  = parts['t'];
  const sigHash    = parts['v1'];
  const signed     = `${timestamp}.${payload}`;
  const expected   = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const tolerance  = 300; // 5 minutes

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) {
    throw new Error('Webhook timestamp too old');
  }
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHash))) {
    throw new Error('Webhook signature mismatch');
  }
}

// Map Stripe price IDs to plan names
// Update these with your actual Stripe price IDs from the dashboard
const PRICE_TO_PLAN = {
  'price_starter':      'starter',      // £9.99/mo
  'price_professional': 'professional', // £14.99/mo
  'price_ultimate':     'ultimate',     // £19.99/mo
};

function getPlanFromItems(items) {
  if (!items?.data?.length) return 'starter';
  const priceId = items.data[0]?.price?.id || '';
  return PRICE_TO_PLAN[priceId] || 'starter';
}

async function upsertSubscription(data) {
  const { customerId, customerEmail, subscriptionId, plan, status, currentPeriodEnd } = data;

  const row = {
    stripe_customer_id:    customerId,
    stripe_subscription_id: subscriptionId,
    email:                 customerEmail,
    plan,
    status, // active, canceled, past_due, trialing
    current_period_end:    currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    updated_at:            new Date().toISOString(),
  };

  console.log('Upserting subscription:', JSON.stringify(row));

  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscriptions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row)
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('Supabase upsert error:', err);
    throw new Error(`Supabase error: ${err}`);
  }

  console.log('Subscription upserted successfully');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const signature = event.headers['stripe-signature'];
  const secret    = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

  // Verify signature
  try {
    verifyStripeSignature(event.body, signature, secret);
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook signature failed: ${err.message}` };
  }

  const stripeEvent = JSON.parse(event.body);
  console.log('Stripe event received:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        if (session.mode !== 'subscription') break;
        await upsertSubscription({
          customerId:       session.customer,
          customerEmail:    session.customer_email || session.customer_details?.email,
          subscriptionId:   session.subscription,
          plan:             'starter', // will be updated by subscription event
          status:           'active',
          currentPeriodEnd: null,
        });
        console.log('New subscriber:', session.customer_email);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        await upsertSubscription({
          customerId:       sub.customer,
          customerEmail:    sub.customer_email || '',
          subscriptionId:   sub.id,
          plan:             getPlanFromItems(sub.items),
          status:           sub.status,
          currentPeriodEnd: sub.current_period_end,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        await upsertSubscription({
          customerId:       sub.customer,
          customerEmail:    '',
          subscriptionId:   sub.id,
          plan:             'free',
          status:           'canceled',
          currentPeriodEnd: sub.current_period_end,
        });
        console.log('Subscription canceled:', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        await upsertSubscription({
          customerId:       invoice.customer,
          customerEmail:    invoice.customer_email || '',
          subscriptionId:   invoice.subscription,
          plan:             'starter',
          status:           'past_due',
          currentPeriodEnd: null,
        });
        console.log('Payment failed for:', invoice.customer_email);
        break;
      }

      default:
        console.log('Unhandled event type:', stripeEvent.type);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
