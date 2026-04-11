// src/api/errorHandler.ts 
import { FastifyRequest, FastifyReply } from 'fastify'; 
import { 
  InsufficientCreditsError, UnauthorizedError, UnknownJobTypeError, 
  QueueFullError, JobNotFoundError, AccessDeniedError, 
  IllegalStateTransitionError, ValidationError, 
} from '../domain/errors'; 
  
/**
 * Gestionnaire d'erreurs global pour la production.
 * Masque les détails techniques et les stack traces pour la sécurité.
 */
export function productionErrorHandler( 
  error:   any, 
  request: FastifyRequest, 
  reply:   FastifyReply 
): void { 
  const requestId = request.id; 
  
  // Logger le détail complet côté serveur uniquement 
  request.log.error({ err: error, requestId }, 'Request error'); 
  
  if (error instanceof InsufficientCreditsError) { 
    return void reply.status(402).send({ 
      error:    'Insufficient credits', 
      balance:  error.balance, 
      required: error.required, 
    }); 
  } 
  if (error instanceof UnauthorizedError) { 
    return void reply.status(401).send({ error: 'Invalid API key' }); 
  } 
  if (error instanceof UnknownJobTypeError) { 
    return void reply.status(400).send({ error: `Unknown job type: ${error.type}` }); 
  } 
  if (error instanceof ValidationError) { 
    return void reply.status(400).send({ error: 'Validation error', details: error.details }); 
  } 
  if (error instanceof JobNotFoundError) { 
    return void reply.status(404).send({ error: 'Job not found' }); 
  } 
  if (error instanceof AccessDeniedError) { 
    return void reply.status(403).send({ error: 'Access denied' }); 
  } 
  if (error instanceof QueueFullError) { 
    return void reply.status(503).send({ error: 'Service temporarily unavailable', retry_after: 30 }); 
  } 
  if (error instanceof IllegalStateTransitionError) { 
    // Critique — ne jamais exposer les détails 
    request.log.fatal({ err: error, requestId }, 'CRITICAL: illegal state transition'); 
    return void reply.status(500).send({ error: 'Internal server error', request_id: requestId }); 
  } 
  
  // Fallback Zod ou autres erreurs Fastify
  if (error.validation) {
    return void reply.status(400).send({ 
      error: 'Validation error', 
      details: error.validation 
    });
  }

  // Fallback final — uniquement le request_id, jamais la stack trace 
  return void reply.status(500).send({ error: 'Internal server error', request_id: requestId }); 
} 
