// src/routes/webhooks.ts
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import Stripe from 'stripe';
import { CreditService } from '../credits/CreditService';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2023-10-16' as any,
});

export async function webhookRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  
  fastify.post('/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
    const sig = request.headers['stripe-signature'] as string;
    const rawBody = (request as any).rawBody;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock'
      );
    } catch (err: any) {
      return reply.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Gestion de la réussite du paiement
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      const userId = session.client_reference_id;
      const amountTotal = session.amount_total; // en centimes d'euro

      if (userId && amountTotal) {
        const amountEur = amountTotal / 100;
        
        // Recharge atomique des crédits
        await CreditService.topUp(userId, amountEur, session.id);
        
        console.log(`[Stripe] Top-up success for user ${userId}: ${amountEur}€`);
      }
    }

    return reply.status(200).send({ received: true });
  });
}
