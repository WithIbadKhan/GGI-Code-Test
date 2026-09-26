-- Up Migration

-- A client session binds one access token to a signing key. The key itself is
-- never stored: it is derived from a server secret and the session id.
CREATE TABLE client_sessions (
  id                 UUID PRIMARY KEY,
  user_id            TEXT        NOT NULL,
  -- SHA-256 of the access token the session was created with.
  token_fingerprint  TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  CONSTRAINT client_sessions_expiry_valid CHECK (expires_at > created_at)
);

CREATE INDEX client_sessions_expires_idx ON client_sessions (expires_at);

-- Nonces already used by a session. The primary key makes "has this nonce been
-- seen?" and "remember it" a single atomic INSERT, even across app instances.
CREATE TABLE request_nonces (
  session_id  UUID        NOT NULL REFERENCES client_sessions (id) ON DELETE CASCADE,
  nonce       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, nonce)
);

CREATE INDEX request_nonces_created_idx ON request_nonces (created_at);

-- Down Migration
DROP TABLE request_nonces;
DROP TABLE client_sessions;
