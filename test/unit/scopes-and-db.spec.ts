import { INestApplication } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { OrdersDatabase } from '../../src/modules/orders/infrastructure/postgres/orders-database';
import { loadConfig } from '../../src/config/app.config';
import { createTestApp, validBody } from '../integration/test-app';

const SECRET = 'x'.repeat(40);
const token = (scope?: string) => sign({ sub: 'p1', ...(scope && { scope }) }, SECRET);

describe('JWT scopes', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createTestApp({ env: { AUTH_MODE: 'jwt', JWT_SECRET: SECRET } });
  });
  afterEach(() => app.close());
  const http = () => request(app.getHttpServer());

  it('403 when a scoped token lacks the required scope', async () => {
    const res = await http()
      .post('/api/v1/orders/split')
      .set('Authorization', `Bearer ${token('orders:read')}`)
      .send(validBody)
      .expect(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('allows a token with the right scope', async () => {
    await http()
      .post('/api/v1/orders/split')
      .set('Authorization', `Bearer ${token('orders:read orders:write')}`)
      .send(validBody)
      .expect(201);
    await http()
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token('orders:read')}`)
      .expect(200);
  });

  it('does not restrict tokens that carry no scope claim', async () => {
    await http()
      .post('/api/v1/orders/split')
      .set('Authorization', `Bearer ${token()}`)
      .send(validBody)
      .expect(201);
  });
});

describe('OrdersDatabase startup retry', () => {
  const config = loadConfig({
    STORAGE: 'postgres',
    ORDERS_DB_URL: 'postgresql://u:p@h:5432/d',
    ORDERS_DB_CONNECT_RETRIES: '3',
    ORDERS_DB_CONNECT_RETRY_DELAY_MS: '100',
  });

  function build(failures: number) {
    const delays: number[] = [];
    let calls = 0;
    class Db extends OrdersDatabase {
      protected override createPool() {
        return {
          on: () => undefined,
          end: async () => undefined,
          query: async () => {
            if (calls++ < failures) throw new Error('ECONNREFUSED');
            return { rows: [] };
          },
        } as never;
      }
      protected override sleep(ms: number) {
        delays.push(ms);
        return Promise.resolve();
      }
    }
    return { db: new Db(config), delays };
  }

  it('retries with exponential backoff and then connects', async () => {
    const { db, delays } = build(2);
    await db.onModuleInit();
    expect(delays).toEqual([100, 200]);
    expect(await db.ping()).toBe(true);
  });

  it('gives up after the configured retries so the boot fails', async () => {
    const { db, delays } = build(99);
    await expect(db.onModuleInit()).rejects.toThrow('ECONNREFUSED');
    expect(delays).toEqual([100, 200, 400]);
  });
});
