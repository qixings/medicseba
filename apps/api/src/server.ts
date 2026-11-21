import { broadcastChange, scopesFor } from './queue.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './env.js';
import { ApiError } from './errors.js';
import { catalogRoutes } from './routes/catalog.js';
import { patientRoutes } from './routes/patient.js';
import { agentRoutes } from './routes/agent.js';
import { webhookRoutes } from './routes/webhooks.js';
import { payRoutes } from './routes/pay.js';
import { adminRoutes, uploadRoutes } from './routes/admin.js';
import { receiptRoutes } from './routes/receipts.js';
import { chamberSelfRoutes } from './routes/chamber-self.js';

export async function buildApp() {
  const app = Fastify({ logger: env.nodeEnv !== 'test', trustProxy: true });
  await app.register(cors, { origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','), methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  // preHandler so per-phone limits can read the request body.
  await app.register(rateLimit, { global: false, hook: 'preHandler' });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid', message: err.issues[0]?.message ?? 'Invalid input', issues: err.issues });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'request', message: e.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'server', message: 'Something went wrong. Try again' });
  });

  app.get('/health', async () => ({ ok: true }));
  // After any successful change, nudge open apps to reload what they show.
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode < 400) { const sc = scopesFor(req.method, req.url); if (sc.length) broadcastChange(...sc); }
  });
  await app.register(catalogRoutes, { prefix: '/v1' });
  await app.register(patientRoutes, { prefix: '/v1' });
  await app.register(agentRoutes, { prefix: '/v1' });
  await app.register(webhookRoutes, { prefix: '/v1' });
  await app.register(payRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(uploadRoutes);
  await app.register(receiptRoutes, { prefix: '/v1' });
  await app.register(chamberSelfRoutes, { prefix: '/v1' });
  return app;
}
