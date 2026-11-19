import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/** Prometheus metrics: Node runtime defaults plus HTTP request duration by route and status. */
@Injectable()
export class MetricsService {
  /** A private registry (not the global one) so several app instances (tests) never clash. */
  readonly registry = new Registry();
  private readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  observeRequest(method: string, route: string, statusCode: number, seconds: number): void {
    this.httpDuration.observe({ method, route, status_code: String(statusCode) }, seconds);
  }
}
