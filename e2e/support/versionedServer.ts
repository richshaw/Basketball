import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The production build made by Playwright's webServer (`npm run build`). */
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const BASE_PATH = '/Basketball/';
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

type Build = Map<string, Buffer>;
export type BuildLabel = 'a' | 'b';

function readBuild(dir: string, build: Build = new Map()): Build {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) readBuild(path, build);
    else build.set(relative(DIST, path).split(sep).join('/'), readFileSync(path));
  }
  return build;
}

/**
 * A copy of the build that says which version it is (`<meta name="hoop-stats-build">`
 * in index.html). The service worker's precache revision for index.html is updated to
 * match, so the browser sees a genuinely new version, just like after a deploy.
 */
function labelBuild(build: Build, label: BuildLabel): Build {
  const html = build
    .get('index.html')
    ?.toString('utf8')
    .replace('</head>', `<meta name="hoop-stats-build" content="${label}" /></head>`);
  const sw = build.get('sw.js')?.toString('utf8');
  const precacheEntry = /\{url:"index\.html",revision:"[\da-f]+"\}/;
  if (!html || !sw || !precacheEntry.test(sw)) {
    throw new Error('Unexpected build output: no index.html precache entry in dist/sw.js');
  }
  const revision = createHash('md5').update(html).digest('hex');
  return new Map(build)
    .set('index.html', Buffer.from(html))
    .set(
      'sw.js',
      Buffer.from(sw.replace(precacheEntry, `{url:"index.html",revision:"${revision}"}`)),
    );
}

export interface VersionedServer {
  /** The app's URL, e.g. `http://127.0.0.1:53124/Basketball/`. */
  url: string;
  /** Switches the build the server hands out, like a new deploy. */
  deploy(label: BuildLabel): void;
  close(): Promise<void>;
}

/** Serves build "a" (then "b" after `deploy('b')`) on a free port, under /Basketball/. */
export async function startVersionedServer(): Promise<VersionedServer> {
  const dist = readBuild(DIST);
  const builds = { a: labelBuild(dist, 'a'), b: labelBuild(dist, 'b') };
  let current = builds.a;

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const name = pathname.startsWith(BASE_PATH)
      ? pathname.slice(BASE_PATH.length) || 'index.html'
      : '';
    const file = current.get(name);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(name)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(file);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${BASE_PATH}`,
    deploy: (label) => {
      current = builds[label];
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
