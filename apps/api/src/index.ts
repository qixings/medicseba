import { Server } from 'socket.io';
import { buildApp } from './server.js';
import { env } from './env.js';
import { attachIo } from './queue.js';
import { ensureSessions } from './sessions.js';
import { releaseExpiredHolds } from './booking.js';
import { autoSettle } from './admin-logic.js';

const app = await buildApp();
await app.listen({ port: env.port, host: '0.0.0.0' });

const io = new Server(app.server, { path: '/socket.io', cors: { origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',') } });
attachIo(io);

// Keep ~5 weeks of sessions ahead, and free unpaid holds every 30 s.
await ensureSessions(undefined, 35);
setInterval(() => ensureSessions(undefined, 35).catch((e) => app.log.error(e)), 60 * 60_000);
setInterval(() => releaseExpiredHolds().catch((e) => app.log.error(e)), 30_000);
// Settle yesterday's money per chamber (safe to repeat; paid rows are never touched).
setInterval(() => autoSettle().catch((e) => app.log.error(e)), 60 * 60_000);
autoSettle().catch((e) => app.log.error(e));
