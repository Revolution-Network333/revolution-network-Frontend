// src/workers/textWorker.ts
import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { redis } from '../redis/client';
import { db } from '../db/client';
import { transitionJob } from '../domain/jobStateMachine';
import { handleExhaustedJob } from '../queues/queueConfig';

/**
 * Worker Text : traite les jobs 'text_generate'.
 */
export function startTextWorker(): void {
  const worker = new Worker('jobs:text', async (job: Job) => {
    const { job_id, type, payload } = job.data;
    const startTime = Date.now();

    try {
      await db.transaction(async (trx) => {
        await transitionJob(trx, job_id, 'processing', {
          started_at: trx.fn.now(6),
          node_id: process.env.NODE_ID || 'text-node-1'
        });
      });

      // Simulation de génération de texte
      const text = `Revolution Network: Job ID ${job_id} successfully processed at ${new Date().toISOString()}`;
      
      const execTimeMs = Date.now() - startTime;
      const resultPayload = { status: 'success', text };
      const resultHash = crypto.createHash('sha256').update(JSON.stringify(resultPayload)).digest('hex');
      const nodeId = process.env.NODE_ID || 'text-node-1';
      const timestamp = Date.now();

      await redis.publish('events:proof.received', JSON.stringify({
        event_type: 'proof.received',
        aggregate_id: job_id,
        payload: {
          job_id,
          node_id: nodeId,
          proof_hash: crypto.createHash('sha256').update(`${job_id}:${resultHash}:${nodeId}:${timestamp}`).digest('hex'),
          result_hash: resultHash,
          timestamp,
          raw_bytes_in: 100, 
          raw_bytes_out: 500,
          cpu_ms: execTimeMs * 0.1,
          exec_time_ms: execTimeMs,
          output_payload: resultPayload
        }
      }));

    } catch (err) {
      console.error(`[TextWorker] Job ${job_id} failed:`, err);
      throw err;
    }
  }, { connection: redis, concurrency: 10 });

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await handleExhaustedJob(job.data.job_id, job.data.type, err);
    }
  });
}
