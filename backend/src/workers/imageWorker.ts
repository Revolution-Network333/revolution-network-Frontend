// src/workers/imageWorker.ts
import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { redis } from '../redis/client';
import { db } from '../db/client';
import { transitionJob } from '../domain/jobStateMachine';
import { handleExhaustedJob } from '../queues/queueConfig';

/**
 * Worker Image : traite les jobs 'svg_generate'.
 */
export function startImageWorker(): void {
  const worker = new Worker('jobs:image', async (job: Job) => {
    const { job_id, type, payload } = job.data;
    const startTime = Date.now();

    try {
      await db.transaction(async (trx) => {
        await transitionJob(trx, job_id, 'processing', {
          started_at: trx.fn.now(6),
          node_id: process.env.NODE_ID || 'image-node-1'
        });
      });

      // Simulation de génération SVG
      const svg = `<svg width="100" height="100"><circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" /><text x="50" y="50" text-anchor="middle" stroke="#51c5cf" stroke-width="1px" dy=".3em">${payload.text || 'Revolution'}</text></svg>`;
      
      const execTimeMs = Date.now() - startTime;
      const resultPayload = { status: 'success', svg };
      const resultHash = crypto.createHash('sha256').update(JSON.stringify(resultPayload)).digest('hex');
      const nodeId = process.env.NODE_ID || 'image-node-1';
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
          raw_bytes_in: 500, 
          raw_bytes_out: 2048,
          cpu_ms: execTimeMs * 0.5,
          exec_time_ms: execTimeMs,
          output_payload: resultPayload
        }
      }));

    } catch (err) {
      console.error(`[ImageWorker] Job ${job_id} failed:`, err);
      throw err;
    }
  }, { connection: redis, concurrency: 5 });

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await handleExhaustedJob(job.data.job_id, job.data.type, err);
    }
  });
}
