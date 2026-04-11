// src/credits/CreditService.ts 
import crypto from 'crypto'; 
import { db } from '../db/client'; 
import { emitEvent } from '../events/eventBus'; 
import { 
  UnauthorizedError, 
  UnknownJobTypeError, 
  InsufficientCreditsError, 
} from '../domain/errors'; 
 
export type QuotaCategory = 'text' | 'code' | 'media';

export class CreditService { 
 
  /**
   * Déduit les crédits pour un job. 
   * Priorité : Quota gratuit (3 GB/semaine) -> Crédits payants.
   * Lock exclusif MySQL pour éviter tout double-spending.
   */
  static async deductForJob( 
    userId: string, 
    jobType: string, 
    jobId: string 
  ): Promise<{ credits_charged: number; is_free: boolean }> { 
 
    return db.transaction(async (trx) => { 
      // 1. Lock exclusif utilisateur avec ses crédits
      const [[user]] = await trx.raw( 
        `SELECT u.id, ec.credits_balance, u.free_gb_remaining, u.free_credits_last_reset, u.is_active 
         FROM users u
         LEFT JOIN enterprise_credits ec ON ec.user_id = u.id
         WHERE u.id = ? FOR UPDATE`, 
        [userId] 
      ); 
 
      if (!user || !user.is_active) throw new UnauthorizedError(); 

      // S'assurer que enterprise_credits existe
      if (user.credits_balance === null) {
        await trx('enterprise_credits').insert({
          user_id: userId,
          credits_balance: 0,
          credits_used_month: 0
        });
        user.credits_balance = 0;
      }

      // 2. Reset hebdomadaire du quota gratuit (si nécessaire)
      const lastReset = new Date(user.free_credits_last_reset);
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      let freeGB = parseFloat(user.free_gb_remaining);

      if (lastReset < oneWeekAgo) {
        const config = await trx('system_config')
          .where('key', 'free_quota_gb_weekly')
          .first();
        
        freeGB = parseFloat(config?.value || '3');
        
        await trx('users').where({ id: userId }).update({
          free_gb_remaining: freeGB,
          free_credits_last_reset: trx.fn.now(6)
        });
      }
 
      // 3. Récupérer le coût du job
      const [jobTypeConfig] = await trx('job_types') 
        .where({ type: jobType, is_active: 1 }) 
        .limit(1); 
 
      if (!jobTypeConfig) throw new UnknownJobTypeError(jobType); 
 
      const cost = parseFloat(jobTypeConfig.credits_cost); 
      const gbCost = parseFloat(jobTypeConfig.gb_cost_internal);
      let isFree = false;

      // 4. Stratégie de déduction
      if (freeGB >= gbCost) {
        // Utilisation du quota gratuit (GB)
        await trx('users').where({ id: userId }).decrement('free_gb_remaining', gbCost);
        isFree = true;
      } else if (parseFloat(user.credits_balance) >= cost) {
        // Utilisation des crédits payants
        await trx('enterprise_credits').where({ user_id: userId }).decrement('credits_balance', cost);
        isFree = false;
      } else {
        throw new InsufficientCreditsError(parseFloat(user.credits_balance), cost); 
      }
 
      // 5. Refetch pour le ledger
      const [[updated]] = await trx.raw( 
        `SELECT u.free_gb_remaining, ec.credits_balance 
         FROM users u
         LEFT JOIN enterprise_credits ec ON ec.user_id = u.id
         WHERE u.id = ?`, 
        [userId] 
      ); 
 
      // 6. Audit Trail
      await trx('credit_events').insert({ 
        id:            crypto.randomUUID(), 
        user_id:       userId, 
        event_type:    'deduction', 
        amount:        isFree ? 0 : -cost, 
        balance_after: parseFloat(updated.credits_balance), 
        job_id:        jobId, 
        description:   `Déduction pour job ${jobType} (${isFree ? 'Quota Gratuit GB' : 'Payant'})`, 
      }); 
 
      // 7. Événement
      await emitEvent(trx, { 
        event_type:   'credit.deducted', 
        aggregate_id: userId, 
        payload:      { user_id: userId, amount: isFree ? 0 : cost, job_id: jobId, is_free: isFree, gb_cost: isFree ? gbCost : 0 }, 
      }); 
 
      return { credits_charged: isFree ? 0 : cost, is_free: isFree }; 
    }); 
  } 

  static async topUp(userId: string, amountEur: number, stripePaymentId: string): Promise<void> {
    return db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).increment('credits_balance', amountEur);
      const [[updated]] = await trx.raw('SELECT credits_balance FROM users WHERE id = ?', [userId]);
      await trx('credit_events').insert({
        id: crypto.randomUUID(),
        user_id: userId,
        event_type: 'topup',
        amount: amountEur,
        balance_after: parseFloat(updated.credits_balance),
        stripe_payment_id: stripePaymentId,
        description: `Recharge Stripe ${amountEur}€`,
      });
      await emitEvent(trx, {
        event_type: 'credit.topped_up',
        aggregate_id: userId,
        payload: { user_id: userId, amount: amountEur, stripe_payment_id: stripePaymentId },
      });
    });
  }
}
