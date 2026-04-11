// src/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';

import { jobRoutes } from './routes/jobs';
import { creditRoutes } from './routes/credits';
import { webhookRoutes } from './routes/webhooks';
import { startOutboxPoller } from './events/eventBus';
import { registerAllSubscribers } from './events/subscribers';
import { startHeartbeatMonitor } from './workers/heartbeatMonitor';
import { startTimeoutWatcher } from './workers/timeoutWatcher';
import { startFfmpegWorker } from './workers/ffmpegWorker';
import { startSandboxWorker } from './workers/sandboxWorker';
import { startImageWorker } from './workers/imageWorker';
import { startTextWorker } from './workers/textWorker';
import { productionErrorHandler } from './api/errorHandler';

dotenv.config();

const fastify = Fastify({ 
  logger: true,
  ajv: { customOptions: { removeAdditional: true } }
});

// 1. Plugins de sécurité et performance
fastify.register(helmet);
fastify.register(cors);
fastify.register(rateLimit, { 
  max: 100, 
  timeWindow: '1 minute',
  keyGenerator: (request) => (request.headers['x-api-key'] as string) || request.ip
});

// 2. Gestion globale des erreurs (Règle 4)
fastify.setErrorHandler(productionErrorHandler);

// 3. Enregistrement des routes avec versioning /v1/ (Contrat V1)
fastify.register(webhookRoutes, { prefix: '/v1' });
fastify.register(jobRoutes, { prefix: '/v1' });
fastify.register(creditRoutes, { prefix: '/v1' });

// 4. Démarrage des services d'arrière-plan
async function bootstrap() {
  try {
    // A. Événements et orchestration
    registerAllSubscribers();
    startOutboxPoller();
    
    // B. Surveillance du réseau
    startHeartbeatMonitor();
    startTimeoutWatcher();
    
    // C. Workers de traitement
    startFfmpegWorker();
    startSandboxWorker();
    startImageWorker();
    startTextWorker();

    // D. Démarrage de l'API
    const port = parseInt(process.env.PORT || '10000');
    await fastify.listen({ port, host: '0.0.0.0' });
    
    console.log(`🚀 Revolution Backend V1 Started on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();
