// src/workers/timeoutWatcher.ts 
import { db } from '../db/client'; 
import { redis } from '../redis/client'; 
 
/**
 * Surveille les jobs expirés et déclenche un remboursement automatique.
 */
export function startTimeoutWatcher(): void { 
  setInterval(async () => { 
    // 1. Timeout par job_type depuis la DB (Single Source of Truth) 
    const jobTypes = await db('job_types').select('type', 'timeout_seconds'); 
 
    for (const jt of jobTypes) { 
      // Calcul du seuil d'expiration (UTC)
      const cutoff = new Date(Date.now() - jt.timeout_seconds * 1_000) 
        .toISOString() 
        .slice(0, 23) 
        .replace('T', ' '); 
 
      // 2. Trouver les jobs bloqués en 'processing' au-delà du timeout
      const expiredJobs = await db('jobs') 
        .where({ status: 'processing', type: jt.type }) 
        .where('started_at', '<', cutoff) 
        .select('id', 'node_id'); 
 
      for (const job of expiredJobs) { 
        // 3. Notification d'échec par timeout via Redis
        await redis.publish('events:job.failed', JSON.stringify({ 
          event_type:   'job.failed', 
          aggregate_id: job.id, 
          payload: { 
            job_id:  job.id, 
            node_id: job.node_id, 
            reason:  `Timeout dépassé (${jt.timeout_seconds}s)`, 
          }, 
        })); 
      } 
    } 
  }, 10_000); // Surveillance toutes les 10 secondes
}
