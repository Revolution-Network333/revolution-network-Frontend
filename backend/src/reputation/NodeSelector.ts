// src/reputation/NodeSelector.ts 
import { db } from '../db/client'; 
import { emitEvent } from '../events/eventBus'; 
import { NoAvailableNodeError } from '../domain/errors'; 
  
export class NodeSelector { 
  
  /**
   * Sélectionne un node pour un job donné en respectant les seuils de réputation et de heartbeat.
   * Single Source of Truth : les seuils viennent de system_config.
   */
  static async selectForJob(nodeType: string): Promise<{ id: string; endpoint_url: string }> { 
    // 1. Lire les seuils depuis system_config
    const configs = await db('system_config') 
      .whereIn('key', ['node_min_reputation', 'node_heartbeat_timeout_s']); 
  
    const minRep           = parseInt(configs.find(r => r.key === 'node_min_reputation')!.value); 
    const heartbeatTimeout = parseInt(configs.find(r => r.key === 'node_heartbeat_timeout_s')!.value); 
  
    const cutoff = new Date(Date.now() - heartbeatTimeout * 1_000) 
      .toISOString() 
      .slice(0, 23) 
      .replace('T', ' '); 
  
    // 2. Sélectionner le meilleur node actif et fiable
    const [node] = await db('nodes') 
      .where({ node_type: nodeType, is_active: 1 }) 
      .where('reputation_score', '>=', minRep) 
      .where('last_heartbeat', '>', cutoff) 
      .orderBy('reputation_score', 'desc') 
      .limit(1) 
      .select('id', 'endpoint_url'); 
  
    if (!node) throw new NoAvailableNodeError(nodeType); 
    return node; 
  } 
  
  /**
   * Met à jour le score de réputation d'un node de manière atomique.
   * Utilise LEAST/GREATEST pour brider le score entre 0 et le max défini.
   */
  static async updateScore(nodeId: string, success: boolean): Promise<void> { 
    const configs = await db('system_config') 
      .whereIn('key', ['node_reputation_gain', 'node_reputation_penalty', 'node_reputation_max', 'node_min_reputation']); 
  
    const gain    = parseInt(configs.find(r => r.key === 'node_reputation_gain')!.value); 
    const penalty = parseInt(configs.find(r => r.key === 'node_reputation_penalty')!.value); 
    const max     = parseInt(configs.find(r => r.key === 'node_reputation_max')!.value); 
    const minRep  = parseInt(configs.find(r => r.key === 'node_min_reputation')!.value);
    
    const delta   = success ? gain : -penalty; 
  
    await db.transaction(async (trx) => { 
      // CLAMP atomique côté MySQL
      await trx.raw( 
        'UPDATE nodes SET reputation_score = LEAST(GREATEST(reputation_score + ?, 0), ?), updated_at = NOW(6) WHERE id = ?', 
        [delta, max, nodeId] 
      ); 
  
      // Vérification auto-suspension si score trop bas 
      const [[node]] = await trx.raw( 
        'SELECT id, reputation_score, is_active FROM nodes WHERE id = ? FOR UPDATE', 
        [nodeId] 
      ); 
  
      if (node.reputation_score < minRep && node.is_active) { 
        await trx('nodes') 
          .where({ id: nodeId }) 
          .update({ is_active: 0 }); 
  
        await emitEvent(trx, { 
          event_type:   'node.suspended', 
          aggregate_id: nodeId, 
          payload:      { node_id: nodeId, score: node.reputation_score, reason: 'Réputation insuffisante' }, 
        }); 
      } 
    }); 
  } 
  
  /**
   * Vide la file d'attente des jobs pour un node suspendu.
   */
  static async drainNodeQueue(nodeId: string): Promise<void> { 
    // Dans notre architecture, les jobs pending d'un node suspendu doivent être redistribués ou échoués
    const pendingJobs = await db('jobs') 
      .where({ node_id: nodeId, status: 'pending' }) 
      .select('id'); 
  
    for (const job of pendingJobs) { 
      // Publication d'un échec pour déclencher le remboursement automatique
      await redis.publish('events:job.failed', JSON.stringify({ 
        event_type:   'job.failed', 
        aggregate_id: job.id, 
        payload:      { job_id: job.id, reason: 'Node suspendu' }, 
      })); 
    } 
  } 
} 
