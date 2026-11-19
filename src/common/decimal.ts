import Decimal from 'decimal.js';

/**
 * Isolated Decimal constructor so financial maths never depends on (or leaks into)
 * the global Decimal configuration. 40 significant digits is far beyond any realistic
 * order size; rounding is always chosen explicitly at the call site.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_DOWN });
export type Dec = InstanceType<typeof Dec>;
export const ROUND_DOWN = Decimal.ROUND_DOWN;
export const ROUND_HALF_UP = Decimal.ROUND_HALF_UP;
