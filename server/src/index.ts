import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import type { ServerConfig } from './config.js';
import { loadConfig } from './config.js';
import { prepareDataDir } from './store.js';

const SHUTDOWN_GRACE_MS = 10_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    console.error(`Invalid configuration: ${errorMessage(err)}`);
    process.exit(1);
  }

  try {
    await prepareDataDir(config.dataDir);
  } catch (err) {
    console.error(`DATA_DIR ${config.dataDir} is not usable: ${errorMessage(err)}`);
    process.exit(1);
  }

  if (config.allowedOrigins.length === 0) {
    console.warn('ALLOWED_ORIGINS is empty: browsers on other origins cannot call this server.');
  }

  const app = createApp(config);
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(
      `Backup server listening on port ${info.port} ` +
        `(data: ${config.dataDir}; origins: ${config.allowedOrigins.join(', ') || 'none'})`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: finishing in-flight requests, then exiting.`);
    // Stop accepting connections; in-flight requests (e.g. an upload) are allowed to finish.
    server.close((err) => {
      if (err) console.error(`Error while closing server: ${err.message}`);
      process.exit(err ? 1 : 0);
    });
    setTimeout(() => {
      console.error('Shutdown grace period elapsed; exiting.');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

await main();
