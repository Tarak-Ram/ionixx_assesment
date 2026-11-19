import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../../config/app.config';
import { Order } from '../domain/order.entity';
import {
  DuplicateIdempotencyKeyError,
  IdempotencyRecord,
  OrderRepository,
  Page,
} from '../domain/order.repository';

/**
 * Map-backed store. Lives in process memory only, so history is lost on restart —
 * exactly what the challenge requires. Replace with a SQL/NoSQL adapter by providing a
 * different class for ORDER_REPOSITORY; callers depend only on the interface.
 *
 * Memory guard: at most `maxStoredOrders` are kept; when full, the oldest order is evicted
 * (a Map iterates in insertion order, so this is O(1)). A persistent store has no such limit.
 */
@Injectable()
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();
  /** `partnerId + NUL + key` -> the order it produced. */
  private readonly idempotency = new Map<string, { orderId: string; fingerprint: string }>();

  constructor(@Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'maxStoredOrders'>) {}

  async save(order: Order, idempotency?: IdempotencyRecord): Promise<Order> {
    if (idempotency) {
      const slot = this.slot(order.partnerId, idempotency.key);
      if (this.lookup(slot)) throw new DuplicateIdempotencyKeyError();
      this.idempotency.set(slot, { orderId: order.id, fingerprint: idempotency.fingerprint });
    }
    this.orders.set(order.id, structuredClone(order));
    if (this.orders.size > this.config.maxStoredOrders) {
      const oldest = this.orders.keys().next().value as string;
      this.orders.delete(oldest);
    }
    return order;
  }

  async findByIdempotencyKey(partnerId: string, key: string) {
    const hit = this.lookup(this.slot(partnerId, key));
    return hit ? { order: structuredClone(hit.order), fingerprint: hit.fingerprint } : null;
  }

  async findById(id: string, partnerId: string): Promise<Order | null> {
    const order = this.orders.get(id);
    // A different partner's order is indistinguishable from a missing one.
    return order && order.partnerId === partnerId ? structuredClone(order) : null;
  }

  async findAll(
    partnerId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<Page<Order>> {
    const mine = [...this.orders.values()].filter((o) => o.partnerId === partnerId).reverse();
    return {
      items: mine.slice(offset, offset + limit).map((o) => structuredClone(o)),
      total: mine.length,
    };
  }

  private slot(partnerId: string, key: string): string {
    return `${partnerId}\u0000${key}`;
  }

  /** Resolves a key to its order, dropping bookkeeping for orders the memory guard evicted. */
  private lookup(slot: string): { order: Order; fingerprint: string } | null {
    const entry = this.idempotency.get(slot);
    if (!entry) return null;
    const order = this.orders.get(entry.orderId);
    if (!order) {
      this.idempotency.delete(slot);
      return null;
    }
    return { order, fingerprint: entry.fingerprint };
  }
}
