import { INestApplication } from '@nestjs/common';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import request from 'supertest';
import { OrdersDatabase } from '../../src/modules/orders/infrastructure/postgres/orders-database';
import { createTestApp, validBody } from './test-app';

const SPLIT = '/api/v1/orders/split';

function suite(name: string, make: () => Promise<INestApplication>) {
  describe(`Idempotency-Key (${name})`, () => {
    let app: INestApplication;
    beforeEach(async () => {
      app = await make();
    });
    afterEach(() => app.close());
    const http = () => request(app.getHttpServer());

    it('replays the original order instead of creating a duplicate', async () => {
      const first = await http()
        .post(SPLIT)
        .set('Idempotency-Key', 'key-0001')
        .send(validBody)
        .expect(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();

      const retry = await http()
        .post(SPLIT)
        .set('Idempotency-Key', 'key-0001')
        .send(validBody)
        .expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body).toEqual(first.body);
      expect((await http().get('/api/v1/orders').expect(200)).body.total).toBe(1);
    });

    it('treats the same body with reordered keys as the same request', async () => {
      await http().post(SPLIT).set('Idempotency-Key', 'key-0002').send(validBody).expect(201);
      const reordered = { portfolio: validBody.portfolio, totalAmount: 100, type: 'BUY' };
      const res = await http()
        .post(SPLIT)
        .set('Idempotency-Key', 'key-0002')
        .send(reordered)
        .expect(201);
      expect(res.headers['idempotent-replayed']).toBe('true');
    });

    it('rejects the same key with a different body (422)', async () => {
      await http().post(SPLIT).set('Idempotency-Key', 'key-0003').send(validBody).expect(201);
      const res = await http()
        .post(SPLIT)
        .set('Idempotency-Key', 'key-0003')
        .send({ ...validBody, totalAmount: 999 })
        .expect(422);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('creates distinct orders when keys differ or no key is sent', async () => {
      await http().post(SPLIT).set('Idempotency-Key', 'key-000a').send(validBody).expect(201);
      await http().post(SPLIT).set('Idempotency-Key', 'key-000b').send(validBody).expect(201);
      await http().post(SPLIT).send(validBody).expect(201);
      await http().post(SPLIT).send(validBody).expect(201);
      expect((await http().get('/api/v1/orders').expect(200)).body.total).toBe(4);
    });

    it('collapses concurrent requests carrying the same key into one order', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post(SPLIT).set('Idempotency-Key', 'key-race').send(validBody),
        ),
      );
      expect(responses.every((r) => r.status === 201)).toBe(true);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect((await http().get('/api/v1/orders').expect(200)).body.total).toBe(1);
    });

    it('rejects a malformed key with 400', async () => {
      const res = await http()
        .post(SPLIT)
        .set('Idempotency-Key', 'has spaces')
        .send(validBody)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });
}

suite('memory', () => createTestApp());
suite('postgres', () =>
  createTestApp({
    env: {
      STORAGE: 'postgres',
      ORDERS_DB_URL: 'postgresql://u:p@h:5432/d',
      ORDERS_DB_AUTO_SCHEMA: 'true',
    },
    database: (() => {
      const { Pool: MemPool } = newDb().adapters.createPg();
      return class extends OrdersDatabase {
        protected override createPool(): Pool {
          return new MemPool() as unknown as Pool;
        }
      };
    })(),
  }),
);
