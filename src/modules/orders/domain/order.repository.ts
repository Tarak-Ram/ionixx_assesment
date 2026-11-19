import { Order } from './order.entity';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface Page<T> {
  items: T[];
  total: number;
}

/** Identifies one client submission so a retried POST can be recognised and answered identically. */
export interface IdempotencyRecord {
  key: string;
  /** Hash of the request payload: the same key with a different payload is a client bug (422). */
  fingerprint: string;
}

/** Thrown by `save` when another request already stored this partner's idempotency key (race). */
export class DuplicateIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency key already used');
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

/**
 * Order-history storage contract. Every read is scoped by partnerId so tenant isolation is
 * enforced at the storage boundary, not left to callers.
 */
export interface OrderRepository {
  save(order: Order, idempotency?: IdempotencyRecord): Promise<Order>;
  findByIdempotencyKey(
    partnerId: string,
    key: string,
  ): Promise<{ order: Order; fingerprint: string } | null>;
  findById(id: string, partnerId: string): Promise<Order | null>;
  /** Newest first. */
  findAll(partnerId: string, options: { limit: number; offset: number }): Promise<Page<Order>>;
}
