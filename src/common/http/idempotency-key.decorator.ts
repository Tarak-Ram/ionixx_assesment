import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const VALID_KEY = /^[\x21-\x7E]{1,128}$/; // printable ASCII, no spaces

/** Reads and validates the optional `Idempotency-Key` header (undefined when absent). */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const raw = ctx.switchToHttp().getRequest<Request>().headers[IDEMPOTENCY_HEADER];
    if (raw === undefined) return undefined;
    const key = Array.isArray(raw) ? raw.join(',') : raw;
    if (!VALID_KEY.test(key)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: ['Idempotency-Key must be 1-128 printable ASCII characters without spaces'],
      });
    }
    return key;
  },
);
