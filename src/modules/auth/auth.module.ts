import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { AUTH_STRATEGY, AuthStrategy } from './auth-strategy.interface';
import { AuthGuard } from './auth.guard';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { JwtBearerStrategy } from './strategies/jwt-bearer.strategy';
import { NoAuthStrategy } from './strategies/no-auth.strategy';

export interface AuthModuleOptions {
  /** Supply your own strategy; takes precedence over AUTH_MODE. */
  strategy?: AuthStrategy;
}

export function buildStrategy(config: AppConfig['auth']): AuthStrategy {
  switch (config.mode) {
    case 'api-key':
      return new ApiKeyStrategy(config.apiKeys);
    case 'jwt':
      return new JwtBearerStrategy({
        secret: config.jwtSecret as string,
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
      });
    default:
      return new NoAuthStrategy();
  }
}

@Global()
@Module({})
export class AuthModule {
  static register(options: AuthModuleOptions = {}): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        {
          provide: AUTH_STRATEGY,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig): AuthStrategy => {
            const strategy = options.strategy ?? buildStrategy(config.auth);
            const logger = new Logger('Auth');
            if (strategy.name === 'none') {
              logger.warn('Authentication is DISABLED (AUTH_MODE=none). Do not use in production.');
            } else {
              logger.log(`Authentication strategy: ${strategy.name}`);
            }
            return strategy;
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AUTH_STRATEGY],
    };
  }
}
