import { DynamicModule, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';

@Module({})
export class MetricsModule {
  /** Metrics are always collected; the scrape endpoint exists only when `exposeEndpoint` is true. */
  static register(exposeEndpoint: boolean): DynamicModule {
    return {
      module: MetricsModule,
      controllers: exposeEndpoint ? [MetricsController] : [],
      providers: [MetricsService, MetricsMiddleware],
      exports: [MetricsService, MetricsMiddleware],
    };
  }
}
