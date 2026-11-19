import { INestApplication, Type } from '@nestjs/common';
import type { DestinationStream } from 'pino';
import { dirname, join } from 'path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { Clock } from '../../src/common/clock';
import { loadConfig } from '../../src/config/app.config';
import { AuthModuleOptions } from '../../src/modules/auth/auth.module';
import { OrdersDatabase } from '../../src/modules/orders/infrastructure/postgres/orders-database';

function resetPinoSingleton(): void {
  // The package's exports map hides this internal test hook, so load it by absolute path.
  const file = join(dirname(require.resolve('nestjs-pino')), 'PinoLogger.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(file).__resetOutOfContextForTests();
}

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Fixed "now" (ISO). Defaults to Monday 2026-11-16T10:00:00Z. */
  now?: string;
  auth?: AuthModuleOptions;
  /** Replaces the Postgres connection (e.g. with an in-process emulator). */
  database?: Type<OrdersDatabase>;
  /** Captures the JSON log lines. */
  logStream?: DestinationStream;
  /** Runs after the HTTP pipeline is configured and before the app starts (e.g. to mount Swagger). */
  beforeInit?: (app: INestApplication) => void;
}

export const MONDAY = '2026-11-16T10:00:00Z';

export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  // nestjs-pino keeps one process-wide logger; tests build many apps, so start each one clean.
  resetPinoSingleton();
  let builder = Test.createTestingModule({
    imports: [
      AppModule.register({
        auth: options.auth,
        // Logs are silent in tests unless a test asks for them (LOG_LEVEL / logStream).
        config: loadConfig({ LOG_LEVEL: 'silent', ...options.env }),
        logStream: options.logStream,
      }),
    ],
  })
    .overrideProvider(Clock)
    .useValue({ now: () => new Date(options.now ?? MONDAY) });
  if (options.database)
    builder = builder.overrideProvider(OrdersDatabase).useClass(options.database);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  options.beforeInit?.(app);
  await app.init();
  return app;
}

export const validBody = {
  type: 'BUY',
  totalAmount: 100,
  portfolio: [
    { symbol: 'AAPL', weight: 60 },
    { symbol: 'TSLA', weight: 40 },
  ],
};
