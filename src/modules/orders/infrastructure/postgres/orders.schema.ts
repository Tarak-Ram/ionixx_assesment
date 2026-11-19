/**
 * Schema for the orders table. Applied at startup only when ORDERS_DB_AUTO_SCHEMA=true (dev
 * convenience); production should apply the same SQL through versioned migrations.
 *
 * `seq` gives a stable insertion order (newest first) without relying on timestamp ties.
 * The full order is stored in `payload` (jsonb) so the API shape can evolve; the columns
 * that are filtered on are real columns and indexed. The unique (partner_id, idempotency_key)
 * index makes retries of the same POST safe even under concurrency (NULL keys never collide).
 */
export const ORDERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  seq         BIGSERIAL PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  partner_id  TEXT NOT NULL,
  order_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  idempotency_key     TEXT,
  request_fingerprint TEXT
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS orders_partner_seq_idx ON orders (partner_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS orders_partner_idempotency_uq ON orders (partner_id, idempotency_key);
`;
