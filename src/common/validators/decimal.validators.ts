import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';
import { isValidTimeZone } from '../../config/app.config';

export const SYMBOL_PATTERN = /^[A-Za-z][A-Za-z.-]{0,9}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/** Accepts a JSON number or numeric string; returns the canonical string or null. */
export function toDecimalString(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const s = String(value);
    // Very large/small numbers serialise with exponents; reject rather than guess.
    return DECIMAL.test(s) ? s : null;
  }
  if (typeof value === 'string' && DECIMAL.test(value.trim())) return value.trim();
  return null;
}

function decimalPlaces(s: string): number {
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

export interface PositiveDecimalOptions {
  maxDecimals: number;
  max?: number;
}

/**
 * Money-safe numeric validation: positive, finite, no exponent notation,
 * bounded decimal places and optional upper bound.
 */
export function IsPositiveDecimal(opts: PositiveDecimalOptions, validation?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isPositiveDecimal',
      target: target.constructor,
      propertyName,
      options: validation,
      validator: {
        validate(value: unknown) {
          const s = toDecimalString(value);
          if (s === null) return false;
          const n = Number(s);
          return (
            n > 0 &&
            decimalPlaces(s) <= opts.maxDecimals &&
            (opts.max === undefined || n <= opts.max)
          );
        },
        defaultMessage(args: ValidationArguments) {
          const upper = opts.max !== undefined ? ` and at most ${opts.max}` : '';
          return `${args.property} must be a number greater than 0${upper} with at most ${opts.maxDecimals} decimal places`;
        },
      },
    });
}

/** Validates a { SYMBOL: price } map: symbol format + positive price (max 6 dp). */
export function IsPriceMap(validation?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isPriceMap',
      target: target.constructor,
      propertyName,
      options: validation,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.entries(value).every(([symbol, price]) => {
            const s = toDecimalString(price);
            return (
              SYMBOL_PATTERN.test(symbol) && s !== null && Number(s) > 0 && decimalPlaces(s) <= 6
            );
          });
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must map valid stock symbols to prices greater than 0 (max 6 decimal places)`;
        },
      },
    });
}

export function IsIanaTimeZone(validation?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimeZone',
      target: target.constructor,
      propertyName,
      options: validation,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidTimeZone(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a valid IANA timezone, e.g. America/New_York`,
      },
    });
}
