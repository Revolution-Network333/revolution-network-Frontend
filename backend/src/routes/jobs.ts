// src/routes/jobs.ts
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticateApiKey } from '../middleware/auth';
import { assertQueueCapacity } from '../queues/backpressure';
import { CreditService } from '../credits/CreditService';
import { db } from '../db/client';
import { getQueue, getRetryOptions } from '../queues/queueConfig';
import { emitEvent } from '../events/eventBus';
import { UnknownJobTypeError, JobNotFoundError, InsufficientCreditsError } from '../domain/errors';

/**
 * Vérifie si l'utilisateur a un abonnement actif (Mode Premium).
 */
async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    const sub = await db('subscriptions')
      .where({ user_id: userId })
      .whereIn('status', ['active', 'cancelled'])
      .orderBy('created_at', 'desc')
      .first();

    if (!sub) return false;
    if (sub.status === 'active') return true;
    if (sub.current_period_end) {
      return new Date(sub.current_period_end) > new Date();
    }
    return false;
  } catch {
    return false;
  }
}

// 1. Définition des champs interdits dans toute réponse API publique (Règle 4)
const FORBIDDEN_FIELDS = [
  'node_id', 'node_type', 'gb_used', 'gb_cost_internal', 
  'cpu_seconds', 'cpu_cost_internal', 'exec_time_ms', 
  'proof_hash', 'wallet_balance', 'node_payout', 
  'platform_cut', 'reputation_score', 'api_key_hash', 
  'api_key_prefix', 'retry_count', 'endpoint_url'
];

/**
 * Filtre un objet pour supprimer les champs interdits avant envoi au client.
 */
function filterPublicFields(data: any) {
  if (!data) return data;
  const filtered = { ...data };
  FORBIDDEN_FIELDS.forEach(field => delete filtered[field]);
  return filtered;
}

const CreateJobSchema = z.object({
  type: z.string(),
  input_payload: z.record(z.unknown()),
  input_size_mb: z.number().optional(), // Optionnel, pour validation
});

export async function jobRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  
  // Règle : Toutes les routes sont préfixées /v1/ (configuré dans server.ts)

  // 1. POST /v1/job -> soumettre un job (202 Accepted)
  fastify.post('/job', { preHandler: [authenticateApiKey] }, async (request, reply) => {
    const { type, input_payload, input_size_mb } = CreateJobSchema.parse(request.body);
    const userId = request.user.id;

    // A. Récupérer la config (Single Source of Truth)
    const [config] = await db('job_types').where({ type, is_active: 1 }).limit(1);
    if (!config) throw new UnknownJobTypeError(type);

    // B. Vérifier les limites du mode Free tier
    const isPremium = await hasActiveSubscription(userId);
    if (!isPremium) {
      // 1. Interdire la vidéo
      if (type === 'video_transcode') {
        return reply.code(403).send({ 
          error: 'Forbidden', 
          message: 'Le transcodage vidéo est réservé aux membres Premium (mode Free tier limité).' 
        });
      }

      // 2. Max 0.5 GB par job (512 MB)
      const maxFreeSize = 512;
      const sizeToValidate = input_size_mb || config.max_input_size_mb;
      if (sizeToValidate > maxFreeSize) {
        return reply.code(403).send({ 
          error: 'Forbidden', 
          message: `La taille maximale par job en mode Free tier est de 0.5 GB (${maxFreeSize} MB). Votre job: ${sizeToValidate} MB.` 
        });
      }
    }

    // C. Vérifier la capacité (Backpressure)
    await assertQueueCapacity(config.node_type);

    const jobId = crypto.randomUUID();

    // D. Déduction atomique (Transactionnelle + FOR UPDATE)
    const { credits_charged } = await CreditService.deductForJob(userId, type, jobId);

    // D. Création et dispatch (Transactionnelle)
    await db.transaction(async (trx) => {
      await trx('jobs').insert({
        id: jobId,
        user_id: userId,
        type,
        status: 'pending',
        credits_charged,
        input_payload: JSON.stringify(input_payload),
        created_at: trx.fn.now(6),
        updated_at: trx.fn.now(6),
      });

      const queue = getQueue(config.node_type);
      await queue.add(type, 
        { job_id: jobId, type, payload: input_payload },
        { jobId, ...getRetryOptions(type) }
      );

      await emitEvent(trx, {
        event_type: 'job.created',
        aggregate_id: jobId,
        payload: { job_id: jobId, user_id: userId, type, credits_charged },
      });
    });

    return reply.code(202).send({ 
      job_id: jobId, 
      status: 'pending',
      type: type,
      credits_used: credits_charged,
      created_at: new Date().toISOString()
    });
  });

  // 2. Lister les jobs de l'utilisateur (200 OK)
  fastify.get('/jobs', { preHandler: [authenticateApiKey] }, async (request, reply) => {
    const userId = request.user.id;

    const jobs = await db('jobs')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .select('id', 'type', 'status', 'credits_charged', 'created_at', 'completed_at', 'output_payload');

    return jobs.map(job => ({
      job_id: job.id,
      type: job.type,
      status: job.status,
      credits_used: parseFloat(job.credits_charged),
      created_at: job.created_at,
      completed_at: job.completed_at,
      has_result: !!job.output_payload
    }));
  });

  // 3. Récupération du statut d'un job spécifique (200 OK)
  fastify.get('/job/:id', { preHandler: [authenticateApiKey] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.id;

    const job = await db('jobs')
      .where({ id, user_id: userId })
      .first();

    if (!job) throw new JobNotFoundError(id);

    // Règle 4 : Filtrage strict des champs techniques/internes
    return {
      job_id: job.id,
      status: job.status,
      type: job.type,
      output: job.output_payload ? JSON.parse(job.output_payload) : undefined,
      credits_used: parseFloat(job.credits_charged),
      created_at: job.created_at,
      completed_at: job.completed_at,
      error_message: job.error_message || undefined
    };
  });
}
