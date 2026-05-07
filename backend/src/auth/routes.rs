//! HTTP handlers for the OAuth 1.0a flow:
//!   GET  /auth/login    — redirect to CC's authorize URL after fetching a request token
//!   GET  /auth/callback — exchange request token for access token, fetch /v2/self, upsert user, set session
//!   POST /auth/logout   — destroy session
//!
//! The request token *secret* is stashed during /auth/login in an HTTP-only,
//! AES-GCM-encrypted cookie (`oauth_state`, 5 min TTL). This avoids needing a
//! Postgres-backed session round-trip before authentication completes, and
//! works the same on every backend instance (cookie is self-contained).

use crate::auth::{encryption, oauth};
use crate::db::users;
use crate::error::AppError;
use crate::state::AppState;
use axum::Router;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use base64::Engine;
use serde::Deserialize;
use tower_sessions::Session;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/logout", post(logout))
}

async fn login(State(state): State<AppState>) -> Result<Response, AppError> {
    let (oauth_token, oauth_token_secret) =
        oauth::request_temporary_token(&state.cfg, &state.http)
            .await
            .map_err(|e| AppError::CcApi(format!("request_token failed: {e}")))?;

    let (encrypted, nonce) = encryption::encrypt(
        oauth_token_secret.as_bytes(),
        &state.cfg.encryption_key,
    )
    .map_err(AppError::Internal)?;

    let mut cookie_value = Vec::with_capacity(nonce.len() + encrypted.len());
    cookie_value.extend_from_slice(&nonce);
    cookie_value.extend_from_slice(&encrypted);
    let cookie_b64 =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&cookie_value);

    let authorize_url = format!(
        "{}/v2/oauth/authorize?oauth_token={}",
        state.cfg.cc_api_base_url, oauth_token
    );

    let secure = if state.cfg.cookie_secure() { "; Secure" } else { "" };
    let cookie = format!(
        "oauth_state={cookie_b64}; Path=/; HttpOnly{secure}; SameSite=Lax; Max-Age=300"
    );

    Ok((
        StatusCode::SEE_OTHER,
        [
            (header::LOCATION, authorize_url),
            (header::SET_COOKIE, cookie),
        ],
    )
        .into_response())
}

#[derive(Deserialize)]
struct CallbackParams {
    oauth_token: String,
    oauth_verifier: String,
}

#[derive(Deserialize)]
struct CcSelf {
    id: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

async fn callback(
    State(state): State<AppState>,
    session: Session,
    Query(params): Query<CallbackParams>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    // Decrypt the oauth_state cookie set during /auth/login.
    let cookie_header = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let oauth_state = cookie_header
        .split(';')
        .map(|s| s.trim())
        .find(|s| s.starts_with("oauth_state="))
        .and_then(|s| s.strip_prefix("oauth_state="))
        .ok_or_else(|| AppError::BadRequest("missing oauth_state cookie".to_string()))?;

    let cookie_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(oauth_state)
        .map_err(|_| AppError::BadRequest("invalid oauth_state cookie".to_string()))?;

    if cookie_bytes.len() < 13 {
        return Err(AppError::BadRequest("oauth_state cookie too short".to_string()));
    }

    let (nonce, ciphertext) = cookie_bytes.split_at(12);
    let request_token_secret =
        encryption::decrypt(ciphertext, nonce, &state.cfg.encryption_key)
            .map_err(|_| AppError::BadRequest("failed to decrypt oauth_state".to_string()))?;
    let request_token_secret = String::from_utf8(request_token_secret)
        .map_err(|_| AppError::BadRequest("invalid oauth_token_secret bytes".to_string()))?;

    // Exchange request token + verifier for access token.
    let (access_token, access_secret) = oauth::exchange_access_token(
        &state.cfg,
        &state.http,
        &params.oauth_token,
        &request_token_secret,
        &params.oauth_verifier,
    )
    .await
    .map_err(|e| AppError::CcApi(format!("access_token failed: {e}")))?;

    // Fetch /v2/self to learn who this is.
    let self_url = format!("{}/v2/self", state.cfg.cc_api_base_url);
    let auth_header = oauth::sign_api_request(
        "GET",
        &self_url,
        &state.cfg.cc_consumer_key,
        &state.cfg.cc_consumer_secret,
        &access_token,
        &access_secret,
    );
    let resp = state
        .http
        .get(&self_url)
        .header(header::AUTHORIZATION, auth_header)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::CcApi(format!("/v2/self {status}: {body}")));
    }
    let me: CcSelf = resp.json().await?;

    // Encrypt access (token, secret) with two distinct nonces, concat into a single 24-byte field.
    let (token_enc, token_nonce) =
        encryption::encrypt(access_token.as_bytes(), &state.cfg.encryption_key)
            .map_err(AppError::Internal)?;
    let (secret_enc, secret_nonce) =
        encryption::encrypt(access_secret.as_bytes(), &state.cfg.encryption_key)
            .map_err(AppError::Internal)?;
    let mut combined_nonce = Vec::with_capacity(24);
    combined_nonce.extend_from_slice(&token_nonce);
    combined_nonce.extend_from_slice(&secret_nonce);

    let user = users::upsert(
        &state.pool,
        &me.id,
        me.email.as_deref(),
        me.name.as_deref(),
        &token_enc,
        &secret_enc,
        &combined_nonce,
    )
    .await?;

    session
        .insert("user_id", user.id)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("session insert failed: {e}")))?;

    // Clear the oauth_state cookie and redirect to the frontend.
    let secure = if state.cfg.cookie_secure() { "; Secure" } else { "" };
    let clear_cookie =
        format!("oauth_state=; Path=/; HttpOnly{secure}; SameSite=Lax; Max-Age=0");
    let redirect_url = format!(
        "{}/orgs",
        state.cfg.public_base_url.trim_end_matches('/')
    );

    Ok((
        StatusCode::SEE_OTHER,
        [
            (header::LOCATION, redirect_url),
            (header::SET_COOKIE, clear_cookie),
        ],
    )
        .into_response())
}

async fn logout(session: Session) -> Result<StatusCode, AppError> {
    session
        .delete()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("session delete failed: {e}")))?;
    Ok(StatusCode::OK)
}
