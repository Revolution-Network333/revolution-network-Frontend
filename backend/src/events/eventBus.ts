// src/events/eventBus.ts 
import crypto from 'crypto'; 
import { Knex } from 'knex'; 
import { db } from '../db/client'; 
import { redis } from '../redis/client'; 
 
export interface DomainEvent { 
  event_type:   string; 
  aggregate_id: string; 
  payload:      Record<string, unknown>; 
} 
 
/** 
  * DUAL WRITE : persiste en MySQL (durabilité) + publie sur Redis (temps réel). 
  * Appelé TOUJOURS dans la même transaction que la mutation métier. 
  * Si la transaction rollback → l'événement n'est jamais enregistré. 
  */ 
 export async function emitEvent( 
   trx: Knex.Transaction, 
   event: DomainEvent 
 ): Promise<void> { 
   const id = crypto.randomUUID(); 
 
   // 1. Persister dans domain_events (dans la transaction pour la durabilité) 
   await trx('domain_events').insert({ 
     id, 
     event_type:   event.event_type, 
     aggregate_id: event.aggregate_id, 
     payload:      JSON.stringify(event.payload), 
     published:    0, 
   }); 
 
   // 2. Publier sur Redis après le commit (asynchrone) 
   process.nextTick(async () => { 
     try { 
       await redis.publish( 
         `events:${event.event_type}`, 
         JSON.stringify({ id, ...event }) 
       ); 
       // Marquer comme publié une fois Redis notifié
       await db('domain_events').where({ id }).update({ published: 1 }); 
     } catch (err) { 
       // L'outbox poller prendra le relais si Redis est down 
       console.error('[EventBus] Redis publish error, poller will retry:', err);
     } 
   }); 
 } 
 
 /** 
  * OUTBOX POLLER : republier les événements non publiés (résilience Redis down). 
  * Démarre au boot du serveur, tourne toutes les 5 secondes. 
  */ 
 export function startOutboxPoller(): void { 
   setInterval(async () => { 
     const cutoff = new Date(Date.now() - 5_000) 
       .toISOString() 
       .slice(0, 23) 
       .replace('T', ' '); 
 
     const unpublished = await db('domain_events') 
       .where({ published: 0 }) 
       .where('created_at', '<', cutoff) 
       .orderBy('created_at', 'asc') 
       .limit(50); 
 
     for (const event of unpublished) { 
       try { 
         await redis.publish( 
           `events:${event.event_type}`, 
           JSON.stringify({ id: event.id, ...JSON.parse(event.payload) }) 
         ); 
         await db('domain_events').where({ id: event.id }).update({ published: 1 }); 
       } catch { 
         // Retry au prochain cycle si Redis est toujours injoignable
       } 
     } 
   }, 5_000); 
 } 
