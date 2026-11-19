import { Injectable } from '@nestjs/common';
import { Dec, ROUND_DOWN } from '../../../common/decimal';
import { Holding } from './portfolio.validator';

export interface Allocation {
  symbol: string;
  weight: Dec;
  amount: Dec;
}

const CENT = new Dec('0.01');

/**
 * Splits a total amount across holdings: amount = total × weight / 100.
 *
 * Each share is first rounded DOWN to cents; the cents left over are then handed out one at a
 * time to the holdings with the largest discarded remainder (largest-remainder method, ties
 * broken by higher weight then input order). This guarantees the allocations sum to exactly
 * the total and the result is deterministic.
 */
@Injectable()
export class AllocationService {
  allocate(total: Dec, holdings: Holding[]): Allocation[] {
    const rows = holdings.map((holding, index) => {
      const exact = total.mul(holding.weight).div(100);
      const floored = exact.toDecimalPlaces(2, ROUND_DOWN);
      return { holding, index, amount: floored, remainder: exact.minus(floored) };
    });

    const allocated = rows.reduce((sum, r) => sum.plus(r.amount), new Dec(0));
    const leftoverCents = total.minus(allocated).div(CENT).toNumber();

    const byPriority = [...rows].sort(
      (a, b) =>
        b.remainder.cmp(a.remainder) || b.holding.weight.cmp(a.holding.weight) || a.index - b.index,
    );
    for (let i = 0; i < leftoverCents; i++) {
      const row = byPriority[i % byPriority.length];
      row.amount = row.amount.plus(CENT);
    }

    return rows.map((r) => ({
      symbol: r.holding.symbol,
      weight: r.holding.weight,
      amount: r.amount,
    }));
  }
}
