import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/** UUID path parameter that fails with the API's standard validation error shape. */
export const uuidParamPipe = (name: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [`${name} must be a UUID`],
      }),
  });
