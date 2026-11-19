import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

export const CORRELATION_HEADER = 'x-correlation-id';
/** Only accept well-formed inbound ids so clients cannot inject log lines or huge values. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

type ResponseWithLocals = ServerResponse & { locals?: Record<string, unknown> };

/**
 * Picks the request's correlation id (the caller's, if well-formed; otherwise a fresh UUID),
 * echoes it in the response header and exposes it to the error filter via `res.locals`.
 * Used as the logger's request-id generator, so every log line of the request carries it.
 */
export function resolveCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const inbound = req.headers[CORRELATION_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const id = candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  const target = res as ResponseWithLocals;
  target.locals ??= {};
  target.locals.correlationId = id;
  return id;
}
