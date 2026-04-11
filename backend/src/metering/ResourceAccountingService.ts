// src/metering/ResourceAccountingService.ts 
import crypto from 'crypto'; 
import { Knex } from 'knex'; 
import { MeteringError } from '../domain/errors'; 
 
interface WorkerReport { 
  job_id:         string; 
  node_id:        string; 
  proof_hash:     string; 
  raw_bytes_in:   number; 
  raw_bytes_out:  number; 
  cpu_ms:         number; 
  exec_time_ms:   number; 
} 
 
interface AccountingRecord { 
  gb_used:      number; 
  cpu_seconds:  number; 
  exec_time_ms: number; 
} 
 
export class ResourceAccountingService { 
  private static readonly BYTES_PER_GB = 1_073_741_824; 
 
  static compute(report: WorkerReport): AccountingRecord { 
    const totalBytes  = report.raw_bytes_in + report.raw_bytes_out; 
    const gb_used     = totalBytes / this.BYTES_PER_GB; 
    const cpu_seconds = report.cpu_ms / 1_000; 
 
    if (gb_used < 0)           throw new MeteringError('gb_used ne peut pas être négatif'); 
    if (cpu_seconds < 0)       throw new MeteringError('cpu_seconds ne peut pas être négatif'); 
    if (report.exec_time_ms <= 0) throw new MeteringError('exec_time_ms invalide'); 
 
    return { gb_used, cpu_seconds, exec_time_ms: report.exec_time_ms }; 
  } 
 
  /** 
   * Enregistre l'exécution technique. 
   * SEUL point d'écriture dans la table 'executions'.
   */ 
  static async record( 
    trx: Knex.Transaction, 
    report: WorkerReport, 
    payout: { node_payout: number; platform_cut: number } 
  ): Promise<void> { 
    const accounting = this.compute(report); 
 
    await trx('executions').insert({ 
      id:           crypto.randomUUID(), 
      job_id:       report.job_id, 
      node_id:      report.node_id, 
      proof_hash:   report.proof_hash, 
      gb_used:      accounting.gb_used, 
      cpu_seconds:  accounting.cpu_seconds, 
      exec_time_ms: accounting.exec_time_ms, 
      node_payout:  payout.node_payout, 
      platform_cut: payout.platform_cut, 
      settled_at:   trx.fn.now(6),
    }); 
  } 
} 
