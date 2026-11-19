import { Module } from '@nestjs/common';
import { MarketCalendarModule } from '../market-calendar/market-calendar.module';
import { PricingModule } from '../pricing/pricing.module';
import { GetOrderHistoryUseCase } from './application/get-order-history.use-case';
import { SplitOrderUseCase } from './application/split-order.use-case';
import { AllocationService } from './domain/allocation.service';
import { ORDER_REPOSITORY } from './domain/order.repository';
import { QuantityCalculatorService } from './domain/quantity-calculator.service';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order.repository';
import { OrdersDatabase } from './infrastructure/postgres/orders-database';
import { PostgresOrderRepository } from './infrastructure/postgres/postgres-order.repository';
import { OrdersController } from './orders.controller';

@Module({
  imports: [PricingModule, MarketCalendarModule],
  controllers: [OrdersController],
  providers: [
    SplitOrderUseCase,
    GetOrderHistoryUseCase,
    AllocationService,
    QuantityCalculatorService,
    OrdersDatabase,
    {
      // The only place that knows which storage is in use; everything else sees OrderRepository.
      provide: ORDER_REPOSITORY,
      inject: [APP_CONFIG, OrdersDatabase],
      useFactory: (config: AppConfig, db: OrdersDatabase) =>
        config.storage === 'postgres'
          ? new PostgresOrderRepository(db)
          : new InMemoryOrderRepository(config),
    },
  ],
  exports: [OrdersDatabase], // read by the readiness probe
})
export class OrdersModule {}
