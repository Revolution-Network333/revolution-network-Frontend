// src/middleware/auth.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { db } from '../db/client';
import { UnauthorizedError } from '../domain/errors';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
    };
  }
}

/**
 * Middleware d'authentification par clé API ou JWT (pour le dashboard).
 */
export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;
  const authHeader = request.headers['authorization'];

  // 1. Priorité à la Clé API (Client Externe)
  if (apiKey && apiKey.length >= 24) {
    const prefix = apiKey.slice(0, 12);
    const user = await db('users')
      .where({ api_key_prefix: prefix, is_active: 1 })
      .select('id', 'email', 'api_key_hash')
      .first();

    if (user && (await argon2.verify(user.api_key_hash, apiKey))) {
      request.user = { id: user.id, email: user.email };
      return;
    }
  }

  // 2. Fallback au JWT (Dashboard Interne)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    // Note: Dans une implémentation réelle, utilisez jwt.verify(token, secret)
    // Ici, nous simulons la validation pour le dashboard
    try {
      // Pour l'exercice, nous extrayons le userId si le token est valide
      // En prod: const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Pour cet environnement, on va chercher l'utilisateur par session ou token
      const session = await db('sessions').where({ token }).first();
      if (session) {
        const user = await db('users').where({ id: session.user_id, is_active: 1 }).first();
        if (user) {
          request.user = { id: user.id, email: user.email };
          return;
        }
      }
    } catch (e) {}
  }

  throw new UnauthorizedError('Authentification requise (Clé API ou Token)');
}
