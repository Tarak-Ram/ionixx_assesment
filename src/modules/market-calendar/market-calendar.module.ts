import { Module } from '@nestjs/common';
import { MARKET_CALENDAR } from './market-calendar.interface';
import { WeekdayCalendarProvider } from './weekday-calendar.provider';

@Module({
  providers: [{ provide: MARKET_CALENDAR, useClass: WeekdayCalendarProvider }],
  exports: [MARKET_CALENDAR],
})
export class MarketCalendarModule {}
