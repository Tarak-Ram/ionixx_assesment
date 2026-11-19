import { loadConfig } from '../../src/config/app.config';
import { describeDatabase } from '../../src/config/database.config';
import { Order, OrderType } from '../../src/modules/orders/domain/order.entity';
import { PostgresOrderRepository } from '../../src/modules/orders/infrastructure/postgres/postgres-order.repository';

const URL = 'postgresql://orders_app:s3cret@db.internal:5432/orders';

describe('database configuration', () => {
  it('defaults to in-memory storage with no database settings', () => {
    const config = loadConfig({});
    expect(config.storage).toBe('memory');
    expect(config.ordersDb).toBeUndefined();
  });

  it('ignores ORDERS_DB_* variables in memory mode', () => {
    expect(loadConfig({ ORDERS_DB_URL: 'garbage' }).ordersDb).toBeUndefined();
  });

  it('reads the Postgres settings with sensible defaults', () => {
    expect(loadConfig({ STORAGE: 'postgres', ORDERS_DB_URL: URL }).ordersDb).toEqual({
      url: URL,
      poolMax: 10,
      connectTimeoutMs: 3000,
      queryTimeoutMs: 5000,
      ssl: false,
      sslCa: undefined,
      connectRetries: 5,
      connectRetryDelayMs: 500,
      autoCreateSchema: false,
    });
  });

  it('parses overrides', () => {
    const { ordersDb } = loadConfig({
      STORAGE: 'postgres',
      ORDERS_DB_URL: URL,
      ORDERS_DB_POOL_MAX: '25',
      ORDERS_DB_SSL: 'TRUE',
      ORDERS_DB_AUTO_SCHEMA: 'true',
    });
    expect(ordersDb).toMatchObject({ poolMax: 25, ssl: true, autoCreateSchema: true });
  });

  it.each([
    [{ STORAGE: 'mysql' }, 'STORAGE'],
    [{ STORAGE: 'postgres' }, 'ORDERS_DB_URL'],
    [{ STORAGE: 'postgres', ORDERS_DB_URL: 'mysql://x/y' }, 'ORDERS_DB_URL'],
    [{ STORAGE: 'postgres', ORDERS_DB_URL: URL, ORDERS_DB_POOL_MAX: '0' }, 'ORDERS_DB_POOL_MAX'],
    [{ STORAGE: 'postgres', ORDERS_DB_URL: URL, ORDERS_DB_SSL: 'yes' }, 'ORDERS_DB_SSL'],
  ])('fails fast on invalid config %j', (env, mention) => {
    expect(() => loadConfig(env)).toThrow(mention);
  });

  it('never reveals the password when describing the database', () => {
    expect(describeDatabase(URL)).toBe('db.internal:5432/orders');
    expect(describeDatabase(URL)).not.toContain('s3cret');
    expect(describeDatabase('not a url')).toBe('unknown');
  });

  it('does not leak the URL (password) in the validation error', () => {
    expect(() =>
      loadConfig({ STORAGE: 'postgres', ORDERS_DB_URL: 'mysql://u:topsecret@h/d' }),
    ).not.toThrow(/topsecret/);
  });
});

describe('PostgresOrderRepository (SQL contract, db mocked)', () => {
  const order = {
    id: 'o1',
    partnerId: 'p1',
    type: OrderType.BUY,
    createdAt: '2026-11-16T10:00:00.000Z',
  } as Order;

  it('inserts with bound parameters, never string-concatenated values', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new PostgresOrderRepository({ query }).save(order);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('$1');
    expect(sql).not.toContain('o1');
    expect(params).toEqual(['o1', 'p1', 'BUY', JSON.stringify(order), order.createdAt, null, null]);
  });

  it('always filters reads by partner_id', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = new PostgresOrderRepository({ query });
    await repo.findById('o1', 'p2');
    await repo.findAll('p2', { limit: 5, offset: 10 });
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('partner_id = $');
      expect(params).toContain('p2');
    }
    expect(query.mock.calls[1][1]).toEqual(['p2', 5, 10]);
  });

  it('maps rows back to orders and returns null when missing', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ payload: order }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ payload: order }])
      .mockResolvedValueOnce([{ total: '7' }]);
    const repo = new PostgresOrderRepository({ query });
    expect(await repo.findById('o1', 'p1')).toBe(order);
    expect(await repo.findById('nope', 'p1')).toBeNull();
    expect(await repo.findAll('p1', { limit: 1, offset: 0 })).toEqual({ items: [order], total: 7 });
  });
});
