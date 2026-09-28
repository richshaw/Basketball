import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Harness } from './helpers.js';
import {
  ALLOWED_ORIGIN,
  auth,
  bytes,
  createHarness,
  getWithToken,
  hex64,
  putBackup,
  statusOf,
  uploadOk,
} from './helpers.js';

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.cleanup();
});

function preflight(origin: string, method = 'PUT'): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/v1/backups/${hex64()}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    }),
  );
}

function corsHeaders(res: Response): string[] {
  return [...res.headers.keys()].filter((name) => name.startsWith('access-control-'));
}

describe('CORS', () => {
  it('answers a preflight from the allowed origin', async () => {
    const res = await preflight(ALLOWED_ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, DELETE, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('refuses a preflight from any other origin, with no CORS headers', async () => {
    for (const origin of [
      'https://evil.example',
      'https://richshaw.github.io.evil.example',
      'http://richshaw.github.io',
      'null',
    ]) {
      const res = await preflight(origin);
      expect(res.status).toBe(403);
      expect(corsHeaders(res)).toEqual([]);
    }
  });

  it('adds CORS headers (incl. exposed version headers) to actual responses for the allowed origin', async () => {
    const accountId = hex64();
    const token = hex64();
    const upload = await uploadOk(h.app, accountId, token, bytes(8), { Origin: ALLOWED_ORIGIN });
    const res = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token, {
      Origin: ALLOWED_ORIGIN,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      'X-Backup-Version, X-Backup-Created-At, Retry-After',
    );
    expect(res.headers.get('X-Backup-Version')).toBe(upload.version);
    await res.arrayBuffer();
  });

  it('lets the app read Retry-After on a 429', async () => {
    const limited = await createHarness({ limits: { requestsPerIpPerMinute: 1 } });
    try {
      await limited.app.request('/v2/anything', { headers: { Origin: ALLOWED_ORIGIN } });
      const res = await limited.app.request('/v2/anything', {
        headers: { Origin: ALLOWED_ORIGIN },
      });
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    } finally {
      await limited.cleanup();
    }
  });

  it('adds CORS headers to error responses too, so the app can read the status', async () => {
    const res = await putBackup(h.app, 'not-an-id', hex64(), bytes(8), { Origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);

    const unauthorized = await getWithToken(h.app, `/v1/backups/${hex64()}`, hex64(), {
      Origin: ALLOWED_ORIGIN,
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });

  it('adds no CORS headers for other origins or requests without Origin', async () => {
    const other = await h.app.request('/health', { headers: { Origin: 'https://evil.example' } });
    expect(other.status).toBe(200);
    expect(corsHeaders(other)).toEqual([]);
    const none = await h.app.request('/health');
    expect(corsHeaders(none)).toEqual([]);
  });

  it('answers a plain OPTIONS without Origin', async () => {
    const res = await h.app.request('/v1/backups/x', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Allow')).toBe('GET, PUT, DELETE, OPTIONS');
    expect(corsHeaders(res)).toEqual([]);
  });

  it('supports several configured origins', async () => {
    const multi = await createHarness({
      allowedOrigins: [ALLOWED_ORIGIN, 'http://localhost:5173'],
    });
    try {
      const res = await multi.app.request('/health', {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    } finally {
      await multi.cleanup();
    }
  });
});

describe('security headers', () => {
  it.each(['/health', '/v2/unknown'])('are set on %s', async (url) => {
    const res = await h.app.request(url);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('are set on blob downloads and preflights', async () => {
    const accountId = hex64();
    const token = hex64();
    await uploadOk(h.app, accountId, token, bytes(8));
    const blob = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(blob.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(blob.headers.get('Cache-Control')).toBe('no-store');
    await blob.arrayBuffer();
    const res = await preflight(ALLOWED_ORIGIN);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('request log', () => {
  it('writes one concise line per request without ids, tokens or bodies', async () => {
    const accountId = hex64();
    const token = hex64();
    const payload = new TextEncoder().encode('ciphertext-marker');
    const upload = await uploadOk(h.app, accountId, token, new Uint8Array(payload));
    await statusOf(getWithToken(h.app, `/v1/backups/${accountId}/${upload.version}`, token));
    await getWithToken(h.app, `/v1/backups/${accountId}`, hex64());

    expect(h.logs).toHaveLength(3);
    const short = `${accountId.slice(0, 8)}...`;
    expect(h.logs[0]).toMatch(
      new RegExp(`^PUT /v1/backups/${short.replace(/\./g, '\\.')} 201 \\d+ms$`),
    );
    expect(h.logs[1]).toContain(`GET /v1/backups/${short}/${upload.version} 200 `);
    expect(h.logs[2]).toContain(`GET /v1/backups/${short} 401 `);
    const all = h.logs.join('\n');
    expect(all).not.toContain(accountId);
    expect(all).not.toContain(token);
    expect(all).not.toContain('ciphertext-marker');
  });

  it('redacts ids from error details too', async () => {
    const accountId = hex64();
    const token = hex64();
    await uploadOk(h.app, accountId, token, bytes(8));
    // Replace the versions directory with a file: readdir then fails with an error whose
    // message contains the full on-disk path (and therefore the full account id).
    const versionsDir = path.join(h.dataDir, 'accounts', accountId, 'versions');
    await rm(versionsDir, { recursive: true });
    await writeFile(versionsDir, 'not a directory');

    const res = await h.app.request(`/v1/backups/${accountId}`, { headers: auth(token) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    const all = h.logs.join('\n');
    expect(all).toContain('error in GET');
    expect(all).toContain('ENOTDIR');
    expect(all).toContain(`${accountId.slice(0, 8)}...`);
    expect(all).not.toContain(accountId);
    expect(all).not.toContain(token);
  });
});
