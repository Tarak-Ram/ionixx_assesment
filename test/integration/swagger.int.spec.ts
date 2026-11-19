import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupSwagger } from '../../src/swagger';
import { createTestApp } from './test-app';

describe('Swagger / OpenAPI', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp({ beforeInit: setupSwagger });
  });
  afterEach(() => app.close());

  it('serves Swagger UI', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('documents the order endpoints, the Idempotency-Key header and the error schema', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json').expect(200);

    expect(body.info.title).toBe('Order Splitter API');
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/orders/split', '/api/v1/orders', '/api/v1/orders/{id}']),
    );
    const split = body.paths['/api/v1/orders/split'].post;
    expect(split.parameters.map((p: { name: string }) => p.name)).toContain('Idempotency-Key');
    expect(Object.keys(split.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '422', '429']),
    );
    expect(body.components.schemas).toHaveProperty('ErrorResponse');
    expect(body.components.schemas).toHaveProperty('OrderResponse');
    expect(body.components.securitySchemes).toHaveProperty('api-key');
  });

  it('keeps health and metrics out of the documentation', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(JSON.stringify(body.paths)).not.toMatch(/health|metrics/);
  });
});
