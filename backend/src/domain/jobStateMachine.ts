// src/domain/jobStateMachine.ts 
import { Knex } from 'knex'; 
import { emitEvent } from '../events/eventBus'; 
import { JobNotFoundError, IllegalStateTransitionError } from './errors'; 
 
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'; 
 
const LEGAL_TRANSITIONS: Record<JobStatus, JobStatus[]> = { 
  pending:    ['processing', 'failed'], 
  processing: ['completed', 'failed'], 
  completed:  [], 
  failed:     [], 
}; 
 
export function assertLegalTransition(from: JobStatus, to: JobStatus): void { 
  if (!LEGAL_TRANSITIONS[from].includes(to)) { 
    throw new IllegalStateTransitionError( 
      `Transition interdite : ${from} → ${to}` 
    ); 
  } 
} 
 
/**
 * Seul point d'entrée pour modifier le statut d'un job.
 * Utilise SELECT ... FOR UPDATE pour garantir l'atomicité sur MySQL.
 */
export async function transitionJob( 
  trx: Knex.Transaction, 
  jobId: string, 
  to: JobStatus, 
  meta: Record<string, unknown> = {} 
): Promise<void> { 
  // MySQL : Lock exclusif pour éviter les race conditions sur le changement d'état
  const [[job]] = await trx.raw( 
    'SELECT id, status FROM jobs WHERE id = ? FOR UPDATE', 
    [jobId] 
  ); 
 
  if (!job) throw new JobNotFoundError(jobId); 
 
  assertLegalTransition(job.status as JobStatus, to); 
 
  await trx('jobs').where({ id: jobId }).update({ 
    status:     to, 
    ...meta, 
    updated_at: trx.fn.now(6), 
  }); 
 
  // Emission de l'événement dans la même transaction (Outbox Pattern)
  await emitEvent(trx, { 
    event_type:   `job.${to}`, 
    aggregate_id: jobId, 
    payload:      { job_id: jobId, status: to, ...meta }, 
  }); 
} 
