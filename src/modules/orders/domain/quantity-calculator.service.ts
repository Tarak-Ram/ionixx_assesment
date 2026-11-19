import { Injectable } from '@nestjs/common';
import { Dec, ROUND_DOWN } from '../../../common/decimal';

export interface QuantityResult {
  quantity: Dec;
  /** quantity × price, rounded down to cents. */
  executableAmount: Dec;
}

/**
 * quantity = amount ÷ price, truncated (ROUND_DOWN) to `precision` decimal places.
 * Truncating means a BUY never spends more than the allocated amount and a SELL never
 * sells more value than requested; the sliver left over is reported, not hidden.
 */
@Injectable()
export class QuantityCalculatorService {
  calculate(amount: Dec, price: Dec, precision: number): QuantityResult {
    const quantity = amount.div(price).toDecimalPlaces(precision, ROUND_DOWN);
    const executableAmount = quantity.mul(price).toDecimalPlaces(2, ROUND_DOWN);
    return { quantity, executableAmount };
  }
}
