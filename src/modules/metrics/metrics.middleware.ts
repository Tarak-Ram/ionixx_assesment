import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Records one duration sample per request. Labels use the route *pattern* to keep cardinality low. */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      this.metrics.observeRequest(req.method, route, res.statusCode, seconds);
    });
    next();
  }
}
