// src/queues/backpressure.ts 
import { getQueue } from './queueConfig'; 
import { QueueFullError } from '../domain/errors';

/**
 * Seuils de saturation par type de node.
 */
const QUEUE_LIMITS: Record<string, { max_waiting: number; max_active: number }> = { 
  ffmpeg:  { max_waiting: 500,  max_active: 20  }, 
  sandbox: { max_waiting: 1000, max_active: 50  }, 
  image:   { max_waiting: 800,  max_active: 30  }, 
  text:    { max_waiting: 2000, max_active: 100 }, 
}; 
 
/**
 * Vérifie si une queue peut accepter un nouveau job.
 */
export async function canAcceptJob(nodeType: string): Promise<boolean> { 
  const queue  = getQueue(nodeType); 
  const counts = await queue.getJobCounts('waiting', 'active'); 
  const limits = QUEUE_LIMITS[nodeType]; 

  if (!limits) return true; // Pas de limite définie = illimité
  
  return counts.waiting < limits.max_waiting && counts.active < limits.max_active; 
} 
 
/**
 * Lève une erreur si la queue est pleine (HTTP 503).
 */
export async function assertQueueCapacity(nodeType: string): Promise<void> { 
  const ok = await canAcceptJob(nodeType); 
  if (!ok) throw new QueueFullError(nodeType); 
} 
