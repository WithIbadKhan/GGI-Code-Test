-- Up Migration

-- One row per user per calendar month (UTC). A new month simply means a new
-- row, so the free quota "resets" on the 1st without any cron job, and past
-- months are kept as usage history.
CREATE TABLE monthly_usage (
  user_id     TEXT        NOT NULL,
  period      DATE        NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
  free_used   INTEGER     NOT NULL DEFAULT 0 CHECK (free_used >= 0),
  total_used  INTEGER     NOT NULL DEFAULT 0 CHECK (total_used >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);

CREATE TABLE chat_messages (
  id                 UUID PRIMARY KEY,
  user_id            TEXT        NOT NULL,
  question           TEXT        NOT NULL,
  answer             TEXT        NULL,
  status             TEXT        NOT NULL CHECK (status IN ('RESERVED', 'COMPLETED', 'FAILED')),

  -- Where the quota for this message came from.
  quota_source       TEXT        NOT NULL CHECK (quota_source IN ('FREE', 'BUNDLE')),
  subscription_id    UUID        NULL REFERENCES subscriptions (id),
  usage_period       DATE        NOT NULL,

  -- Token usage reported by the AI provider.
  prompt_tokens      INTEGER     NULL CHECK (prompt_tokens >= 0),
  completion_tokens  INTEGER     NULL CHECK (completion_tokens >= 0),
  total_tokens       INTEGER     NULL CHECK (total_tokens >= 0),
  provider           TEXT        NULL,
  model              TEXT        NULL,

  -- Request metadata.
  request_id         TEXT        NULL,
  latency_ms         INTEGER     NULL CHECK (latency_ms >= 0),
  failure_reason     TEXT        NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  completed_at       TIMESTAMPTZ NULL,

  CONSTRAINT chat_messages_bundle_has_subscription
    CHECK ((quota_source = 'BUNDLE') = (subscription_id IS NOT NULL)),
  CONSTRAINT chat_messages_completed_has_answer
    CHECK (status <> 'COMPLETED' OR (answer IS NOT NULL AND total_tokens IS NOT NULL))
);

CREATE INDEX chat_messages_user_created_idx ON chat_messages (user_id, created_at DESC);

-- Down Migration
DROP TABLE chat_messages;
DROP TABLE monthly_usage;
