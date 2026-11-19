import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Clock } from '../../../common/clock';
import { DomainValidationError } from '../../../common/errors/domain.errors';
import { fingerprint } from '../../../common/stable-hash';
import { Dec } from '../../../common/decimal';
import { APP_CONFIG, AppConfig } from '../../../config/app.config';
import { Principal } from '../../auth/auth-strategy.interface';
import {
  MARKET_CALENDAR,
  MarketCalendarProvider,
} from '../../market-calendar/market-calendar.interface';
import { PRICING_PROVIDER, PricingProvider } from '../../pricing/pricing-provider.interface';
import { AllocationService } from '../domain/allocation.service';
import { Order, OrderAllocation, OrderType } from '../domain/order.entity';
import {
  DuplicateIdempotencyKeyError,
  IdempotencyRecord,
  ORDER_REPOSITORY,
  OrderRepository,
} from '../domain/order.repository';
import { validatePortfolio } from '../domain/portfolio.validator';
import { QuantityCalculatorService } from '../domain/quantity-calculator.service';

export interface SplitOrderCommand {
  type: OrderType;
  totalAmount: string | number;
  portfolio: { symbol: string; weight: string | number }[];
  marketPrices?: Record<string, string | number>;
  timezone?: string;
}

const NOTICE =
  'Calculated order instruction only; no trade has been placed with a broker. ' +
  'Share quantities are rounded down, so the executable amount can be slightly below the requested total.';

/** Orchestrates validation, pricing, allocation, scheduling and persistence. */
@Injectable()
export class SplitOrderUseCase {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PRICING_PROVIDER) private readonly pricing: PricingProvider,
    @Inject(MARKET_CALENDAR) private readonly calendar: MarketCalendarProvider,
    @Inject(ORDER_REPOSITORY) private readonly repository: OrderRepository,
    private readonly allocationService: AllocationService,
    private readonly quantityCalculator: QuantityCalculatorService,
    private readonly clock: Clock,
  ) {}

  async execute(command: SplitOrderCommand, principal: Principal): Promise<Order> {
    return (await this.submit(command, principal)).order;
  }

  /**
   * Like `execute`, but safe to retry: with an idempotency key, a repeated submission returns the
   * originally stored order (`replayed: true`) instead of creating a duplicate.
   */
  async submit(
    command: SplitOrderCommand,
    principal: Principal,
    idempotencyKey?: string,
  ): Promise<{ order: Order; replayed: boolean }> {
    if (!idempotencyKey) {
      return { order: await this.calculateAndStore(command, principal), replayed: false };
    }

    const print = fingerprint(command);
    const existing = await this.replay(principal.partnerId, idempotencyKey, print);
    if (existing) return { order: existing, replayed: true };

    try {
      const order = await this.calculateAndStore(command, principal, {
        key: idempotencyKey,
        fingerprint: print,
      });
      return { order, replayed: false };
    } catch (err) {
      if (!(err instanceof DuplicateIdempotencyKeyError)) throw err;
      // Lost a race with a concurrent request carrying the same key: answer with the winner.
      const winner = await this.replay(principal.partnerId, idempotencyKey, print);
      if (winner) return { order: winner, replayed: true };
      throw err;
    }
  }

  private async replay(partnerId: string, key: string, print: string): Promise<Order | null> {
    const hit = await this.repository.findByIdempotencyKey(partnerId, key);
    if (!hit) return null;
    if (hit.fingerprint !== print) {
      throw new DomainValidationError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request body',
      );
    }
    return hit.order;
  }

  private async calculateAndStore(
    command: SplitOrderCommand,
    principal: Principal,
    idempotency?: IdempotencyRecord,
  ): Promise<Order> {
    const holdings = validatePortfolio(command.portfolio);
    const total = new Dec(command.totalAmount);
    const precision = this.config.sharePrecision;

    const prices = await this.pricing.resolvePrices(
      holdings.map((h) => h.symbol),
      command.marketPrices,
    );
    const now = this.clock.now();
    const schedule = this.calendar.getSchedule(now, command.timezone ?? this.config.marketTimezone);

    let executable = new Dec(0);
    const allocations: OrderAllocation[] = this.allocationService
      .allocate(total, holdings)
      .map(({ symbol, weight, amount }) => {
        const { price, source } = prices.get(symbol) as NonNullable<ReturnType<typeof prices.get>>;
        const { quantity, executableAmount } = this.quantityCalculator.calculate(
          amount,
          price,
          precision,
        );
        executable = executable.plus(executableAmount);
        return {
          symbol,
          weightPercent: weight.toFixed(),
          price: price.toFixed(),
          priceSource: source,
          allocatedAmount: amount.toFixed(2),
          quantity: quantity.toFixed(precision),
          executableAmount: executableAmount.toFixed(2),
        };
      });

    const order: Order = {
      id: randomUUID(),
      partnerId: principal.partnerId,
      type: command.type,
      currency: 'USD',
      totalAmount: total.toFixed(2),
      allocations,
      summary: {
        totalExecutableAmount: executable.toFixed(2),
        unusedAmount: total.minus(executable).toFixed(2),
      },
      rounding: {
        quantityPrecision: precision,
        mode: 'ROUND_DOWN',
        note: `Quantities are truncated to ${precision} decimal places.`,
      },
      schedule,
      status: 'CALCULATED',
      createdAt: now.toISOString(),
      notice: NOTICE,
    };

    return this.repository.save(order, idempotency);
  }
}
