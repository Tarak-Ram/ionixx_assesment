import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { API_PREFIX } from './common/http/api-prefix';
import { APP_CONFIG, AppConfig } from './config/app.config';

export { API_PREFIX };

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {});
    return [...own, ...flatten(e.children ?? [], path)];
  });
}

/**
 * Security headers. Strict by default; Swagger UI needs inline scripts/styles, so the docs path
 * gets the same headers minus Content-Security-Policy.
 */
function securityHeaders() {
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  return (req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/docs') ? docs : strict)(req, res, next);
}

/** Shared by main.ts and the integration tests so both run the exact same HTTP pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  if (config.trustProxyHops > 0) {
    // Behind a load balancer: use X-Forwarded-For for the client IP (rate limiting, logs).
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', config.trustProxyHops);
  }
  app.use(securityHeaders());
  app.enableCors({
    // An empty list means no origin is allowed: browsers on other sites cannot call the API.
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'Idempotency-Key',
      'X-Correlation-Id',
    ],
    exposedHeaders: ['X-Correlation-Id', 'Idempotent-Replayed', 'Location'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: flatten(errors),
        }),
    }),
  );
}
