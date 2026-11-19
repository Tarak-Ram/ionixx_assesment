import { DomainValidationError } from '../../src/common/errors/domain.errors';
import { loadConfig } from '../../src/config/app.config';
import { WeekdayCalendarProvider } from '../../src/modules/market-calendar/weekday-calendar.provider';
import { DefaultPricingProvider } from '../../src/modules/pricing/default-pricing.provider';
import { InMemoryOrderRepository } from '../../src/modules/orders/infrastructure/in-memory-order.repository';
import { Order, OrderType } from '../../src/modules/orders/domain/order.entity';

describe('DefaultPricingProvider', () => {
  const provider = new DefaultPricingProvider(loadConfig({}));

  it('uses the default $100 price', async () => {
    const prices = await provider.resolvePrices(['AAPL']);
    expect(prices.get('AAPL')?.price.toFixed()).toBe('100');
    expect(prices.get('AAPL')?.source).toBe('DEFAULT');
  });

  it('gives partner prices priority over the default', async () => {
    const prices = await provider.resolvePrices(['AAPL', 'TSLA'], { aapl: 187.5 });
    expect(prices.get('AAPL')).toMatchObject({ source: 'PARTNER' });
    expect(prices.get('AAPL')?.price.toFixed()).toBe('187.5');
    expect(prices.get('TSLA')?.source).toBe('DEFAULT');
  });

  it.each([0, -5, 'abc', '', NaN])('rejects invalid price %p', async (bad) => {
    await expect(provider.resolvePrices(['AAPL'], { AAPL: bad as number })).rejects.toMatchObject({
      code: 'INVALID_PRICE',
    });
  });

  it('rejects prices for symbols that are not in the portfolio', async () => {
    await expect(provider.resolvePrices(['AAPL'], { MSFT: 10 })).rejects.toMatchObject({
      code: 'PRICE_SYMBOL_NOT_IN_PORTFOLIO',
    });
  });

  it('respects a configured default price', async () => {
    const custom = new DefaultPricingProvider(loadConfig({ DEFAULT_PRICE: '250.5' }));
    expect((await custom.resolvePrices(['X'])).get('X')?.price.toFixed()).toBe('250.5');
  });
});

describe('WeekdayCalendarProvider', () => {
  const calendar = new WeekdayCalendarProvider();
  // 2026-11-16 is a Monday.
  const at = (iso: string, tz = 'UTC') => calendar.getSchedule(new Date(iso), tz);

  it.each([
    ['Monday', '2026-11-16T10:00:00Z', '2026-11-16', 'SAME_DAY'],
    ['Wednesday', '2026-11-18T10:00:00Z', '2026-11-18', 'SAME_DAY'],
    ['Friday', '2026-11-20T23:59:00Z', '2026-11-20', 'SAME_DAY'],
    ['Saturday', '2026-11-21T10:00:00Z', '2026-11-23', 'NEXT_MARKET_DAY'],
    ['Sunday', '2026-11-22T10:00:00Z', '2026-11-23', 'NEXT_MARKET_DAY'],
  ])('%s', (_day, instant, executionDate, status) => {
    expect(at(instant)).toMatchObject({ executionDate, status, timezone: 'UTC' });
  });

  it('evaluates the weekday in the requested timezone (Friday night in New York)', () => {
    // Saturday 03:00 UTC is still Friday 22:00 in New York.
    expect(at('2026-11-21T03:00:00Z', 'America/New_York')).toMatchObject({
      executionDate: '2026-11-20',
      status: 'SAME_DAY',
    });
  });

  it('rolls forward when the local date is already the weekend (Tokyo)', () => {
    // Friday 20:00 UTC is Saturday 05:00 in Tokyo.
    expect(at('2026-11-20T20:00:00Z', 'Asia/Tokyo')).toMatchObject({
      executionDate: '2026-11-23',
      status: 'NEXT_MARKET_DAY',
    });
  });

  it('rolls across a month boundary', () => {
    // Saturday 2026-01-31 → Monday 2026-02-02.
    expect(at('2026-01-31T12:00:00Z').executionDate).toBe('2026-02-02');
  });

  it('creates one formatter per timezone and reuses it', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    const fresh = new WeekdayCalendarProvider();
    fresh.getSchedule(new Date('2026-11-16T10:00:00Z'), 'Europe/Paris');
    fresh.getSchedule(new Date('2026-11-17T10:00:00Z'), 'Europe/Paris');
    fresh.getSchedule(new Date('2026-11-17T10:00:00Z'), 'Asia/Tokyo');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('rejects an unknown timezone', () => {
    expect(() => at('2026-11-16T10:00:00Z', 'Mars/Olympus')).toThrow(DomainValidationError);
  });
});

describe('InMemoryOrderRepository', () => {
  const make = (id: string, partnerId = 'p1'): Order => ({
    id,
    partnerId,
    type: OrderType.BUY,
    currency: 'USD',
    totalAmount: '100.00',
    allocations: [],
    summary: { totalExecutableAmount: '100.00', unusedAmount: '0.00' },
    rounding: { quantityPrecision: 3, mode: 'ROUND_DOWN', note: '' },
    schedule: { executionDate: '2026-11-16', status: 'SAME_DAY', timezone: 'UTC', requestedAt: '' },
    status: 'CALCULATED',
    createdAt: '',
    notice: '',
  });

  it('starts empty', async () => {
    expect(
      await new InMemoryOrderRepository({ maxStoredOrders: 1000 }).findAll('p1', {
        limit: 10,
        offset: 0,
      }),
    ).toEqual({
      items: [],
      total: 0,
    });
  });

  it('stores and retrieves orders, newest first', async () => {
    const repo = new InMemoryOrderRepository({ maxStoredOrders: 1000 });
    await repo.save(make('a'));
    await repo.save(make('b'));
    const page = await repo.findAll('p1', { limit: 10, offset: 0 });
    expect(page.items.map((o) => o.id)).toEqual(['b', 'a']);
    expect((await repo.findById('a', 'p1'))?.id).toBe('a');
  });

  it('paginates', async () => {
    const repo = new InMemoryOrderRepository({ maxStoredOrders: 1000 });
    for (const id of ['a', 'b', 'c']) await repo.save(make(id));
    const page = await repo.findAll('p1', { limit: 1, offset: 1 });
    expect(page.items.map((o) => o.id)).toEqual(['b']);
    expect(page.total).toBe(3);
  });

  it("isolates partners: another partner's order looks missing", async () => {
    const repo = new InMemoryOrderRepository({ maxStoredOrders: 1000 });
    await repo.save(make('a', 'p1'));
    expect(await repo.findById('a', 'p2')).toBeNull();
    expect((await repo.findAll('p2', { limit: 10, offset: 0 })).total).toBe(0);
  });

  it('does not let callers mutate stored data', async () => {
    const repo = new InMemoryOrderRepository({ maxStoredOrders: 1000 });
    await repo.save(make('a'));
    const fetched = await repo.findById('a', 'p1');
    (fetched as Order).totalAmount = '999.00';
    expect((await repo.findById('a', 'p1'))?.totalAmount).toBe('100.00');
  });

  it('evicts the oldest order once the memory cap is exceeded', async () => {
    const repo = new InMemoryOrderRepository({ maxStoredOrders: 2 });
    for (const id of ['a', 'b', 'c']) await repo.save(make(id));
    expect(await repo.findById('a', 'p1')).toBeNull();
    const page = await repo.findAll('p1', { limit: 10, offset: 0 });
    expect(page.items.map((o) => o.id)).toEqual(['c', 'b']);
  });

  it('a new instance (application restart) has no history', async () => {
    const first = new InMemoryOrderRepository({ maxStoredOrders: 1000 });
    await first.save(make('a'));
    expect(
      await new InMemoryOrderRepository({ maxStoredOrders: 1000 }).findById('a', 'p1'),
    ).toBeNull();
  });
});

describe('loadConfig', () => {
  it('has sensible defaults', () => {
    expect(loadConfig({})).toMatchObject({
      port: 3000,
      sharePrecision: 3,
      defaultPrice: '100',
      marketTimezone: 'UTC',
      auth: { mode: 'none' },
    });
  });

  it('allows precision 7', () => {
    expect(loadConfig({ SHARE_PRECISION: '7' }).sharePrecision).toBe(7);
  });

  it.each([
    [{ SHARE_PRECISION: '-1' }, 'SHARE_PRECISION'],
    [{ SHARE_PRECISION: '3.5' }, 'SHARE_PRECISION'],
    [{ SHARE_PRECISION: '11' }, 'SHARE_PRECISION'],
    [{ MAX_STORED_ORDERS: '0' }, 'MAX_STORED_ORDERS'],
    [{ DEFAULT_PRICE: '0' }, 'DEFAULT_PRICE'],
    [{ DEFAULT_PRICE: 'abc' }, 'DEFAULT_PRICE'],
    [{ MARKET_TIMEZONE: 'Nowhere/City' }, 'MARKET_TIMEZONE'],
    [{ AUTH_MODE: 'basic' }, 'AUTH_MODE'],
    [{ AUTH_MODE: 'api-key' }, 'API_KEYS'],
    [{ AUTH_MODE: 'jwt', JWT_SECRET: 'short' }, 'JWT_SECRET'],
  ])('fails fast on invalid config %j', (env, mention) => {
    expect(() => loadConfig(env)).toThrow(mention);
  });

  it('parses API keys', () => {
    expect(loadConfig({ AUTH_MODE: 'api-key', API_KEYS: 'k1:a, k2:b' }).auth.apiKeys).toEqual({
      k1: 'a',
      k2: 'b',
    });
  });
});
