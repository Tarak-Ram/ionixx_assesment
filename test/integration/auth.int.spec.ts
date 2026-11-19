import { INestApplication } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { createFunctionStrategy } from '../../src/modules/auth/strategies/function.strategy';
import { createTestApp, validBody } from './test-app';

const SECRET = 'a-very-long-secret-with-at-least-32-chars!!';

describe('Authentication (pluggable strategies)', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  describe('AUTH_MODE=none (default)', () => {
    it('allows requests without credentials', async () => {
      app = await createTestApp();
      await request(app.getHttpServer()).post('/api/v1/orders/split').send(validBody).expect(201);
    });
  });

  describe('AUTH_MODE=api-key', () => {
    beforeEach(async () => {
      app = await createTestApp({
        env: { AUTH_MODE: 'api-key', API_KEYS: 'key-a:partner-a,key-b:partner-b' },
      });
    });
    const http = () => request(app.getHttpServer());

    it('returns 401 with the standard error shape when the key is missing or wrong', async () => {
      const res = await http().post('/api/v1/orders/split').send(validBody).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
      await http().get('/api/v1/orders').set('x-api-key', 'wrong').expect(401);
    });

    it('keeps the health check public', async () => {
      await http().get('/api/v1/health').expect(200);
    });

    it("isolates each partner's order history", async () => {
      const a = await http()
        .post('/api/v1/orders/split')
        .set('x-api-key', 'key-a')
        .send(validBody)
        .expect(201);

      const listA = await http().get('/api/v1/orders').set('x-api-key', 'key-a').expect(200);
      expect(listA.body.total).toBe(1);
      expect(listA.body.data[0].partnerId).toBe('partner-a');

      expect(
        (await http().get('/api/v1/orders').set('x-api-key', 'key-b').expect(200)).body.total,
      ).toBe(0);
      // Another partner's order id is reported as not found, never as forbidden.
      await http().get(`/api/v1/orders/${a.body.id}`).set('x-api-key', 'key-b').expect(404);
      await http().get(`/api/v1/orders/${a.body.id}`).set('x-api-key', 'key-a').expect(200);
    });
  });

  describe('AUTH_MODE=jwt', () => {
    beforeEach(async () => {
      app = await createTestApp({ env: { AUTH_MODE: 'jwt', JWT_SECRET: SECRET } });
    });
    const token = (sub: string, secret = SECRET) =>
      `Bearer ${sign({ sub }, secret, { algorithm: 'HS256', expiresIn: '5m' })}`;

    it('accepts a valid bearer token and scopes data to its subject', async () => {
      const http = request(app.getHttpServer());
      await http
        .post('/api/v1/orders/split')
        .set('authorization', token('partner-a'))
        .send(validBody)
        .expect(201);
      expect(
        (await http.get('/api/v1/orders').set('authorization', token('partner-a'))).body.total,
      ).toBe(1);
      expect(
        (await http.get('/api/v1/orders').set('authorization', token('partner-b'))).body.total,
      ).toBe(0);
    });

    it('rejects missing and forged tokens', async () => {
      const http = request(app.getHttpServer());
      await http.get('/api/v1/orders').expect(401);
      await http
        .get('/api/v1/orders')
        .set('authorization', token('p', 'y'.repeat(40)))
        .expect(401);
    });
  });

  describe('custom strategy written as a function', () => {
    it('can be plugged in through AuthModule options', async () => {
      app = await createTestApp({
        auth: {
          strategy: createFunctionStrategy('partner-header', (req) =>
            req.headers['x-partner'] ? { partnerId: String(req.headers['x-partner']) } : null,
          ),
        },
      });
      const http = request(app.getHttpServer());
      await http.get('/api/v1/orders').expect(401);
      await http.post('/api/v1/orders/split').set('x-partner', 'acme').send(validBody).expect(201);
      expect((await http.get('/api/v1/orders').set('x-partner', 'acme')).body.total).toBe(1);
    });
  });
});
