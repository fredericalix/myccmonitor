ALTER TABLE users
    ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mcp_token_hash BYTEA,
    ADD COLUMN IF NOT EXISTS mcp_token_prefix TEXT,
    ADD COLUMN IF NOT EXISTS mcp_token_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mcp_token_last_used_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_mcp_token_hash_idx
    ON users (mcp_token_hash)
    WHERE mcp_token_hash IS NOT NULL;
