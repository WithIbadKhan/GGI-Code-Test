-- Up Migration

-- Subscription bundles. Owned by the subscriptions module; the chat module only
-- reads active bundles and increments `used_messages` when it consumes quota.
CREATE TABLE subscriptions (
  id             UUID PRIMARY KEY,
  user_id        TEXT        NOT NULL,          -- `sub` claim from the identity provider
  tier           TEXT        NOT NULL CHECK (tier IN ('BASIC', 'PRO', 'ENTERPRISE')),
  billing_cycle  TEXT        NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
  max_messages   INTEGER     NULL CHECK (max_messages IS NULL OR max_messages > 0), -- NULL = unlimited
  used_messages  INTEGER     NOT NULL DEFAULT 0 CHECK (used_messages >= 0),
  price_cents    INTEGER     NOT NULL CHECK (price_cents >= 0),
  currency       CHAR(3)     NOT NULL DEFAULT 'USD',
  auto_renew     BOOLEAN     NOT NULL DEFAULT TRUE,
  status         TEXT        NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'CANCELLED')),
  start_date     TIMESTAMPTZ NOT NULL,
  end_date       TIMESTAMPTZ NOT NULL,
  renewal_date   TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_period_valid CHECK (end_date > start_date),
  -- Last line of defence against overselling: the database itself refuses
  -- to let a bundle go past its limit, whatever the application does.
  CONSTRAINT subscriptions_usage_within_limit
    CHECK (max_messages IS NULL OR used_messages <= max_messages)
);

CREATE INDEX subscriptions_user_active_idx
  ON subscriptions (user_id, created_at DESC)
  WHERE status = 'ACTIVE';

-- Down Migration
DROP TABLE subscriptions;
