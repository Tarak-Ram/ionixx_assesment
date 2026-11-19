import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { DestinationStream } from 'pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createLoggingModule } from './common/logging/logging.module';
import { APP_CONFIG, AppConfig, loadConfig } from './config/app.config';
import { ConfigModule } from './config/config.module';
import { AuthModule, AuthModuleOptions } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsMiddleware } from './modules/metrics/metrics.middleware';
import { MetricsModule } from './modules/metrics/metrics.module';
import { OrdersModule } from './modules/orders/orders.module';

export interface AppModuleOptions {
  /** Plug in a custom authentication strategy. */
  auth?: AuthModuleOptions;
  /** Already-validated configuration (so it is loaded once). Defaults to `loadConfig()`. */
  config?: AppConfig;
  /** Where JSON logs go (stdout by default); tests pass a stream to capture them. */
  logStream?: DestinationStream;
}

@Module({})
export class AppModule implements NestModule {
  static register(options: AppModuleOptions = {}): DynamicModule {
    const config = options.config ?? loadConfig();
    return {
      module: AppModule,
      imports: [
        ConfigModule.register(config),
        createLoggingModule(options.logStream),
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => ({
            throttlers: [{ ttl: c.rateLimit.ttlMs, limit: c.rateLimit.max }],
          }),
        }),
        AuthModule.register(options.auth),
        OrdersModule,
        HealthModule,
        MetricsModule.register(config.metricsEnabled),
      ],
      providers: [
        // Registered here (not via `new` in main.ts) so the filter can use dependency injection.
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Rate limiting runs for every route; health/metrics opt out with @SkipThrottle().
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes('*path');
  }
}
