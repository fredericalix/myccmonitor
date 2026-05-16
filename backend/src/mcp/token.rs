//! MCP token generation and hashing.
//!
//! Tokens are 32 random bytes b64url-encoded, prefixed with `mccm_`. The raw
//! token is shown to the user **once** on creation; only its sha256 hash is
//! persisted (column `users.mcp_token_hash`). The prefix (`mccm_` + first 8
//! chars of the b64url body) is stored in clear in `users.mcp_token_prefix`
//! purely as a UI label so the user can recognise which token is active.

use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Number of body characters from the b64url-encoded random bytes that we
/// keep in `users.mcp_token_prefix`. 8 chars × ~6 bits ≈ 48 bits of identity,
/// which is enough to recognise a token in the UI but doesn't materially
/// shrink the raw token's entropy.
const PREFIX_BODY_CHARS: usize = 8;

pub const TOKEN_PREFIX: &str = "mccm_";

pub struct GeneratedToken {
    /// Full token, shown to the user once. Format: `mccm_<43 b64url chars>`.
    pub raw: String,
    /// SHA-256 of the raw token. Stored as `users.mcp_token_hash`.
    pub hash: Vec<u8>,
    /// UI label, shape `mccm_<first 8 chars of body>`. Safe to display.
    pub prefix: String,
}

pub fn generate() -> GeneratedToken {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let body = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let raw = format!("{TOKEN_PREFIX}{body}");
    let prefix = format!("{TOKEN_PREFIX}{}", &body[..PREFIX_BODY_CHARS.min(body.len())]);
    let hash = hash(&raw);
    GeneratedToken { raw, hash, prefix }
}

pub fn hash(raw: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hasher.finalize().to_vec()
}
