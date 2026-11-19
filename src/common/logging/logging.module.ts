import { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { resolveCorrelationId } from '../http/correlation';

const QUIET_PATHS = /\/(health|metrics)(\/|$)/;

/**
 * Structured JSON logging (pino). One access-log line per request with method, path, status,
 * duration and correlationId; the id is also attached to every other log line written while the
 * request is handled (AsyncLocalStorage). Secrets are redacted and query strings never logged.
 * `stream` lets tests capture the output; production writes to stdout.
 */
export function createLoggingModule(stream?: DestinationStream): DynamicModule {
  return LoggerModule.forRootAsync({
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig) => ({
      pinoHttp: [
        {
          level: config.logLevel,
          genReqId: resolveCorrelationId,
          customProps: (req) => ({ correlationId: req.id }),
          autoLogging: { ignore: (req) => QUIET_PATHS.test(req.url ?? '') },
          redact: {
            paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
        stream as DestinationStream,
      ],
    }),
  });
}
