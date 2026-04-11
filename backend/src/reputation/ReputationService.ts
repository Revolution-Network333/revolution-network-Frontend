// src/reputation/ReputationService.ts
import { db } from '../db/client';
import { emitEvent } from '../events/eventBus';

export class ReputationService {

  /**
   * Applique un gain de réputation (+2 par défaut) sur job réussi.
   */
  static async gainReputation(nodeId: string): Promise<void> {
    const config = await db('system_config').where({ key: 'node_reputation_gain' }).first();
    const gain = parseInt(config?.value || '2');
    const maxConfig = await db('system_config').where({ key: 'node_reputation_max' }).first();
    const maxRep = parseInt(maxConfig?.value || '100');

    await db.transaction(async (trx) => {
      const node = await trx('nodes').where({ id: nodeId }).select('reputation_score').first();
      if (!node) return;

      const newScore = Math.min(node.reputation_score + gain, maxRep);
      await trx('nodes').where({ id: nodeId }).update({ reputation_score: newScore });

      await emitEvent(trx, {
        event_type: 'node.reputation_gain',
        aggregate_id: nodeId,
        payload: { node_id: nodeId, gain, new_score: newScore }
      });
    });
  }

  /**
   * Applique une pénalité de réputation (-10 par défaut) sur job échoué.
   * Suspend le node si son score chute trop bas.
   */
  static async penalizeReputation(nodeId: string, reason: string): Promise<void> {
    const config = await db('system_config').where({ key: 'node_reputation_penalty' }).first();
    const penalty = parseInt(config?.value || '10');
    const minConfig = await db('system_config').where({ key: 'node_min_reputation' }).first();
    const minRep = parseInt(minConfig?.value || '30');

    await db.transaction(async (trx) => {
      const node = await trx('nodes').where({ id: nodeId }).select('reputation_score').first();
      if (!node) return;

      const newScore = Math.max(node.reputation_score - penalty, 0);
      const shouldSuspend = newScore < minRep;

      await trx('nodes').where({ id: nodeId }).update({ 
        reputation_score: newScore,
        is_active: shouldSuspend ? 0 : 1,
        total_jobs_failed: trx.raw('total_jobs_failed + 1')
      });

      await emitEvent(trx, {
        event_type: 'node.penalized',
        aggregate_id: nodeId,
        payload: { node_id: nodeId, penalty, new_score: newScore, reason }
      });

      if (shouldSuspend) {
        await emitEvent(trx, {
          event_type: 'node.suspended',
          aggregate_id: nodeId,
          payload: { node_id: nodeId, reason: 'Réputation trop basse' }
        });
      }
    });
  }
}
