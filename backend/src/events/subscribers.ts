// src/events/subscribers.ts 
import { redis } from '../redis/client'; 
import { RefundService } from '../settlement/RefundService'; 
import { SettlementEngine } from '../settlement/SettlementEngine'; 
 
/**
 * Enregistre tous les consommateurs d'événements Redis.
 * Permet une communication asynchrone et découplée entre les modules.
 */
export function registerAllSubscribers(): void { 
  
  // 1. Job échoué → Remboursement automatique de l'utilisateur
  redis.subscribe('events:job.failed', (err, count) => {
    if (err) console.error('[Subscriber] Error subscribing to job.failed:', err);
  });

  // 2. Preuve reçue → Lancement du processus de règlement (Settlement)
  redis.subscribe('events:proof.received', (err, count) => {
    if (err) console.error('[Subscriber] Error subscribing to proof.received:', err);
  });

  // 3. Preuve invalide → Échec du job et remboursement
  redis.subscribe('events:proof.invalid', (err, count) => {
    if (err) console.error('[Subscriber] Error subscribing to proof.invalid:', err);
  });

  // Gestion des messages entrants
  redis.on('message', async (channel, message) => {
    try {
      const event = JSON.parse(message);

      switch (channel) {
        case 'events:job.failed':
          await RefundService.processRefund( 
            event.payload.job_id, 
            event.payload.reason 
          );
          break;

        case 'events:proof.received':
          await SettlementEngine.settle(event.payload);
          break;

        case 'events:proof.invalid':
          await RefundService.processRefund( 
            event.payload.job_id, 
            `Proof invalide : ${event.payload.reason}` 
          );
          break;
      }
    } catch (err) {
      console.error(`[Subscriber] Error processing event from ${channel}:`, err);
    }
  });
} 
