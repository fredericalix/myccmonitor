-- Phase 1: users table for OAuth-authenticated Clever Cloud accounts.
-- OAuth tokens are stored AES-256-GCM-encrypted; oauth_nonce holds two
-- 12-byte AES-GCM nonces concatenated (token_nonce[12] || secret_nonce[12]).

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cc_user_id      TEXT UNIQUE NOT NULL,
    email           TEXT,
    display_name    TEXT,
    oauth_token_enc  BYTEA NOT NULL,
    oauth_secret_enc BYTEA NOT NULL,
    oauth_nonce      BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The UNIQUE constraint on cc_user_id already creates an index.
