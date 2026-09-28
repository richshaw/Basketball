import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import { createApp } from './app.js';
import type { ServerConfig } from './config.js';
import { prepareDataDir } from './store.js';

export interface RunningServer {
  port: number;
  /** Stops accepting connections and resolves once in-flight requests have finished. */
  close: () => Promise<void>;
}

/**
 * Prepares the data directory and starts the HTTP server. Clients get `requestTimeoutMs` to
 * send a whole request (Node answers 408 after that), and connections that make no progress
 * for twice that long are dropped (e.g. a client that stops reading a download), so stalled
 * uploads and stalled downloads can't pile up.
 */
export async function startServer(config: ServerConfig): Promise<RunningServer> {
  await prepareDataDir(config.dataDir);
  const app = createApp(config);
  const timeout = config.requestTimeoutMs;
  const server = createAdaptorServer({
    fetch: app.fetch,
    serverOptions: {
      requestTimeout: timeout,
      headersTimeout: Math.min(15_000, timeout),
      // How often Node checks those two timeouts (default 30 s would stretch them a lot).
      connectionsCheckingInterval: Math.max(100, Math.min(5_000, Math.floor(timeout / 4))),
    },
  }) as Server;
  // Longer than requestTimeout, so a stalled upload gets a proper 408 first.
  server.setTimeout(2 * timeout);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.hostname, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // close() only drops keep-alive connections that are idle at this instant. Keep
        // dropping them as in-flight requests finish, instead of waiting for keep-alive expiry.
        const sweep = setInterval(() => server.closeIdleConnections(), 50);
        server.once('close', () => clearInterval(sweep));
      }),
  };
}
