//! /api/channels CRUD for notification channels.

use crate::auth::AuthenticatedUser;
use crate::db::notification_channels::{self, NotificationChannel, UpsertChannel};
use crate::error::AppError;
use crate::notifications::adapters;
use crate::state::AppState;
use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/channels", get(list).post(create))
        .route("/api/channels/{id}", get(read).put(update).delete(delete))
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<NotificationChannel>>, AppError> {
    Ok(Json(
        notification_channels::list_for_user(&state.pool, auth.id).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(input): Json<UpsertChannel>,
) -> Result<Json<NotificationChannel>, AppError> {
    validate(&input)?;
    Ok(Json(
        notification_channels::create(&state.pool, auth.id, &input).await?,
    ))
}

async fn read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<NotificationChannel>, AppError> {
    let c = notification_channels::find(&state.pool, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("channel {id}")))?;
    Ok(Json(c))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpsertChannel>,
) -> Result<Json<NotificationChannel>, AppError> {
    validate(&input)?;
    let c = notification_channels::update(&state.pool, auth.id, id, &input)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("channel {id}")))?;
    Ok(Json(c))
}

async fn delete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = notification_channels::delete(&state.pool, auth.id, id).await?;
    if n == 0 {
        Err(AppError::NotFound(format!("channel {id}")))
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

fn validate(input: &UpsertChannel) -> Result<(), AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".into()));
    }
    adapters::validate_config(&input.kind, &input.config).map_err(AppError::BadRequest)
}
