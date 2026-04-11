// src/settlement/RefundService.ts 
import crypto from 'crypto'; 
import { db } from '../db/client'; 
import { transitionJob } from '../domain/jobStateMachine'; 
import { emitEvent } from '../events/eventBus'; 
 
export class RefundService { 
 
  /** 
   * Seul point d'entrée pour les remboursements. 
   * Appelé uniquement par le subscriber de 'job.failed'. 
   * Idempotent : si le job n'est plus en 'processing', ne fait rien.
   * Rembourse dans le bon réservoir (Gratuit Spécifique ou Payant).
   */ 
  static async processRefund(jobId: string, reason: string): Promise<void> { 
    await db.transaction(async (trx) => { 
      // Lock exclusif du job
      const [[job]] = await trx.raw( 
        'SELECT id, user_id, type, status, credits_charged FROM jobs WHERE id = ? FOR UPDATE', 
        [jobId] 
      ); 
 
      if (!job || (job.status !== 'processing' && job.status !== 'pending')) return; 
 
      const cost = parseFloat(job.credits_charged);

      // Récupérer le dernier événement de déduction pour savoir si c'était gratuit
      const lastEvent = await trx('credit_events')
        .where({ job_id: jobId, event_type: 'deduction' })
        .first();
      
      const isFree = lastEvent?.description.includes('Quota Gratuit');

      // 1. Rembourser dans le bon réservoir
      if (isFree) {
        let col = 'free_media_jobs_remaining';
        if (job.type === 'text_generate') col = 'free_text_jobs_remaining';
        if (job.type === 'code_run_js') col = 'free_code_runs_remaining';
        
        await trx('users').where({ id: job.user_id }).increment(col, 1);
      } else {
        await trx('users').where({ id: job.user_id }).increment('credits_balance', cost); 
      }
 
      // 2. Refetch du solde global
      const [[updated]] = await trx.raw( 
        'SELECT credits_balance, free_text_jobs_remaining, free_code_runs_remaining, free_media_jobs_remaining FROM users WHERE id = ?', 
        [job.user_id] 
      ); 
 
      // 3. Logger dans le ledger immuable 
      await trx('credit_events').insert({ 
        id:            crypto.randomUUID(), 
        user_id:       job.user_id, 
        event_type:    'refund', 
        amount:        isFree ? 0 : cost, 
        balance_after: parseFloat(updated.credits_balance), 
        job_id:        jobId, 
        description:   `Remboursement automatique (${isFree ? 'Quota Gratuit' : 'Payant'}) : ${reason}`, 
      }); 
 
      // 4. Transition d'état 
      await transitionJob(trx, jobId, 'failed', { 
        error_message: reason, 
        completed_at:  trx.fn.now(6), 
      }); 
 
      // 5. Événement 
      await emitEvent(trx, { 
        event_type:   'credit.refunded', 
        aggregate_id: job.user_id, 
        payload: { 
          user_id: job.user_id, 
          amount:  isFree ? 0 : cost, 
          job_id:  jobId, 
          is_free: isFree,
          reason, 
        }, 
      }); 
    }); 
  } 
} 
