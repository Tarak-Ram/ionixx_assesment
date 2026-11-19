import { DatabaseConfig, loadOrdersDatabaseConfig } from './database.config';
import { Env, readBoolean, readInteger } from './env';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type AuthMode = 'none' | 'api-key' | 'jwt';
export type StorageMode = 'memory' | 'postgres';
export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
const LOG_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: LogLevel;
  /** Serve Swagger UI at /docs. Defaults to off in production. */
  swaggerEnabled: boolean;
  /** Expose Prometheus metrics at /metrics. */
  metricsEnabled: boolean;
  /** Allowed CORS origins. Empty = CORS disabled (no cross-origin browser access). */
  corsOrigins: string[];
  /** Express `trust proxy`: number of proxy hops (0 = none). Needed for correct client IPs behind a LB. */
  trustProxyHops: number;
  rateLimit: { ttlMs: number; max: number };
  /** Max decimal places for share quantities. */
  sharePrecision: number;
  /** Price used when the partner supplies none. */
  defaultPrice: string;
  /** IANA timezone used to determine the market weekday. */
  marketTimezone: string;
  /** Memory guard: oldest orders are evicted beyond this many. */
  maxStoredOrders: number;
  /** Where order history is kept. `memory` (default) matches the challenge: lost on restart. */
  storage: StorageMode;
  /** Present only when storage is `postgres`. */
  ordersDb?: DatabaseConfig;
  auth: {
    mode: AuthMode;
    /** api-key mode: key -> partnerId */
    apiKeys: Record<string, string>;
    jwtSecret?: string;
    jwtIssuer?: string;
    jwtAudience?: string;
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and validates configuration. Fails fast at startup with every problem listed,
 * so a mis-configured deployment never starts serving traffic.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const errors: string[] = [];

  const int = (name: string, fallback: string, min: number, max: number): number =>
    readInteger(env, errors, name, fallback, min, max);

  const nodeEnv = (env.NODE_ENV ?? 'development').trim() as NodeEnv;
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of development | test | production (got "${nodeEnv}")`);
  }
  const isProd = nodeEnv === 'production';

  const port = int('PORT', '3000', 1, 65535);
  const logLevel = (env.LOG_LEVEL ?? 'info').trim() as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(' | ')} (got "${logLevel}")`);
  }
  const swaggerEnabled = readBoolean(env, errors, 'SWAGGER_ENABLED', !isProd);
  const metricsEnabled = readBoolean(env, errors, 'METRICS_ENABLED', true);
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const trustProxyHops = int('TRUST_PROXY_HOPS', '0', 0, 10);
  const rateLimit = {
    ttlMs: int('RATE_LIMIT_TTL_MS', '60000', 1000, 3_600_000),
    max: int('RATE_LIMIT_MAX', '300', 1, 1_000_000),
  };
  const sharePrecision = int('SHARE_PRECISION', '3', 0, 10);
  const maxStoredOrders = int('MAX_STORED_ORDERS', '10000', 1, 1_000_000);

  const defaultPrice = (env.DEFAULT_PRICE ?? '100').trim();
  if (!/^\d+(\.\d+)?$/.test(defaultPrice) || Number(defaultPrice) <= 0) {
    errors.push(`DEFAULT_PRICE must be a positive decimal number (got "${defaultPrice}")`);
  }

  const marketTimezone = (env.MARKET_TIMEZONE ?? 'UTC').trim();
  if (!isValidTimeZone(marketTimezone)) {
    errors.push(`MARKET_TIMEZONE must be a valid IANA timezone (got "${marketTimezone}")`);
  }

  const storage = (env.STORAGE ?? 'memory').trim() as StorageMode;
  if (!['memory', 'postgres'].includes(storage)) {
    errors.push(`STORAGE must be one of memory | postgres (got "${storage}")`);
  }
  const ordersDb = storage === 'postgres' ? loadOrdersDatabaseConfig(env, errors) : undefined;

  const mode = (env.AUTH_MODE ?? 'none').trim() as AuthMode;
  if (!['none', 'api-key', 'jwt'].includes(mode)) {
    errors.push(`AUTH_MODE must be one of none | api-key | jwt (got "${mode}")`);
  }

  const apiKeys: Record<string, string> = {};
  if (mode === 'api-key') {
    const pairs = (env.API_KEYS ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (pairs.length === 0) errors.push('API_KEYS is required when AUTH_MODE=api-key');
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      const key = pair.slice(0, idx);
      const partner = pair.slice(idx + 1);
      if (idx < 1 || !partner) errors.push('API_KEYS entries must look like "key:partnerId"');
      else apiKeys[key] = partner;
    }
  }

  const jwtSecret = env.JWT_SECRET;
  if (mode === 'jwt' && (!jwtSecret || jwtSecret.length < 32)) {
    errors.push('JWT_SECRET (min 32 characters) is required when AUTH_MODE=jwt');
  }

  if (isProd) {
    if (mode === 'none') errors.push('AUTH_MODE=none is not allowed when NODE_ENV=production');
    if (ordersDb?.autoCreateSchema) {
      errors.push(
        'ORDERS_DB_AUTO_SCHEMA=true is not allowed when NODE_ENV=production (use migrations)',
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    nodeEnv,
    port,
    logLevel,
    swaggerEnabled,
    metricsEnabled,
    corsOrigins,
    trustProxyHops,
    rateLimit,
    sharePrecision,
    defaultPrice,
    marketTimezone,
    maxStoredOrders,
    storage,
    ordersDb,
    auth: {
      mode,
      apiKeys,
      jwtSecret,
      jwtIssuer: env.JWT_ISSUER || undefined,
      jwtAudience: env.JWT_AUDIENCE || undefined,
    },
  };
}
