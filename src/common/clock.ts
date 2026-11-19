import { Injectable } from '@nestjs/common';

/** Injectable time source so scheduling logic is deterministic in tests. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
