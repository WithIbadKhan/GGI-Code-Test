-- Up Migration

-- Cancellation ends the cycle immediately, so end_date may equal start_date
-- when a subscription is cancelled right after purchase.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_period_valid;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_period_valid CHECK (end_date >= start_date);

ALTER TABLE subscriptions ADD COLUMN cancelled_at TIMESTAMPTZ NULL;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_cancelled_consistent
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

-- Lets the billing job find due subscriptions without scanning the table.
CREATE INDEX subscriptions_due_idx ON subscriptions (end_date) WHERE status = 'ACTIVE';

-- Down Migration
DROP INDEX subscriptions_due_idx;
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_cancelled_consistent;
ALTER TABLE subscriptions DROP COLUMN cancelled_at;
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_period_valid;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_period_valid CHECK (end_date > start_date);
