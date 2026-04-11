// src/workers/ffmpegWorker.ts
import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { redis } from '../redis/client';
import { db } from '../db/client';
import { transitionJob } from '../domain/jobStateMachine';
import { handleExhaustedJob } from '../queues/queueConfig';

/**
 * Worker ffmpeg : traite les jobs 'video_transcode' et 'audio_convert'.
 */
export function startFfmpegWorker(): void {
  const worker = new Worker('jobs:ffmpeg', async (job: Job) => {
    const { job_id, type, payload } = job.data;
    const startTime = Date.now();

    try {
      // 1. Transition vers PROCESSING
      await db.transaction(async (trx) => {
        await transitionJob(trx, job_id, 'processing', {
          started_at: trx.fn.now(6),
          node_id: process.env.NODE_ID || 'local-platform-worker'
        });
      });

      // 2. Simulation du traitement FFmpeg (Logique réelle à implémenter selon le stockage)
      // Note: Ici nous simulons l'exécution pour le layer DePIN
      const resultPayload = await simulateFfmpegWork(type, payload);
      
      const execTimeMs = Date.now() - startTime;
      const resultHash = crypto.createHash('sha256').update(JSON.stringify(resultPayload)).digest('hex');
      const timestamp = Date.now();
      const nodeId = process.env.NODE_ID || 'local-platform-worker';

      // 3. Génération de la preuve cryptographique (Proof of Service)
      const proofHash = crypto
        .createHash('sha256')
        .update(`${job_id}:${resultHash}:${nodeId}:${timestamp}`)
        .digest('hex');

      // 4. Émission de l'événement de preuve pour le SettlementEngine
      await redis.publish('events:proof.received', JSON.stringify({
        event_type: 'proof.received',
        aggregate_id: job_id,
        payload: {
          job_id,
          node_id: nodeId,
          proof_hash: proofHash,
          result_hash: resultHash,
          timestamp,
          raw_bytes_in: 1024 * 1024 * 5, // Simulé : 5MB in
          raw_bytes_out: 1024 * 1024 * 2, // Simulé : 2MB out
          cpu_ms: execTimeMs * 0.8, // Simulé : 80% d'usage CPU
          exec_time_ms: execTimeMs,
          output_payload: resultPayload
        }
      }));

    } catch (err) {
      console.error(`[FfmpegWorker] Job ${job_id} failed:`, err);
      throw err; // Permet à BullMQ de gérer le retry
    }
  }, { 
    connection: redis,
    concurrency: 2 // Traitement parallèle limité
  });

  // Gestion des échecs définitifs (épuisement des retries)
  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await handleExhaustedJob(job.data.job_id, job.data.type, err);
    }
  });
}

/**
 * Simule le travail de FFmpeg et retourne un résultat.
 */
async function simulateFfmpegWork(type: string, payload: any): Promise<any> {
  // Simule un délai de traitement variable
  const delay = type === 'video_transcode' ? 5000 : 1000;
  await new Promise(resolve => setTimeout(resolve, delay));

  return {
    status: 'success',
    output_url: `https://storage.revolution.network/outputs/${crypto.randomBytes(8).toString('hex')}.mp4`,
    metadata: {
      duration: 120,
      codec: 'h264',
      resolution: '1080p'
    }
  };
}
