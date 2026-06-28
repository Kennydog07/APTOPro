/**
 * APTO Pro — Stripe Webhook Handler
 * POST /api/stripe-webhook
 * Handles: checkout.session.completed, customer.subscription.deleted
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Handle events — extend as needed
  switch (stripeEvent.type) {
    case 'checkout.session.completed':
      console.log('New subscription:', stripeEvent.data.object.customer_email);
      // TODO: update Supabase user record with subscription status
      break;
    case 'customer.subscription.deleted':
      console.log('Subscription cancelled:', stripeEvent.data.object.customer);
      // TODO: revoke dashboard access in Supabase
      break;
    default:
      console.log(`Unhandled event: ${stripeEvent.type}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
