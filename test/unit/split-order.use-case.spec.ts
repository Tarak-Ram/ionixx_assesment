import { Clock } from '../../src/common/clock';
import { Dec } from '../../src/common/decimal';
import { OrderNotFoundError } from '../../src/common/errors/domain.errors';
import { loadConfig } from '../../src/config/app.config';
import { MarketCalendarProvider } from '../../src/modules/market-calendar/market-calendar.interface';
import { GetOrderHistoryUseCase } from '../../src/modules/orders/application/get-order-history.use-case';
import { SplitOrderUseCase } from '../../src/modules/orders/application/split-order.use-case';
import { AllocationService } from '../../src/modules/orders/domain/allocation.service';
import { OrderType } from '../../src/modules/orders/domain/order.entity';
import { OrderRepository } from '../../src/modules/orders/domain/order.repository';
import { QuantityCalculatorService } from '../../src/modules/orders/domain/quantity-calculator.service';
import { PricingProvider } from '../../src/modules/pricing/pricing-provider.interface';

describe('SplitOrderUseCase (providers mocked)', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  const schedule = {
    executionDate: '2026-11-16',
    status: 'SAME_DAY' as const,
    timezone: 'UTC',
    requestedAt: now.toISOString(),
  };

  const build = (env: Record<string, string> = {}, priceFor = (_s: string) => '100') => {
    const pricing: jest.Mocked<PricingProvider> = {
      resolvePrices: jest.fn(
        async (symbols: string[]) =>
          new Map(
            symbols.map((s) => [s, { price: new Dec(priceFor(s)), source: 'DEFAULT' as const }]),
          ),
      ),
    };
    const calendar: jest.Mocked<MarketCalendarProvider> = {
      getSchedule: jest.fn((_now: Date, _tz: string) => schedule),
    };
    const repository: jest.Mocked<OrderRepository> = {
      save: jest.fn(async (o) => o),
      findById: jest.fn(),
      findAll: jest.fn(),
      findByIdempotencyKey: jest.fn(),
    };
    const clock = { now: () => now } as Clock;
    const useCase = new SplitOrderUseCase(
      loadConfig(env),
      pricing,
      calendar,
      repository,
      new AllocationService(),
      new QuantityCalculatorService(),
      clock,
    );
    return { useCase, pricing, calendar, repository };
  };

  const command = {
    type: OrderType.BUY,
    totalAmount: 100,
    portfolio: [
      { symbol: 'aapl', weight: 60 },
      { symbol: 'tsla', weight: 40 },
    ],
  };

  it('produces the challenge example and persists it', async () => {
    const { useCase, repository, pricing, calendar } = build();
    const order = await useCase.execute(command, { partnerId: 'p1' });

    expect(order.allocations).toEqual([
      expect.objectContaining({
        symbol: 'AAPL',
        allocatedAmount: '60.00',
        quantity: '0.600',
        price: '100',
      }),
      expect.objectContaining({ symbol: 'TSLA', allocatedAmount: '40.00', quantity: '0.400' }),
    ]);
    expect(order).toMatchObject({
      partnerId: 'p1',
      status: 'CALCULATED',
      schedule,
      createdAt: now.toISOString(),
    });
    expect(order.summary).toEqual({ totalExecutableAmount: '100.00', unusedAmount: '0.00' });
    expect(pricing.resolvePrices).toHaveBeenCalledWith(['AAPL', 'TSLA'], undefined);
    expect(calendar.getSchedule).toHaveBeenCalledWith(now, 'UTC');
    expect(repository.save).toHaveBeenCalledWith(order, undefined);
  });

  it('handles SELL identically and passes partner prices + timezone through', async () => {
    const { useCase, pricing, calendar } = build({}, (s) => (s === 'AAPL' ? '200' : '100'));
    const order = await useCase.execute(
      { ...command, type: OrderType.SELL, marketPrices: { AAPL: 200 }, timezone: 'Asia/Tokyo' },
      { partnerId: 'p1' },
    );
    expect(order.type).toBe('SELL');
    expect(order.allocations[0]).toMatchObject({ quantity: '0.300', price: '200' });
    expect(pricing.resolvePrices).toHaveBeenCalledWith(['AAPL', 'TSLA'], { AAPL: 200 });
    expect(calendar.getSchedule).toHaveBeenCalledWith(now, 'Asia/Tokyo');
  });

  it('reports the rounding gap when quantities are truncated', async () => {
    const { useCase } = build();
    const order = await useCase.execute(
      {
        type: OrderType.BUY,
        totalAmount: 100,
        portfolio: [
          { symbol: 'A', weight: 33.33 },
          { symbol: 'B', weight: 33.33 },
          { symbol: 'C', weight: 33.34 },
        ],
      },
      { partnerId: 'p1' },
    );
    expect(order.allocations.map((a) => a.quantity)).toEqual(['0.333', '0.333', '0.333']);
    expect(order.summary).toEqual({ totalExecutableAmount: '99.90', unusedAmount: '0.10' });
  });

  it('honours SHARE_PRECISION=7', async () => {
    const { useCase } = build({ SHARE_PRECISION: '7' });
    const order = await useCase.execute(command, { partnerId: 'p1' });
    expect(order.allocations[0].quantity).toBe('0.6000000');
    expect(order.rounding.quantityPrecision).toBe(7);
  });

  it('does not touch pricing, calendar or storage when the portfolio is invalid', async () => {
    const { useCase, pricing, calendar, repository } = build();
    await expect(
      useCase.execute(
        { ...command, portfolio: [{ symbol: 'A', weight: 10 }] },
        { partnerId: 'p1' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_WEIGHT_TOTAL' });
    expect(pricing.resolvePrices).not.toHaveBeenCalled();
    expect(calendar.getSchedule).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe('GetOrderHistoryUseCase', () => {
  it('lists through the repository scoped to the partner', async () => {
    const repository = {
      findAll: jest.fn(async () => ({ items: [], total: 0 })),
    } as unknown as OrderRepository;
    const result = await new GetOrderHistoryUseCase(repository).list(
      { partnerId: 'p1' },
      { limit: 5, offset: 0 },
    );
    expect(result.total).toBe(0);
    expect(repository.findAll).toHaveBeenCalledWith('p1', { limit: 5, offset: 0 });
  });

  it('throws OrderNotFoundError for a missing order', async () => {
    const repository = { findById: jest.fn(async () => null) } as unknown as OrderRepository;
    await expect(
      new GetOrderHistoryUseCase(repository).getById('x', { partnerId: 'p1' }),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});
