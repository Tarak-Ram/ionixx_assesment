import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainValidationError, OrderNotFoundError } from '../errors/domain.errors';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
  timestamp: string;
  path: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

/** Single place that turns every failure into one consistent, non-leaky error shape. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, code, message, details } = this.normalise(exception);
    if (status >= 500) {
      this.logger.error(
        `Unhandled error on ${req.method} ${req.originalUrl.split('?')[0]}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode: status,
      error: STATUS_TEXT[status] ?? 'Error',
      code,
      message,
      ...(details !== undefined && { details }),
      correlationId: res.locals.correlationId,
      timestamp: new Date().toISOString(),
      path: req.originalUrl.split('?')[0],
    };
    res.status(status).json(body);
  }

  private normalise(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof DomainValidationError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof OrderNotFoundError) {
      return { status: HttpStatus.NOT_FOUND, code: exception.code, message: exception.message };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const obj = typeof response === 'object' ? (response as Record<string, unknown>) : {};
      if (status === 429) {
        return {
          status,
          code: 'RATE_LIMITED',
          message: 'Too many requests, slow down and retry later',
        };
      }
      // A 400 without one of our error codes comes from the framework (e.g. the JSON body
      // parser) and its message can echo raw input/parser internals: replace it.
      if (status === 400 && typeof obj.code !== 'string') {
        return { status, code: 'BAD_REQUEST', message: 'Malformed request' };
      }
      return {
        status,
        code: typeof obj.code === 'string' ? obj.code : defaultCode(status),
        message: typeof obj.message === 'string' ? obj.message : exception.message,
        details: obj.details,
      };
    }
    // Body-parser / framework errors carry a 4xx status; surface a generic message only.
    const status = (exception as { status?: unknown })?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        status,
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        message: status === 413 ? 'Request body is too large' : 'Malformed request',
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'ERROR';
  }
}
