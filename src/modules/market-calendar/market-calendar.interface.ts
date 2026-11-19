export const MARKET_CALENDAR = Symbol('MARKET_CALENDAR');

/**
 * SAME_DAY         – request date is a market day, orders are for that date.
 * NEXT_MARKET_DAY  – request date is not a market day, orders roll to the next one.
 */
export type ScheduleStatus = 'SAME_DAY' | 'NEXT_MARKET_DAY';

export interface MarketSchedule {
  /** Calendar date (YYYY-MM-DD, in `timezone`) on which the orders should be executed. */
  executionDate: string;
  status: ScheduleStatus;
  timezone: string;
  /** The instant the schedule was computed for (ISO-8601 UTC). */
  requestedAt: string;
}

/** Decides when orders can execute. Swap for an exchange calendar (holidays, hours) later. */
export interface MarketCalendarProvider {
  getSchedule(now: Date, timeZone: string): MarketSchedule;
}
