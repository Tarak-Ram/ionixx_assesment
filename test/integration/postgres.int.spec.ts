import { INestApplication } from '@nestjs/common';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import request from 'supertest';
import { OrdersDatabase } from '../../src/modules/orders/infrastructure/postgres/orders-database';
import { createTestApp, validBody } from './test-app';

/**
 * Exercises the real SQL of PostgresOrderRepository through the full HTTP pipeline, using the
 * pg-mem in-process Postgres emulator (no server, no network). `sharedDb` plays the part of a
 * database server that outlives application restarts.
 */
const postgresEnv = {
  STORAGE: 'postgres',
  ORDERS_DB_URL: 'postgresql://orders_app:secret@db.internal:5432/orders',
  ORDERS_DB_AUTO_SCHEMA: 'true',
};

function emulatedDatabase(server: ReturnType<typeof newDb>) {
  const { Pool: MemPool } = server.adapters.createPg();
  return class EmulatedOrdersDatabase extends OrdersDatabase {
    protected override createPool(): Pool {
      return new MemPool() as unknown as Pool;
    }
  };
}

describe('Postgres storage (STORAGE=postgres)', () => {
  let app: INestApplication;
  afterEach(() => app?.close());

  it('stores and reads orders through SQL, newest first, with pagination', async () => {
    app = await createTestApp({ env: postgresEnv, database: emulatedDatabase(newDb()) });
    const http = request(app.getHttpServer());

    const first = await http.post('/api/v1/orders/split').send(validBody).expect(201);
    const second = await http
      .post('/api/v1/orders/split')
      .send({ ...validBody, type: 'SELL' })
      .expect(201);

    const all = await http.get('/api/v1/orders').expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.data.map((o: { id: string }) => o.id)).toEqual([second.body.id, first.body.id]);

    const page = await http.get('/api/v1/orders?limit=1&offset=1').expect(200);
    expect(page.body.data.map((o: { id: string }) => o.id)).toEqual([first.body.id]);

    const one = await http.get(`/api/v1/orders/${first.body.id}`).expect(200);
    expect(one.body).toEqual(first.body); // exact round-trip, decimals still strings
  });

  it('returns 404 for an unknown order', async () => {
    app = await createTestApp({ env: postgresEnv, database: emulatedDatabase(newDb()) });
    await request(app.getHttpServer())
      .get('/api/v1/orders/3f2c9a54-8b1e-4a57-9c1e-0d6c5c2b9a11')
      .expect(404);
  });

  it("isolates partners: one partner's rows are invisible to another", async () => {
    app = await createTestApp({
      env: { ...postgresEnv, AUTH_MODE: 'api-key', API_KEYS: 'key-a:partner-a,key-b:partner-b' },
      database: emulatedDatabase(newDb()),
    });
    const http = request(app.getHttpServer());
    const a = await http
      .post('/api/v1/orders/split')
      .set('x-api-key', 'key-a')
      .send(validBody)
      .expect(201);

    expect((await http.get('/api/v1/orders').set('x-api-key', 'key-b')).body.total).toBe(0);
    await http.get(`/api/v1/orders/${a.body.id}`).set('x-api-key', 'key-b').expect(404);
    await http.get(`/api/v1/orders/${a.body.id}`).set('x-api-key', 'key-a').expect(200);
  });

  it('keeps history across an application restart (unlike the default in-memory mode)', async () => {
    const server = newDb(); // the "database server" survives the restart
    app = await createTestApp({ env: postgresEnv, database: emulatedDatabase(server) });
    await request(app.getHttpServer()).post('/api/v1/orders/split').send(validBody).expect(201);
    await app.close();

    // Restart: the schema already exists (as it would after migrations), so auto-schema is off.
    // (pg-mem cannot re-parse CREATE TABLE IF NOT EXISTS on an existing table; real Postgres can.)
    app = await createTestApp({
      env: { ...postgresEnv, ORDERS_DB_AUTO_SCHEMA: 'false' },
      database: emulatedDatabase(server),
    });
    expect((await request(app.getHttpServer()).get('/api/v1/orders')).body.total).toBe(1);
  });

  it('refuses to start when the database is unreachable', async () => {
    class UnreachableDatabase extends OrdersDatabase {
      protected override createPool(): Pool {
        return {
          on: () => undefined,
          query: () => Promise.reject(new Error('connect ECONNREFUSED')),
          end: () => Promise.resolve(),
        } as unknown as Pool;
      }
    }
    await expect(
      createTestApp({
        env: { ...postgresEnv, ORDERS_DB_CONNECT_RETRIES: '0' },
        database: UnreachableDatabase,
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('opens no connection in the default in-memory mode', async () => {
    const createPool = jest.fn();
    class SpyDatabase extends OrdersDatabase {
      protected override createPool(): Pool {
        createPool();
        throw new Error('must not be called');
      }
    }
    app = await createTestApp({ database: SpyDatabase });
    await request(app.getHttpServer()).post('/api/v1/orders/split').send(validBody).expect(201);
    expect(createPool).not.toHaveBeenCalled();
  });
});
