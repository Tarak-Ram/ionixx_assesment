import { Inject, Injectable } from '@nestjs/common';
import { Dec } from '../../common/decimal';
import { DomainValidationError } from '../../common/errors/domain.errors';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { PricingProvider, ResolvedPrice } from './pricing-provider.interface';

/**
 * Challenge pricing rule: every stock costs the configured default ($100) unless the
 * partner supplies a market price, which always takes priority.
 */
@Injectable()
export class DefaultPricingProvider implements PricingProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async resolvePrices(
    symbols: string[],
    partnerPrices: Record<string, string | number> = {},
  ): Promise<Map<string, ResolvedPrice>> {
    const overrides = new Map(
      Object.entries(partnerPrices).map(([symbol, price]) => [symbol.toUpperCase(), price]),
    );

    const unknown = [...overrides.keys()].filter((s) => !symbols.includes(s));
    if (unknown.length > 0) {
      throw new DomainValidationError(
        'PRICE_SYMBOL_NOT_IN_PORTFOLIO',
        `marketPrices contains symbols that are not in the portfolio: ${unknown.join(', ')}`,
        { symbols: unknown },
      );
    }

    const resolved = new Map<string, ResolvedPrice>();
    for (const symbol of symbols) {
      const supplied = overrides.get(symbol);
      if (supplied === undefined) {
        resolved.set(symbol, { price: new Dec(this.config.defaultPrice), source: 'DEFAULT' });
        continue;
      }
      const price = this.parsePositive(symbol, supplied);
      resolved.set(symbol, { price, source: 'PARTNER' });
    }
    return resolved;
  }

  private parsePositive(symbol: string, raw: string | number): Dec {
    try {
      const price = new Dec(raw);
      if (price.isFinite() && price.gt(0)) return price;
    } catch {
      /* fall through */
    }
    throw new DomainValidationError(
      'INVALID_PRICE',
      `Price for ${symbol} must be a number greater than 0`,
      { symbol },
    );
  }
}
