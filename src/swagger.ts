import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

/**
 * Publishes the OpenAPI document (`/docs-json`) and Swagger UI (`/docs`).
 * Called only when SWAGGER_ENABLED is true (default: on outside production).
 */
export function setupSwagger(app: INestApplication): void {
  const options = new DocumentBuilder()
    .setTitle('Order Splitter API')
    .setDescription(
      [
        'Splits a BUY/SELL amount across a model portfolio, schedules the orders for the next market day',
        'and keeps a history of calculated orders.',
        '',
        '* Money and share quantities are **decimal strings**, never floats.',
        '* Send `Idempotency-Key` on `POST /orders/split` to make retries safe.',
        '* Every error uses the same body shape (`ErrorResponse`).',
        '* Authentication depends on `AUTH_MODE` (none, API key or JWT bearer).',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addTag('orders', 'Calculate order splits and read order history')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(SWAGGER_PATH, app, SwaggerModule.createDocument(app, options), {
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });
}
