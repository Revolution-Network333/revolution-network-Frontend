// src/workers/sandboxWorker.ts
import { Worker, Job } from 'bullmq';
import ivm from 'isolated-vm';
import crypto from 'crypto';
import { redis } from '../redis/client';
import { db } from '../db/client';
import { transitionJob } from '../domain/jobStateMachine';
import { handleExhaustedJob } from '../queues/queueConfig';

/**
 * Worker Sandbox : exécute du code JS isolé via isolated-vm.
 * Règle 2 : Isolation stricte, blocage des globals, timeout et memory limit.
 */
export function startSandboxWorker(): void {
  const worker = new Worker('jobs:sandbox', async (job: Job) => {
    const { job_id, type, payload } = job.data;
    const startTime = Date.now();

    // 1. Initialisation de l'Isolate (Règle 2 : memoryLimit 64MB)
    const isolate = new ivm.Isolate({ 
      memoryLimit: 64,
      onCatastrophicError: () => { try { isolate.dispose(); } catch {} }
    });

    try {
      // 2. Transition vers PROCESSING
      await db.transaction(async (trx) => {
        await transitionJob(trx, job_id, 'processing', {
          started_at: trx.fn.now(6),
          node_id: process.env.NODE_ID || 'sandbox-node-1'
        });
      });

      const context = await isolate.createContext();
      const jail = context.global;

      // 3. Blocage des globals dangereux (Règle 2)
      await jail.set('global', jail.derefInto());
      await jail.set('process', undefined);
      await jail.set('require', undefined);
      await jail.set('fetch', undefined);
      await jail.set('WebSocket', undefined);
      await jail.set('XMLHttpRequest', undefined);

      // 4. Exécution du script (Timeout 30s)
      const script = await isolate.compileScript(payload.code || 'return "no code provided";');
      const result = await script.run(context, { timeout: 30000 });
      
      const execTimeMs = Date.now() - startTime;
      const stats = isolate.getHeapStatisticsSync();
      
      const resultPayload = { 
        status: 'success', 
        result,
        memory_used_mb: stats.used_heap_size / 1048576 
      };
      
      const resultHash = crypto.createHash('sha256').update(JSON.stringify(resultPayload)).digest('hex');
      const nodeId = process.env.NODE_ID || 'sandbox-node-1';
      const timestamp = Date.now();

      // 5. Émission de la preuve pour le règlement
      await redis.publish('events:proof.received', JSON.stringify({
        event_type: 'proof.received',
        aggregate_id: job_id,
        payload: {
          job_id,
          node_id: nodeId,
          proof_hash: crypto.createHash('sha256').update(`${job_id}:${resultHash}:${nodeId}:${timestamp}`).digest('hex'),
          result_hash: resultHash,
          timestamp,
          raw_bytes_in: 1024, 
          raw_bytes_out: 1024,
          cpu_ms: execTimeMs * 0.95,
          exec_time_ms: execTimeMs,
          output_payload: resultPayload
        }
      }));

    } catch (err: any) {
      console.error(`[SandboxWorker] Job ${job_id} failed:`, err);
      throw err;
    } finally {
      // Nettoyage impératif de l'isolate
      try { isolate.dispose(); } catch {}
    }
  }, { connection: redis, concurrency: 5 });

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await handleExhaustedJob(job.data.job_id, job.data.type, err);
    }
  });
}
