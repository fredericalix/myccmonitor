//! `AuthenticatedUser` extractor: pulls the session, looks up the User row,
//! decrypts the OAuth (token, secret) pair, and hands the result to a handler.
//! Use as `auth_user: AuthenticatedUser` in any axum handler that needs the
//! caller's identity or needs to call CC API on their behalf.

use crate::auth::decrypt_user_oauth;
use crate::db::users::{self, User};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use tower_sessions::Session;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub id: Uuid,
    pub user: User,
    pub access_token: String,
    pub access_secret: String,
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|(_, e)| AppError::Internal(anyhow::anyhow!("session extraction failed: {e}")))?;

        let user_id: Option<Uuid> = session
            .get("user_id")
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("session.get user_id: {e}")))?;
        let user_id = user_id.ok_or(AppError::Unauthorized)?;

        let user = users::find_by_id(&state.pool, user_id)
            .await?
            .ok_or(AppError::Unauthorized)?;

        let (access_token, access_secret) =
            decrypt_user_oauth(&user, &state.cfg.encryption_key).map_err(AppError::Internal)?;

        Ok(Self {
            id: user_id,
            user,
            access_token,
            access_secret,
        })
    }
}
