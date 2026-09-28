import type { ServerConfig } from './config.js';
import { loadConfig } from './config.js';
import type { RunningServer } from './server.js';
import { startServer } from './server.js';

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

  if (config.allowedOrigins.length === 0) {
    console.warn('ALLOWED_ORIGINS is empty: browsers on other origins cannot call this server.');
  }

  let running: RunningServer;
  try {
    running = await startServer(config);
  } catch (err) {
    console.error(`Could not start (DATA_DIR ${config.dataDir}): ${errorMessage(err)}`);
    process.exit(1);
  }
  console.log(
    `Backup server listening on port ${running.port} ` +
      `(data: ${config.dataDir}; origins: ${config.allowedOrigins.join(', ') || 'none'})`,
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: finishing in-flight requests, then exiting.`);
    // Stop accepting connections; in-flight requests (e.g. an upload) are allowed to finish.
    running.close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(`Error while closing server: ${errorMessage(err)}`);
        process.exit(1);
      },
    );
    setTimeout(() => {
      console.error('Shutdown grace period elapsed; exiting.');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

await main();
