import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.decorators';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint. It is unauthenticated by design (scrapers do not hold partner
 * credentials): expose it only on the internal network, or disable it with METRICS_ENABLED=false.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
