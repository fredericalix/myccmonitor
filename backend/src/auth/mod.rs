//! OAuth 1.0a Clever Cloud login + AES-GCM token encryption + session handlers.

pub mod encryption;
pub mod extractor;
pub mod oauth;
pub mod routes;

pub use extractor::AuthenticatedUser;
pub use routes::router;

use crate::db::users::User;
use anyhow::{Context, bail};

/// Decrypt the (access_token, access_secret) pair stored on a user row.
/// `oauth_nonce` is the concatenation `token_nonce[12] || secret_nonce[12]`.
/// Used by the auth extractor and the Phase 4 poller.
pub fn decrypt_user_oauth(user: &User, key: &[u8; 32]) -> anyhow::Result<(String, String)> {
    if user.oauth_nonce.len() != 24 {
        bail!(
            "user.oauth_nonce length is {} (expected 24)",
            user.oauth_nonce.len()
        );
    }
    let token_nonce = &user.oauth_nonce[..12];
    let secret_nonce = &user.oauth_nonce[12..];
    let token_bytes = encryption::decrypt(&user.oauth_token_enc, token_nonce, key)
        .context("decrypt access_token")?;
    let secret_bytes = encryption::decrypt(&user.oauth_secret_enc, secret_nonce, key)
        .context("decrypt access_secret")?;
    Ok((
        String::from_utf8(token_bytes).context("token utf8")?,
        String::from_utf8(secret_bytes).context("secret utf8")?,
    ))
}
