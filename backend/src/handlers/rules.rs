//! /api/rules CRUD + versions + restore + test endpoints.

use crate::auth::AuthenticatedUser;
use crate::db::rule_firings::{self, RuleFiring};
use crate::db::rules::{self, Rule, RuleVersion};
use crate::error::AppError;
use crate::rules::condition::{Action, Condition, validate_actions, validate_condition};
use crate::rules::cycle::{self, PendingRule};
use crate::rules::debug::{self as rule_debug, RuleDebugResponse};
use crate::rules::dependencies;
use crate::rules::exec::{self, DryRunResult};
use crate::state::AppState;
use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/rules", get(list).post(create))
        .route("/api/rules/{id}", get(read).put(update).delete(delete))
        .route("/api/rules/{id}/firings", get(recent_firings))
        .route("/api/rules/{id}/versions", get(list_versions))
        .route(
            "/api/rules/{id}/versions/{version_id}/restore",
            post(restore_version),
        )
        .route("/api/rules/{id}/test", post(test_dry_run))
        .route("/api/rules/{id}/debug", get(get_debug))
}

#[derive(Debug, Deserialize)]
pub struct UpsertInput {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub is_enabled: bool,
    pub condition: Condition,
    pub actions: Vec<Action>,
    #[serde(default = "default_cooldown")]
    pub cooldown_seconds: i32,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub comment: Option<String>,
}

fn default_enabled() -> bool {
    true
}
fn default_cooldown() -> i32 {
    300
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<Rule>>, AppError> {
    Ok(Json(rules::list_for_user(&state.pool, auth.id).await?))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(input): Json<UpsertInput>,
) -> Result<Json<Rule>, AppError> {
    save_inner(&state, auth.id, None, input).await.map(Json)
}

async fn read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Rule>, AppError> {
    let rule = rules::find(&state.pool, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(rule))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpsertInput>,
) -> Result<Json<Rule>, AppError> {
    save_inner(&state, auth.id, Some(id), input).await.map(Json)
}

async fn delete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = rules::delete(&state.pool, auth.id, id).await?;
    if n == 0 {
        Err(AppError::NotFound(format!("rule {id}")))
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

async fn recent_firings(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<RuleFiring>>, AppError> {
    Ok(Json(
        rule_firings::list_recent_for_rule(&state.pool, auth.id, id, 50).await?,
    ))
}

async fn list_versions(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<RuleVersion>>, AppError> {
    Ok(Json(rules::list_versions(&state.pool, auth.id, id).await?))
}

async fn restore_version(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path((id, version_id)): Path<(Uuid, String)>,
) -> Result<Json<Rule>, AppError> {
    let payload = rules::find_version_payload(&state.pool, auth.id, id, &version_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id} version {version_id}")))?;
    // Parse the stored Rule snapshot back into UpsertInput shape.
    let snap: Rule = serde_json::from_value(payload).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let condition: Condition = serde_json::from_value(snap.condition.clone())
        .map_err(|e| AppError::BadRequest(format!("decode condition: {e}")))?;
    let actions: Vec<Action> = serde_json::from_value(snap.actions.clone())
        .map_err(|e| AppError::BadRequest(format!("decode actions: {e}")))?;
    let restored = save_inner(
        &state,
        auth.id,
        Some(id),
        UpsertInput {
            name: snap.name,
            is_enabled: snap.is_enabled,
            condition,
            actions,
            cooldown_seconds: snap.cooldown_seconds,
            metadata: snap.metadata,
            comment: Some(format!("restore from {version_id}")),
        },
    )
    .await?;
    Ok(Json(restored))
}

async fn test_dry_run(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<DryRunResult>, AppError> {
    let rule = rules::find(&state.pool, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(
        exec::evaluate_dry(&state, &rule)
            .await
            .map_err(AppError::Internal)?,
    ))
}

async fn get_debug(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<RuleDebugResponse>, AppError> {
    let rule = rules::find(&state.pool, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(
        rule_debug::build(&state, auth.id, &rule)
            .await
            .map_err(AppError::Internal)?,
    ))
}

/// Shared save path between the REST handler and the MCP server. Validates
/// the rule (name, cooldown, condition tree, action shapes, cross-tenant
/// refs, static DAG cycle) and persists it with its dependency index.
pub async fn save_inner(
    state: &AppState,
    user_id: Uuid,
    id: Option<Uuid>,
    input: UpsertInput,
) -> Result<Rule, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".to_string()));
    }
    if input.cooldown_seconds < 0 {
        return Err(AppError::BadRequest("cooldown must be >= 0".to_string()));
    }
    validate_condition(&input.condition).map_err(AppError::BadRequest)?;
    validate_actions(&input.actions).map_err(AppError::BadRequest)?;

    // Reject cross-user references in actions (target monitor / channel / target rule).
    validate_action_refs(state, user_id, &input.actions).await?;

    // Static cycle detection.
    cycle::check_no_cycle(
        &state.pool,
        user_id,
        PendingRule {
            id,
            condition: &input.condition,
            actions: &input.actions,
        },
    )
    .await
    .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let condition_json = serde_json::to_value(&input.condition).map_err(AppError::from)?;
    let actions_json = serde_json::to_value(&input.actions).map_err(AppError::from)?;
    let deps = dependencies::extract(&input.condition);

    Ok(rules::save(
        &state.pool,
        user_id,
        id,
        input.name.trim(),
        input.is_enabled,
        &condition_json,
        &actions_json,
        input.cooldown_seconds,
        input.metadata.as_ref(),
        &deps,
        input.comment.as_deref(),
    )
    .await?)
}

async fn validate_action_refs(
    state: &AppState,
    user_id: Uuid,
    actions: &[Action],
) -> Result<(), AppError> {
    // Collect the distinct ids referenced per ref-kind, then verify each set
    // with a single `= ANY($1)` query rather than one round-trip per action.
    let mut monitor_ids = Vec::new();
    let mut rule_ids = Vec::new();
    let mut channel_ids = Vec::new();
    for action in actions {
        match action {
            Action::SetMonitorState { target_monitor_id, .. } => monitor_ids.push(*target_monitor_id),
            Action::Escalate { target_rule_id, .. } => rule_ids.push(*target_rule_id),
            Action::SendNotification { channel_id, .. } => channel_ids.push(*channel_id),
        }
    }

    all_owned(state, user_id, "monitors", &mut monitor_ids).await?;
    all_owned(state, user_id, "rules", &mut rule_ids).await?;
    all_owned(state, user_id, "notification_channels", &mut channel_ids).await?;
    Ok(())
}

/// Returns Ok only if every id in `ids` exists in `table` for `user_id`.
/// `ids` is sorted/deduped in place. `table` is a hard-coded literal from the
/// caller — never user input — so interpolating it into the query is safe.
async fn all_owned(
    state: &AppState,
    user_id: Uuid,
    table: &str,
    ids: &mut Vec<Uuid>,
) -> Result<(), AppError> {
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(());
    }
    let found: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM {table} WHERE user_id = $1 AND id = ANY($2)"
    ))
    .bind(user_id)
    .bind(&*ids)
    .fetch_one(&state.pool)
    .await?;
    if (found as usize) != ids.len() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
