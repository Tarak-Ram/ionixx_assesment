import { Dec } from '../../common/decimal';

export const PRICING_PROVIDER = Symbol('PRICING_PROVIDER');

export type PriceSource = 'PARTNER' | 'DEFAULT';

export interface ResolvedPrice {
  price: Dec;
  source: PriceSource;
}

/**
 * Resolves the price used for each symbol. Independent of portfolio retrieval and of
 * quantity maths, so a live market-data feed can replace the default implementation
 * without touching either.
 */
export interface PricingProvider {
  resolvePrices(
    symbols: string[],
    partnerPrices?: Record<string, string | number>,
  ): Promise<Map<string, ResolvedPrice>>;
}
