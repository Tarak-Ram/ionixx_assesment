import { INestApplication } from '@nestjs/common';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../../src/config/app.config';
import { OrdersDatabase } from '../../src/modules/orders/infrastructure/postgres/orders-database';
import { createTestApp, validBody } from './test-app';

const SPLIT = '/api/v1/orders/split';

describe('production hardening', () => {
  let app: INestApplication;
  afterEach(() => app?.close());
  const http = () => request(app.getHttpServer());

  describe('security headers, CORS', () => {
    beforeEach(async () => {
      app = await createTestApp({ env: { CORS_ORIGINS: 'https://partner.example.com' } });
    });

    it('sends helmet headers', async () => {
      const res = await http().get('/api/v1/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows only configured origins', async () => {
      const ok = await http().get('/api/v1/health').set('Origin', 'https://partner.example.com');
      expect(ok.headers['access-control-allow-origin']).toBe('https://partner.example.com');
      const bad = await http().get('/api/v1/health').set('Origin', 'https://evil.example.com');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('allows no CORS origin by default', async () => {
    app = await createTestApp();
    const res = await http().get('/api/v1/health').set('Origin', 'https://any.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  describe('rate limiting', () => {
    it('answers 429 with the standard error shape once the limit is exceeded', async () => {
      app = await createTestApp({ env: { RATE_LIMIT_MAX: '2' } });
      await http().post(SPLIT).send(validBody).expect(201);
      await http().post(SPLIT).send(validBody).expect(201);
      const res = await http().post(SPLIT).send(validBody).expect(429);
      expect(res.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    });

    it('never throttles health probes', async () => {
      app = await createTestApp({ env: { RATE_LIMIT_MAX: '1' } });
      for (let i = 0; i < 5; i++) await http().get('/api/v1/health').expect(200);
    });
  });

  describe('production config guard', () => {
    it('refuses AUTH_MODE=none in production', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('AUTH_MODE=none');
    });

    it('refuses auto schema creation in production', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          AUTH_MODE: 'api-key',
          API_KEYS: 'k:p',
          STORAGE: 'postgres',
          ORDERS_DB_URL: 'postgresql://u:p@h:5432/d',
          ORDERS_DB_AUTO_SCHEMA: 'true',
        }),
      ).toThrow('ORDERS_DB_AUTO_SCHEMA');
    });

    it('accepts a sane production config and disables Swagger by default', () => {
      const config = loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'api-key', API_KEYS: 'k:p' });
      expect(config.swaggerEnabled).toBe(false);
      expect(loadConfig({}).swaggerEnabled).toBe(true);
      expect(
        loadConfig({
          NODE_ENV: 'production',
          AUTH_MODE: 'api-key',
          API_KEYS: 'k:p',
          SWAGGER_ENABLED: 'true',
        }).swaggerEnabled,
      ).toBe(true);
    });

    it.each([
      [{ NODE_ENV: 'staging' }, 'NODE_ENV'],
      [{ LOG_LEVEL: 'loud' }, 'LOG_LEVEL'],
      [{ RATE_LIMIT_MAX: '0' }, 'RATE_LIMIT_MAX'],
      [{ TRUST_PROXY_HOPS: 'x' }, 'TRUST_PROXY_HOPS'],
    ])('rejects invalid %j', (env, mention) => {
      expect(() => loadConfig(env)).toThrow(mention);
    });
  });

  describe('health probes', () => {
    it('liveness and readiness are ok without a database in memory mode', async () => {
      app = await createTestApp();
      await http().get('/api/v1/health').expect(200, { status: 'ok' });
      await http().get('/api/v1/health/ready').expect(200, { status: 'ok', checks: {} });
    });

    it('readiness reports 503 when the database is down, liveness stays 200', async () => {
      const server = newDb();
      const { Pool: MemPool } = server.adapters.createPg();
      let down = false;
      class Flaky extends OrdersDatabase {
        protected override createPool(): Pool {
          const pool = new MemPool() as unknown as Pool;
          const query = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
          (pool as unknown as { query: unknown }).query = (...args: unknown[]) =>
            down ? Promise.reject(new Error('db down')) : query(...args);
          return pool;
        }
      }
      app = await createTestApp({
        env: {
          STORAGE: 'postgres',
          ORDERS_DB_URL: 'postgresql://u:p@h:5432/d',
          ORDERS_DB_AUTO_SCHEMA: 'true',
        },
        database: Flaky,
      });
      await http()
        .get('/api/v1/health/ready')
        .expect(200, { status: 'ok', checks: { ordersDatabase: 'up' } });
      down = true;
      const res = await http().get('/api/v1/health/ready').expect(503);
      expect(res.body).toEqual({ status: 'unavailable', checks: { ordersDatabase: 'down' } });
      await http().get('/api/v1/health').expect(200);
      down = false;
    });
  });

  describe('metrics', () => {
    it('exposes Prometheus metrics with route-pattern labels', async () => {
      app = await createTestApp();
      await http().post(SPLIT).send(validBody).expect(201);
      const res = await http().get('/api/v1/metrics').expect(200);
      expect(res.text).toContain('process_cpu_user_seconds_total');
      expect(res.text).toMatch(
        /http_request_duration_seconds_count\{[^}]*route="\/api\/v1\/orders\/split"[^}]*status_code="201"/,
      );
    });

    it('can be switched off', async () => {
      app = await createTestApp({ env: { METRICS_ENABLED: 'false' } });
      await http().get('/api/v1/metrics').expect(404);
    });
  });

  describe('log redaction', () => {
    it('never writes credentials to the logs', async () => {
      const lines: string[] = [];
      app = await createTestApp({
        env: { LOG_LEVEL: 'info', AUTH_MODE: 'api-key', API_KEYS: 'super-secret-key:p1' },
        logStream: { write: (l: string) => void lines.push(l) },
      });
      await http().post(SPLIT).set('X-API-Key', 'super-secret-key').send(validBody).expect(201);
      expect(lines.join('')).not.toContain('super-secret-key');
    });
  });
});
