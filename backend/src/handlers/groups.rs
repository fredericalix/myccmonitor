//! /api/groups CRUD + member operations.

use crate::auth::AuthenticatedUser;
use crate::db::monitor_groups::{self, CreateGroup, UpdateGroup};
use crate::db::monitors::Monitor;
use crate::error::AppError;
use crate::groups::{GroupView, compute_view};
use crate::state::AppState;
use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/groups", get(list).post(create))
        .route("/api/groups/{id}", get(read).put(update).delete(delete))
        .route(
            "/api/groups/{id}/members/{monitor_id}",
            post(add_member).delete(remove_member),
        )
}

async fn all_user_monitors(pool: &PgPool, user_id: Uuid) -> Result<Vec<Monitor>, AppError> {
    sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<GroupView>>, AppError> {
    let groups = monitor_groups::list_for_user(&state.pool, auth.id).await?;
    let monitors = all_user_monitors(&state.pool, auth.id).await?;
    let mut out = Vec::with_capacity(groups.len());
    for group in groups {
        let view = compute_view(&state.pool, auth.id, group, &monitors)
            .await
            .map_err(AppError::Internal)?;
        out.push(view);
    }
    Ok(Json(out))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(input): Json<CreateGroup>,
) -> Result<Json<GroupView>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".to_string()));
    }
    let group = monitor_groups::create(&state.pool, auth.id, &input).await?;
    let monitors = all_user_monitors(&state.pool, auth.id).await?;
    let view = compute_view(&state.pool, auth.id, group, &monitors)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(view))
}

async fn read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<GroupView>, AppError> {
    let group = monitor_groups::find(&state.pool, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("group {id}")))?;
    let monitors = all_user_monitors(&state.pool, auth.id).await?;
    let view = compute_view(&state.pool, auth.id, group, &monitors)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(view))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateGroup>,
) -> Result<Json<GroupView>, AppError> {
    let group = monitor_groups::update(&state.pool, auth.id, id, &input)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("group {id}")))?;
    let monitors = all_user_monitors(&state.pool, auth.id).await?;
    let view = compute_view(&state.pool, auth.id, group, &monitors)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(view))
}

async fn delete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = monitor_groups::delete(&state.pool, auth.id, id).await?;
    if n == 0 {
        Err(AppError::NotFound(format!("group {id}")))
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

async fn add_member(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path((group_id, monitor_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let ok = monitor_groups::add_member(&state.pool, auth.id, group_id, monitor_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path((group_id, monitor_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    monitor_groups::remove_member(&state.pool, auth.id, group_id, monitor_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
