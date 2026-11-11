import http from 'node:http';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { startJobs, stopJobs } from './jobs/queue.js';
import { registerJobFiles } from './jobs/index.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb();
  const app = await createApp();
  const server = http.createServer(app);
  const io = initSockets(server);
  await registerJobFiles();
  startJobs();

  server.listen(env.PORT, () => {
    logger.info(`ÉLAN API listening on :${env.PORT}`, { env: env.NODE_ENV, origins: env.allowedOrigins });
  });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down`);
    stopJobs();
    io.close();
    server.close(async () => {
      await disconnectDb().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start server', { message: err.message });
  process.exit(1);
});
