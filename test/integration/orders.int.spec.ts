import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, validBody } from './test-app';

describe('Orders API', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(() => app.close());

  describe('POST /api/v1/orders/split', () => {
    it('splits the challenge example: USD 100 → AAPL 60 / TSLA 40 at the default $100 price', async () => {
      const res = await http().post('/api/v1/orders/split').send(validBody).expect(201);

      expect(res.body).toMatchObject({
        type: 'BUY',
        currency: 'USD',
        totalAmount: '100.00',
        status: 'CALCULATED',
        summary: { totalExecutableAmount: '100.00', unusedAmount: '0.00' },
        rounding: { quantityPrecision: 3, mode: 'ROUND_DOWN' },
        schedule: { executionDate: '2026-11-16', status: 'SAME_DAY', timezone: 'UTC' },
      });
      expect(res.body.allocations).toEqual([
        {
          symbol: 'AAPL',
          weightPercent: '60',
          price: '100',
          priceSource: 'DEFAULT',
          allocatedAmount: '60.00',
          quantity: '0.600',
          executableAmount: '60.00',
        },
        {
          symbol: 'TSLA',
          weightPercent: '40',
          price: '100',
          priceSource: 'DEFAULT',
          allocatedAmount: '40.00',
          quantity: '0.400',
          executableAmount: '40.00',
        },
      ]);
      expect(res.body.notice).toMatch(/no trade has been placed/i);
      expect(res.headers.location).toBe(`/api/v1/orders/${res.body.id}`);
    });

    it('lets a partner market price take priority over the default', async () => {
      const res = await http()
        .post('/api/v1/orders/split')
        .send({ ...validBody, marketPrices: { AAPL: 150 } })
        .expect(201);
      expect(res.body.allocations[0]).toMatchObject({
        price: '150',
        priceSource: 'PARTNER',
        quantity: '0.400',
      });
      expect(res.body.allocations[1]).toMatchObject({ price: '100', priceSource: 'DEFAULT' });
    });

    it('supports SELL', async () => {
      const res = await http()
        .post('/api/v1/orders/split')
        .send({ ...validBody, type: 'SELL' })
        .expect(201);
      expect(res.body.type).toBe('SELL');
    });

    it('reports rounding when quantities are truncated', async () => {
      const res = await http()
        .post('/api/v1/orders/split')
        .send({
          type: 'BUY',
          totalAmount: 100,
          portfolio: [
            { symbol: 'A', weight: 33.33 },
            { symbol: 'B', weight: 33.33 },
            { symbol: 'C', weight: 33.34 },
          ],
        })
        .expect(201);
      expect(res.body.summary).toEqual({ totalExecutableAmount: '99.90', unusedAmount: '0.10' });
    });

    it('accepts string amounts/weights', async () => {
      await http()
        .post('/api/v1/orders/split')
        .send({
          type: 'BUY',
          totalAmount: '100.50',
          portfolio: [{ symbol: 'AAPL', weight: '100' }],
        })
        .expect(201);
    });

    it('rolls a Saturday request to Monday and respects the request timezone', async () => {
      const sat = await createTestApp({ now: '2026-11-21T05:00:00Z' });
      const res = await request(sat.getHttpServer())
        .post('/api/v1/orders/split')
        .send(validBody)
        .expect(201);
      expect(res.body.schedule).toMatchObject({
        executionDate: '2026-11-23',
        status: 'NEXT_MARKET_DAY',
      });

      const hnl = await request(sat.getHttpServer())
        .post('/api/v1/orders/split')
        .send({ ...validBody, timezone: 'Pacific/Honolulu' })
        .expect(201);
      // 05:00Z Saturday is still Friday 19:00 in Honolulu (UTC-10).
      expect(hnl.body.schedule).toMatchObject({
        executionDate: '2026-11-20',
        status: 'SAME_DAY',
        timezone: 'Pacific/Honolulu',
      });
      await sat.close();
    });

    it('uses SHARE_PRECISION from configuration (7 decimals)', async () => {
      const app7 = await createTestApp({ env: { SHARE_PRECISION: '7' } });
      const res = await request(app7.getHttpServer())
        .post('/api/v1/orders/split')
        .send(validBody)
        .expect(201);
      expect(res.body.allocations[0].quantity).toBe('0.6000000');
      await app7.close();
    });

    describe('validation (400)', () => {
      const bad = (body: object) => http().post('/api/v1/orders/split').send(body).expect(400);

      it.each([
        ['invalid order type', { ...validBody, type: 'HOLD' }],
        ['missing order type', { ...validBody, type: undefined }],
        ['zero amount', { ...validBody, totalAmount: 0 }],
        ['negative amount', { ...validBody, totalAmount: -10 }],
        ['non-numeric amount', { ...validBody, totalAmount: 'abc' }],
        ['amount with 3 decimals', { ...validBody, totalAmount: 10.123 }],
        ['missing portfolio', { ...validBody, portfolio: undefined }],
        ['empty portfolio', { ...validBody, portfolio: [] }],
        ['missing symbol', { ...validBody, portfolio: [{ weight: 100 }] }],
        ['invalid symbol', { ...validBody, portfolio: [{ symbol: '1$', weight: 100 }] }],
        [
          'zero weight',
          {
            ...validBody,
            portfolio: [
              { symbol: 'A', weight: 0 },
              { symbol: 'B', weight: 100 },
            ],
          },
        ],
        [
          'negative weight',
          {
            ...validBody,
            portfolio: [
              { symbol: 'A', weight: -10 },
              { symbol: 'B', weight: 110 },
            ],
          },
        ],
        ['weight above 100', { ...validBody, portfolio: [{ symbol: 'A', weight: 101 }] }],
        ['zero market price', { ...validBody, marketPrices: { AAPL: 0 } }],
        ['negative market price', { ...validBody, marketPrices: { AAPL: -1 } }],
        ['non-numeric market price', { ...validBody, marketPrices: { AAPL: 'x' } }],
        ['invalid timezone', { ...validBody, timezone: 'Mars/Base' }],
        ['unknown property', { ...validBody, hack: true }],
      ])('rejects %s', async (_name, body) => {
        const res = await bad(body);
        expect(res.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
        expect(res.body.details.length).toBeGreaterThan(0);
      });

      it('returns 400 for malformed JSON without leaking internals', async () => {
        const res = await http()
          .post('/api/v1/orders/split')
          .set('content-type', 'application/json')
          .send('{bad')
          .expect(400);
        expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
        expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at \w+/);
      });
    });

    describe('business rules (422)', () => {
      const unprocessable = (body: object, code: string) =>
        http()
          .post('/api/v1/orders/split')
          .send(body)
          .expect(422)
          .then((res) => expect(res.body).toMatchObject({ statusCode: 422, code }));

      it('rejects weights that do not total 100', () =>
        unprocessable(
          {
            ...validBody,
            portfolio: [
              { symbol: 'A', weight: 60 },
              { symbol: 'B', weight: 30 },
            ],
          },
          'INVALID_WEIGHT_TOTAL',
        ));
      it('rejects duplicate symbols (case-insensitive)', () =>
        unprocessable(
          {
            ...validBody,
            portfolio: [
              { symbol: 'A', weight: 50 },
              { symbol: 'a', weight: 50 },
            ],
          },
          'DUPLICATE_SYMBOL',
        ));
      it('rejects prices for symbols outside the portfolio', () =>
        unprocessable(
          { ...validBody, marketPrices: { MSFT: 10 } },
          'PRICE_SYMBOL_NOT_IN_PORTFOLIO',
        ));
    });

    it('uses the standard error shape including correlationId, timestamp and path', async () => {
      const res = await http()
        .post('/api/v1/orders/split')
        .set('x-correlation-id', 'test-corr-12345')
        .send({})
        .expect(400);
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_FAILED',
          correlationId: 'test-corr-12345',
          path: '/api/v1/orders/split',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('GET /api/v1/orders', () => {
    it('is empty before any order is created', async () => {
      const res = await http().get('/api/v1/orders').expect(200);
      expect(res.body).toEqual({ data: [], total: 0, limit: 50, offset: 0 });
    });

    it('returns created orders newest first, with pagination', async () => {
      const first = await http().post('/api/v1/orders/split').send(validBody).expect(201);
      const second = await http()
        .post('/api/v1/orders/split')
        .send({ ...validBody, type: 'SELL' })
        .expect(201);

      const all = await http().get('/api/v1/orders').expect(200);
      expect(all.body.total).toBe(2);
      expect(all.body.data.map((o: { id: string }) => o.id)).toEqual([
        second.body.id,
        first.body.id,
      ]);

      const page = await http().get('/api/v1/orders?limit=1&offset=1').expect(200);
      expect(page.body.data.map((o: { id: string }) => o.id)).toEqual([first.body.id]);
    });

    it.each(['limit=0', 'limit=1000', 'offset=-1', 'limit=abc'])(
      'rejects invalid query %s',
      async (q) => {
        await http().get(`/api/v1/orders?${q}`).expect(400);
      },
    );
  });

  describe('GET /api/v1/orders/:id', () => {
    it('returns a stored order', async () => {
      const created = await http().post('/api/v1/orders/split').send(validBody).expect(201);
      const res = await http().get(`/api/v1/orders/${created.body.id}`).expect(200);
      expect(res.body).toEqual(created.body);
    });

    it('returns 404 for an unknown id and 400 for a malformed id', async () => {
      const res = await http()
        .get('/api/v1/orders/3f2c9a54-8b1e-4a57-9c1e-0d6c5c2b9a11')
        .expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'ORDER_NOT_FOUND' });
      await http().get('/api/v1/orders/not-a-uuid').expect(400);
    });
  });

  describe('history is not persisted across restarts', () => {
    it('a freshly started application has empty history', async () => {
      await http().post('/api/v1/orders/split').send(validBody).expect(201);
      expect((await http().get('/api/v1/orders').expect(200)).body.total).toBe(1);
      await app.close();

      app = await createTestApp(); // "restart"
      expect((await http().get('/api/v1/orders').expect(200)).body.total).toBe(0);
    });
  });

  describe('observability', () => {
    it('writes one structured JSON access log with duration and correlationId, without query strings', async () => {
      const lines: string[] = [];
      await app.close();
      app = await createTestApp({
        env: { LOG_LEVEL: 'info' },
        logStream: { write: (l: string) => void lines.push(l) },
      });
      const res = await http().post('/api/v1/orders/split?secret=1').send(validBody).expect(201);

      const entry = lines.map((l) => JSON.parse(l)).find((e) => e.req?.method === 'POST');
      expect(entry).toMatchObject({
        req: { method: 'POST', url: '/api/v1/orders/split' },
        res: { statusCode: 201 },
        correlationId: res.headers['x-correlation-id'],
      });
      expect(typeof entry.responseTime).toBe('number');
      expect(lines.join('')).not.toContain('secret');
    });

    it('also logs failing requests', async () => {
      const lines: string[] = [];
      await app.close();
      app = await createTestApp({
        env: { LOG_LEVEL: 'info' },
        logStream: { write: (l: string) => void lines.push(l) },
      });
      await http().post('/api/v1/orders/split').send({}).expect(400);
      const entries = lines.map((l) => JSON.parse(l));
      expect(entries.some((e) => e.res?.statusCode === 400)).toBe(true);
    });

    it('replaces an unsafe inbound correlation id', async () => {
      const res = await http()
        .get('/api/v1/health')
        .set('x-correlation-id', 'bad id with spaces')
        .expect(200);
      expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
