import { Env, readBoolean, readInteger } from './env';

/** Connection settings for the orders database (PostgreSQL). Only used when STORAGE=postgres. */
export interface DatabaseConfig {
  url: string;
  poolMax: number;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  ssl: boolean;
  /** PEM-encoded CA certificate(s) to trust when ssl is on (e.g. the RDS bundle). Optional. */
  sslCa?: string;
  /** Extra connection attempts at startup before the boot fails (exponential backoff). */
  connectRetries: number;
  connectRetryDelayMs: number;
  /** Create the `orders` table at startup if missing (convenient for dev; use migrations in production). */
  autoCreateSchema: boolean;
}

/**
 * Reads ORDERS_DB_* variables. Problems are appended to `errors` so the caller can report every
 * configuration mistake at once. The URL itself is never logged (it contains the password).
 */
export function loadOrdersDatabaseConfig(env: Env, errors: string[]): DatabaseConfig {
  const url = (env.ORDERS_DB_URL ?? '').trim();
  if (!/^postgres(ql)?:\/\/\S+$/.test(url)) {
    errors.push(
      'ORDERS_DB_URL is required when STORAGE=postgres and must look like postgresql://user:password@host:5432/dbname',
    );
  }

  return {
    url,
    poolMax: readInteger(env, errors, 'ORDERS_DB_POOL_MAX', '10', 1, 100),
    connectTimeoutMs: readInteger(env, errors, 'ORDERS_DB_CONNECT_TIMEOUT_MS', '3000', 100, 60000),
    queryTimeoutMs: readInteger(env, errors, 'ORDERS_DB_QUERY_TIMEOUT_MS', '5000', 100, 120000),
    ssl: readBoolean(env, errors, 'ORDERS_DB_SSL', false),
    // Env files often carry a PEM on one line with literal "\n" sequences.
    sslCa: env.ORDERS_DB_SSL_CA?.trim().replace(/\\n/g, '\n') || undefined,
    connectRetries: readInteger(env, errors, 'ORDERS_DB_CONNECT_RETRIES', '5', 0, 20),
    connectRetryDelayMs: readInteger(
      env,
      errors,
      'ORDERS_DB_CONNECT_RETRY_DELAY_MS',
      '500',
      10,
      60000,
    ),
    autoCreateSchema: readBoolean(env, errors, 'ORDERS_DB_AUTO_SCHEMA', false),
  };
}

/** Host and database name only, safe to log. */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return 'unknown';
  }
}
