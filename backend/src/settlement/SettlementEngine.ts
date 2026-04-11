// src/settlement/SettlementEngine.ts 
import crypto from 'crypto'; 
import { db } from '../db/client'; 
import { ResourceAccountingService } from '../metering/ResourceAccountingService'; 
import { transitionJob } from '../domain/jobStateMachine'; 
import { emitEvent } from '../events/eventBus'; 
import { JobNotSettlableError } from '../domain/errors'; 
 
export class SettlementEngine { 
 
  /**
   * Vérifie la validité de la preuve d'exécution.
   */
  static verifyProof( 
    submittedProof: string, 
    jobId: string, 
    resultHash: string, 
    nodeId: string, 
    timestamp: number 
  ): boolean { 
    const expected = crypto 
      .createHash('sha256') 
      .update(`${jobId}:${resultHash}:${nodeId}:${timestamp}`) 
      .digest('hex'); 
 
    // Comparaison à temps constant pour prévenir les attaques temporelles
    try { 
      return crypto.timingSafeEqual( 
        Buffer.from(submittedProof, 'hex'), 
        Buffer.from(expected, 'hex') 
      ); 
    } catch { 
      return false; 
    } 
  } 
 
  /**
   * Réalise le règlement financier du job.
   */
  static async settle(proof: { 
    job_id:        string; 
    node_id:       string; 
    proof_hash:    string; 
    result_hash:   string; 
    timestamp:     number; 
    raw_bytes_in:  number; 
    raw_bytes_out: number; 
    cpu_ms:        number; 
    exec_time_ms:  number; 
    output_payload?: Record<string, unknown>;
  }): Promise<void> { 
 
    await db.transaction(async (trx) => { 
      // 1. Lock exclusif du job
      const [[job]] = await trx.raw( 
        'SELECT id, user_id, status, credits_charged FROM jobs WHERE id = ? FOR UPDATE', 
        [proof.job_id] 
      ); 
 
      if (!job || job.status !== 'processing') { 
        throw new JobNotSettlableError(proof.job_id); 
      } 
 
      // 2. Validation de la preuve
      const isValid = this.verifyProof( 
        proof.proof_hash, 
        proof.job_id, 
        proof.result_hash, 
        proof.node_id, 
        proof.timestamp 
      ); 
 
      if (!isValid) { 
        await emitEvent(trx, { 
          event_type:   'proof.invalid', 
          aggregate_id: proof.job_id, 
          payload: { 
            job_id:  proof.job_id, 
            node_id: proof.node_id, 
            reason:  'proof_mismatch', 
          }, 
        }); 
        return; 
      } 
 
      // 3. Calcul de la répartition (Single Source of Truth)
      const configs = await trx('system_config').whereIn('key', ['settlement_node_share']); 
      const nodeShareStr = configs.find(r => r.key === 'settlement_node_share')?.value || '0.75';
      const nodeShare = parseFloat(nodeShareStr); 
      
      const creditsCharged = parseFloat(job.credits_charged);
      const nodePayout  = creditsCharged * nodeShare; 
      const platformCut = creditsCharged * (1 - nodeShare); 
 
      // 4. Paiement du node operator
      await trx('nodes') 
        .where({ id: proof.node_id }) 
        .increment('wallet_balance', nodePayout) 
        .increment('total_jobs_completed', 1); 
 
      // 5. Enregistrement des métriques techniques
      await ResourceAccountingService.record(trx, {
        job_id: proof.job_id,
        node_id: proof.node_id,
        proof_hash: proof.proof_hash,
        raw_bytes_in: proof.raw_bytes_in,
        raw_bytes_out: proof.raw_bytes_out,
        cpu_ms: proof.cpu_ms,
        exec_time_ms: proof.exec_time_ms
      }, { node_payout: nodePayout, platform_cut: platformCut }); 
 
      // 6. Finalisation du job
      await transitionJob(trx, proof.job_id, 'completed', { 
        completed_at: trx.fn.now(6), 
        output_payload: proof.output_payload ? JSON.stringify(proof.output_payload) : null
      }); 
 
      // 7. Événement de succès
      await emitEvent(trx, { 
        event_type:   'node.paid', 
        aggregate_id: proof.node_id, 
        payload: { 
          node_id: proof.node_id, 
          amount:  nodePayout, 
          job_id:  proof.job_id, 
        }, 
      }); 
    }); 
  } 
 } 
