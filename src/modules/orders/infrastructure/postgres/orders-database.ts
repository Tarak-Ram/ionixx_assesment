import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../../../../config/app.config';
import { DatabaseConfig, describeDatabase } from '../../../../config/database.config';
import { ORDERS_SCHEMA_SQL } from './orders.schema';

/**
 * Owns the connection pool to the orders database.
 *  - Does nothing unless STORAGE=postgres (the default in-memory mode opens no connection).
 *  - Creates ONE pool at startup, checks it with `SELECT 1` and fails the boot if the database is
 *    unreachable, so a broken instance never serves traffic.
 *  - Closes the pool on shutdown.
 */
@Injectable()
export class OrdersDatabase implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OrdersDatabase');
  private pool?: Pool;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const db = this.config.ordersDb;
    if (this.config.storage !== 'postgres' || !db) return;

    this.logger.warn(
      'STORAGE=postgres: order history now persists across restarts (the challenge default is in-memory).',
    );
    this.pool = this.createPool(db);
    // An idle client can fail (e.g. database restart); log instead of crashing the process.
    this.pool.on('error', (err) => this.logger.error(`Idle client error: ${err.message}`));

    await this.connectWithRetry(this.pool, db);
    if (db.autoCreateSchema) await this.pool.query(ORDERS_SCHEMA_SQL);
    this.logger.log(`Connected to ${describeDatabase(db.url)} (pool max ${db.poolMax})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }

  /** Readiness probe: true when the database answers a trivial query. Never throws. */
  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** True when this instance is configured to use the database at all. */
  get enabled(): boolean {
    return this.config.storage === 'postgres';
  }

  /** Orchestrators often start the app before the database accepts connections: back off, then give up. */
  private async connectWithRetry(pool: Pool, db: DatabaseConfig): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await pool.query('SELECT 1');
        return;
      } catch (err) {
        if (attempt >= db.connectRetries) throw err;
        const delay = db.connectRetryDelayMs * 2 ** attempt;
        this.logger.warn(
          `Database not reachable (attempt ${attempt + 1}/${db.connectRetries + 1}); retrying in ${delay}ms`,
        );
        await this.sleep(delay);
      }
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Runs a parameterised query on a pooled connection. */
  async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new Error('Orders database is not connected');
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  /** Overridable so tests can inject an in-process Postgres emulator. */
  protected createPool(db: DatabaseConfig): Pool {
    return new Pool({
      connectionString: db.url,
      max: db.poolMax,
      connectionTimeoutMillis: db.connectTimeoutMs,
      statement_timeout: db.queryTimeoutMs,
      ssl: db.ssl ? { rejectUnauthorized: true, ...(db.sslCa && { ca: db.sslCa }) } : undefined,
    });
  }
}
