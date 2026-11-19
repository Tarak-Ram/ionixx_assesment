import { Dec } from '../../../common/decimal';
import { DomainValidationError } from '../../../common/errors/domain.errors';

export interface RawHolding {
  symbol: string;
  weight: string | number;
}

export interface Holding {
  symbol: string;
  /** Percentage, e.g. 60 means 60%. */
  weight: Dec;
}

const HUNDRED = new Dec(100);

/**
 * Business rules for a model portfolio (shape/format is already checked by the DTO):
 *  - symbols are case-insensitive and must be unique,
 *  - weights are percentages that must add up to exactly 100 (decimal comparison, no tolerance).
 */
export function validatePortfolio(items: RawHolding[]): Holding[] {
  if (items.length === 0) {
    throw new DomainValidationError('EMPTY_PORTFOLIO', 'Portfolio must contain at least one stock');
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const holdings = items.map((item) => {
    const symbol = item.symbol.trim().toUpperCase();
    if (seen.has(symbol)) duplicates.add(symbol);
    seen.add(symbol);
    return { symbol, weight: new Dec(item.weight) };
  });

  if (duplicates.size > 0) {
    throw new DomainValidationError(
      'DUPLICATE_SYMBOL',
      `Portfolio contains duplicate symbols: ${[...duplicates].join(', ')}`,
      { symbols: [...duplicates] },
    );
  }

  const total = holdings.reduce((sum, h) => sum.plus(h.weight), new Dec(0));
  if (!total.eq(HUNDRED)) {
    throw new DomainValidationError(
      'INVALID_WEIGHT_TOTAL',
      `Portfolio weights must add up to 100 (received ${total.toFixed()})`,
      { total: total.toFixed() },
    );
  }

  return holdings;
}
