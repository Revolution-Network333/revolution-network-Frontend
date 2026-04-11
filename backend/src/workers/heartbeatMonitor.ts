// src/workers/heartbeatMonitor.ts
import { db } from '../db/client';
import { emitEvent } from '../events/eventBus';

/**
 * Surveille le réseau DePIN et suspend les nodes offline.
 */
export function startHeartbeatMonitor(): void {
  setInterval(async () => {
    // 1. Récupérer le timeout depuis system_config
    const config = await db('system_config').where({ key: 'node_heartbeat_timeout_s' }).first();
    const timeoutSeconds = parseInt(config?.value || '30');

    // 2. Calculer le seuil de déconnexion (UTC)
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000)
      .toISOString()
      .slice(0, 23)
      .replace('T', ' ');

    // 3. Trouver les nodes inactifs
    const offlineNodes = await db('nodes')
      .where({ is_active: 1 })
      .where('last_heartbeat', '<', cutoff)
      .select('id');

    for (const node of offlineNodes) {
      await db.transaction(async (trx) => {
        await trx('nodes').where({ id: node.id }).update({ is_active: 0 });

        await emitEvent(trx, {
          event_type: 'node.offline',
          aggregate_id: node.id,
          payload: { node_id: node.id, reason: `Pas de heartbeat depuis ${timeoutSeconds}s` }
        });
      });
    }
  }, 10_000); // Surveillance toutes les 10 secondes
}
