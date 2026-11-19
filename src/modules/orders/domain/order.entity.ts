import { MarketSchedule } from '../../market-calendar/market-calendar.interface';
import { PriceSource } from '../../pricing/pricing-provider.interface';

export enum OrderType {
  BUY = 'BUY',
  SELL = 'SELL',
}

/** One line of the split. Monetary values and quantities are decimal strings (no float drift). */
export interface OrderAllocation {
  symbol: string;
  weightPercent: string;
  price: string;
  priceSource: PriceSource;
  /** totalAmount × weight, rounded to cents (remainder cents distributed deterministically). */
  allocatedAmount: string;
  /** allocatedAmount ÷ price, rounded DOWN to the configured share precision. */
  quantity: string;
  /** quantity × price (rounded down to cents) — what the order actually spends/raises. */
  executableAmount: string;
}

/**
 * A calculated order instruction. It is NOT a broker-confirmed trade: nothing is executed
 * by this service.
 */
export interface Order {
  id: string;
  partnerId: string;
  type: OrderType;
  currency: 'USD';
  totalAmount: string;
  allocations: OrderAllocation[];
  summary: {
    totalExecutableAmount: string;
    /** totalAmount − totalExecutableAmount: the sliver lost to share-quantity rounding. */
    unusedAmount: string;
  };
  rounding: { quantityPrecision: number; mode: 'ROUND_DOWN'; note: string };
  schedule: MarketSchedule;
  status: 'CALCULATED';
  createdAt: string;
  notice: string;
}
