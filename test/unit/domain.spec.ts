import { Dec } from '../../src/common/decimal';
import { DomainValidationError } from '../../src/common/errors/domain.errors';
import { AllocationService } from '../../src/modules/orders/domain/allocation.service';
import { validatePortfolio } from '../../src/modules/orders/domain/portfolio.validator';
import { QuantityCalculatorService } from '../../src/modules/orders/domain/quantity-calculator.service';

describe('validatePortfolio', () => {
  it('accepts a valid portfolio and normalises symbols to upper case', () => {
    const result = validatePortfolio([
      { symbol: 'aapl', weight: 60 },
      { symbol: 'TSLA', weight: '40' },
    ]);
    expect(result.map((h) => h.symbol)).toEqual(['AAPL', 'TSLA']);
    expect(result[1].weight.toFixed()).toBe('40');
  });

  it('sums decimal weights exactly (no floating-point error)', () => {
    expect(() =>
      validatePortfolio([
        { symbol: 'A', weight: 0.1 },
        { symbol: 'B', weight: 0.2 },
        { symbol: 'C', weight: 99.7 },
      ]),
    ).not.toThrow();
  });

  it.each([
    [
      [
        { symbol: 'A', weight: 60 },
        { symbol: 'B', weight: 30 },
      ],
      'INVALID_WEIGHT_TOTAL',
    ],
    [
      [
        { symbol: 'A', weight: 60 },
        { symbol: 'B', weight: 50 },
      ],
      'INVALID_WEIGHT_TOTAL',
    ],
    [
      [
        { symbol: 'A', weight: 50 },
        { symbol: 'a', weight: 50 },
      ],
      'DUPLICATE_SYMBOL',
    ],
    [[], 'EMPTY_PORTFOLIO'],
  ])('rejects invalid portfolio %#', (items, code) => {
    try {
      validatePortfolio(items);
      throw new Error('expected validatePortfolio to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainValidationError);
      expect((e as DomainValidationError).code).toBe(code);
    }
  });
});

describe('AllocationService', () => {
  const service = new AllocationService();
  const holding = (symbol: string, weight: number) => ({ symbol, weight: new Dec(weight) });

  it('allocates the challenge example: 100 → 60 / 40', () => {
    const result = service.allocate(new Dec(100), [holding('AAPL', 60), holding('TSLA', 40)]);
    expect(result.map((r) => r.amount.toFixed(2))).toEqual(['60.00', '40.00']);
  });

  it('always sums to the total by distributing leftover cents deterministically', () => {
    const result = service.allocate(new Dec(100), [
      holding('A', 33.33),
      holding('B', 33.33),
      holding('C', 33.34),
    ]);
    const amounts = result.map((r) => r.amount.toFixed(2));
    expect(amounts).toEqual(['33.33', '33.33', '33.34']);

    const thirds = service.allocate(new Dec(100), [
      holding('A', 33.3333),
      holding('B', 33.3333),
      holding('C', 33.3334),
    ]);
    const sum = thirds.reduce((s, r) => s.plus(r.amount), new Dec(0));
    expect(sum.toFixed(2)).toBe('100.00');
  });

  it('handles a total smaller than one cent per holding', () => {
    const result = service.allocate(new Dec('0.01'), [holding('A', 50), holding('B', 50)]);
    expect(result.map((r) => r.amount.toFixed(2))).toEqual(['0.01', '0.00']);
  });

  it('is deterministic for identical input', () => {
    const run = () =>
      service
        .allocate(new Dec('10.01'), [
          holding('A', 33.3333),
          holding('B', 33.3333),
          holding('C', 33.3334),
        ])
        .map((r) => r.amount.toFixed(2));
    expect(run()).toEqual(run());
  });
});

describe('QuantityCalculatorService', () => {
  const calc = new QuantityCalculatorService();

  it('computes quantity = amount / price at 3 decimals', () => {
    const r = calc.calculate(new Dec(60), new Dec(100), 3);
    expect(r.quantity.toFixed(3)).toBe('0.600');
    expect(r.executableAmount.toFixed(2)).toBe('60.00');
  });

  it('truncates (never rounds up) to the configured precision', () => {
    expect(calc.calculate(new Dec(100), new Dec(3), 3).quantity.toFixed(3)).toBe('33.333');
    expect(calc.calculate(new Dec('0.0999'), new Dec(1), 3).quantity.toFixed(3)).toBe('0.099');
  });

  it('honours a precision of 7 and of 0', () => {
    expect(calc.calculate(new Dec(1), new Dec(3), 7).quantity.toFixed(7)).toBe('0.3333333');
    expect(calc.calculate(new Dec(250), new Dec(100), 0).quantity.toFixed(0)).toBe('2');
  });

  it('returns zero shares for a tiny amount rather than rounding up', () => {
    const r = calc.calculate(new Dec('0.01'), new Dec(100), 3);
    expect(r.quantity.toFixed(3)).toBe('0.000');
    expect(r.executableAmount.toFixed(2)).toBe('0.00');
  });

  it('uses a partner market price', () => {
    expect(calc.calculate(new Dec(60), new Dec('187.5'), 3).quantity.toFixed(3)).toBe('0.320');
  });
});
