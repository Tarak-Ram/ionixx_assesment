import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { OrdersDatabase } from '../orders/infrastructure/postgres/orders-database';

@ApiExcludeController()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly ordersDb: OrdersDatabase) {}

  /** Liveness: the process is up and the event loop answers. Never touches dependencies. */
  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies answer. A load balancer should stop routing here on 503. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, 'up' | 'down'> = {};
    if (this.ordersDb.enabled) checks.ordersDatabase = (await this.ordersDb.ping()) ? 'up' : 'down';

    const healthy = Object.values(checks).every((c) => c === 'up');
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'unavailable', checks };
  }
}
