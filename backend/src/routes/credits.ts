// src/routes/credits.ts
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateApiKey } from '../middleware/auth';
import { db } from '../db/client';
import argon2 from 'argon2';
import crypto from 'crypto';

export async function creditRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  
  // 1. GET /v1/me/credits -> solde de crédits (200 OK)
  fastify.get('/me/credits', { preHandler: [authenticateApiKey] }, async (request, reply) => {
    const userId = request.user.id;

    const user = await db('users')
      .where({ id: userId })
      .select('credits_balance')
      .first();

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      balance: parseFloat(user.credits_balance),
      currency: 'EUR'
    };
  });

  // 2. GET /v1/me -> info utilisateur (200 OK)
  fastify.get('/me', { preHandler: [authenticateApiKey] }, async (request, reply) => {
    const userId = request.user.id;

    const user = await db('users')
      .where({ id: userId })
      .select('id', 'email', 'api_key_prefix', 'credits_balance', 'free_gb_remaining')
      .first();

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      email: user.email,
      api_key_masked: `${user.api_key_prefix}••••-••••-••••`,
      balance: parseFloat(user.credits_balance),
      free_balance_gb: parseFloat(user.free_gb_remaining)
    };
  });

  // 3. POST /v1/me/api-key/regenerate -> régénérer la clé API (200 OK)
  fastify.post('/me/api-key/regenerate', { preHandler: [authenticateApiKey] }, async (request, reply) => {
    const userId = request.user.id;

    const rawKey = `rev_${crypto.randomBytes(32).toString('hex')}`;
    const prefix = rawKey.substring(0, 12);
    const hash = await argon2.hash(rawKey, { type: argon2.argon2id });

    await db('users')
      .where({ id: userId })
      .update({
        api_key_hash: hash,
        api_key_prefix: prefix,
        updated_at: db.fn.now(6)
      });

    // Retourner la clé brute UNE SEULE FOIS
    return {
      api_key: rawKey,
      prefix: prefix
    };
  });
}
