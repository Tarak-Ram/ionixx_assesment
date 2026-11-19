import { Order } from '../../domain/order.entity';
import {
  DuplicateIdempotencyKeyError,
  IdempotencyRecord,
  OrderRepository,
  Page,
} from '../../domain/order.repository';
import { OrdersDatabase } from './orders-database';

/**
 * PostgreSQL implementation of the OrderRepository port. Selected with STORAGE=postgres.
 * Every query is parameterised and filtered by partner_id (tenant isolation at the storage
 * boundary), exactly like the in-memory implementation.
 */
export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly db: Pick<OrdersDatabase, 'query'>) {}

  async save(order: Order, idempotency?: IdempotencyRecord): Promise<Order> {
    try {
      await this.db.query(
        `INSERT INTO orders (id, partner_id, order_type, payload, created_at, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          order.id,
          order.partnerId,
          order.type,
          JSON.stringify(order),
          order.createdAt,
          idempotency?.key ?? null,
          idempotency?.fingerprint ?? null,
        ],
      );
    } catch (err) {
      // 23505 = unique_violation: a concurrent request stored the same (partner, key) first.
      if (idempotency && (err as { code?: string }).code === '23505') {
        throw new DuplicateIdempotencyKeyError();
      }
      throw err;
    }
    return order;
  }

  async findByIdempotencyKey(partnerId: string, key: string) {
    const rows = await this.db.query<{ payload: Order; request_fingerprint: string }>(
      `SELECT payload, request_fingerprint FROM orders
       WHERE partner_id = $1 AND idempotency_key = $2`,
      [partnerId, key],
    );
    return rows[0] ? { order: rows[0].payload, fingerprint: rows[0].request_fingerprint } : null;
  }

  async findById(id: string, partnerId: string): Promise<Order | null> {
    const rows = await this.db.query<{ payload: Order }>(
      'SELECT payload FROM orders WHERE id = $1 AND partner_id = $2',
      [id, partnerId],
    );
    return rows[0]?.payload ?? null;
  }

  async findAll(
    partnerId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<Page<Order>> {
    const [items, counts] = await Promise.all([
      this.db.query<{ payload: Order }>(
        `SELECT payload FROM orders WHERE partner_id = $1
         ORDER BY seq DESC LIMIT $2 OFFSET $3`,
        [partnerId, limit, offset],
      ),
      this.db.query<{ total: string }>(
        'SELECT COUNT(*) AS total FROM orders WHERE partner_id = $1',
        [partnerId],
      ),
    ]);
    return { items: items.map((r) => r.payload), total: Number(counts[0]?.total ?? 0) };
  }
}
