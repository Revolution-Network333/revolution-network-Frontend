// src/queues/queueConfig.ts 
import { Queue } from 'bullmq'; 
import { redis } from '../redis/client'; 
 
/**
 * Politiques de retry spécifiques par type de job.
 */
const RETRY_POLICIES: Record<string, { attempts: number; backoff: { type: string; delay: number } }> = { 
  video_transcode: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } }, 
  audio_convert:   { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } }, 
  code_run_js:     { attempts: 2, backoff: { type: 'fixed',       delay: 1_000 } }, 
  svg_generate:    { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } }, 
  text_generate:   { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } }, 
}; 
 
// Dead Letter Queue pour analyse post-mortem des échecs critiques
export const dlq = new Queue('jobs:dlq', { connection: redis }); 
 
const queues: Record<string, Queue> = {};

/**
 * Récupère ou crée une queue BullMQ pour un type de node spécifique.
 */
export function getQueue(nodeType: string): Queue { 
  if (!queues[nodeType]) {
    queues[nodeType] = new Queue(`jobs:${nodeType}`, { 
      connection: redis, 
      defaultJobOptions: { 
        removeOnComplete: { count: 1000 }, 
        removeOnFail:     false, // Garder en DLQ pour audit
      }, 
    }); 
  }
  return queues[nodeType];
} 

/**
 * Récupère les options de retry pour un type de job.
 */
export function getRetryOptions(jobType: string) {
  return RETRY_POLICIES[jobType] || { attempts: 1, backoff: { type: 'fixed', delay: 1000 } };
}

/**
 * Gère l'épuisement des retries : envoi en DLQ et notification d'échec.
 */
export async function handleExhaustedJob( 
  jobId: string, 
  jobType: string, 
  lastError: Error 
): Promise<void> { 
  await dlq.add('failed-job', { 
    job_id:    jobId, 
    job_type:  jobType, 
    error:     lastError.message, 
    failed_at: new Date().toISOString(), 
  }); 
 
  // Notification asynchrone via Redis (sera consommée par RefundService)
  await redis.publish('events:job.failed', JSON.stringify({ 
    event_type:   'job.failed', 
    aggregate_id: jobId, 
    payload: { 
      job_id: jobId, 
      reason: `Épuisement des retries : ${lastError.message}`, 
    }, 
  })); 
} 
