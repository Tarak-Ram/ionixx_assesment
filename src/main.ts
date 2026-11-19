import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './bootstrap';
import { loadConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(); // fail fast on invalid configuration, before anything starts
  // bufferLogs: hold early framework logs until the JSON logger is installed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ config }), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useBodyParser('json', { limit: '100kb' });
  app.disable('x-powered-by');
  configureApp(app);

  if (config.swaggerEnabled) {
    const swagger = new DocumentBuilder()
      .setTitle('Order Splitter API')
      .setDescription('Splits a BUY/SELL amount across a model portfolio and schedules the orders.')
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  app.enableShutdownHooks(); // closes the database pool cleanly on SIGTERM/SIGINT
  await app.listen(config.port, '0.0.0.0');

  logger.log(`Listening on port ${config.port}, base path /${API_PREFIX}`);
  if (config.swaggerEnabled) logger.log('Swagger UI enabled at /docs');
  if (config.nodeEnv === 'production' && config.storage === 'memory') {
    logger.warn('STORAGE=memory in production: order history is lost on every restart');
  }
  logger.log(
    `Config: env=${config.nodeEnv} sharePrecision=${config.sharePrecision} ` +
      `marketTimezone=${config.marketTimezone} auth=${config.auth.mode} storage=${config.storage} ` +
      `rateLimit=${config.rateLimit.max}/${config.rateLimit.ttlMs}ms metrics=${config.metricsEnabled}`,
  );
}

bootstrap().catch((err: unknown) => {
  // Startup failures (bad config, unreachable database) must exit non-zero so the orchestrator restarts/alerts.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
