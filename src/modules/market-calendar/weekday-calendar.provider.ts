import { Injectable } from '@nestjs/common';
import { DomainValidationError } from '../../common/errors/domain.errors';
import { MarketCalendarProvider, MarketSchedule } from './market-calendar.interface';

/**
 * Challenge rule: markets are open Monday through Friday.
 * The weekday is evaluated in the supplied IANA timezone. Trading hours, exchange
 * holidays and half-days are intentionally NOT modelled (not specified by the challenge).
 */
@Injectable()
export class WeekdayCalendarProvider implements MarketCalendarProvider {
  /**
   * Building an Intl.DateTimeFormat is far more expensive than using one, so each timezone's
   * formatter is created once. Only valid timezones are cached (invalid ones throw), so the
   * map is bounded by the number of IANA zones.
   */
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();

  getSchedule(now: Date, timeZone: string): MarketSchedule {
    const { year, month, day } = this.localDate(now, timeZone);
    const local = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = local.getUTCDay(); // 0 = Sunday ... 6 = Saturday

    let offsetDays = 0;
    if (dayOfWeek === 6) offsetDays = 2;
    if (dayOfWeek === 0) offsetDays = 1;
    local.setUTCDate(local.getUTCDate() + offsetDays);

    return {
      executionDate: local.toISOString().slice(0, 10),
      status: offsetDays === 0 ? 'SAME_DAY' : 'NEXT_MARKET_DAY',
      timezone: timeZone,
      requestedAt: now.toISOString(),
    };
  }

  private localDate(now: Date, timeZone: string): { year: number; month: number; day: number } {
    try {
      const parts = this.formatterFor(timeZone).formatToParts(now);
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return { year: get('year'), month: get('month'), day: get('day') };
    } catch {
      throw new DomainValidationError('INVALID_TIMEZONE', `Unknown timezone "${timeZone}"`);
    }
  }

  private formatterFor(timeZone: string): Intl.DateTimeFormat {
    let formatter = this.formatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      this.formatters.set(timeZone, formatter);
    }
    return formatter;
  }
}
