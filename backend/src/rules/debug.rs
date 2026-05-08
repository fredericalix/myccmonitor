//! Diagnostic snapshot for a rule. Powers `GET /api/rules/:id/debug`.
//!
//! Walks the condition tree, fetches every referenced monitor/group/channel
//! live, evaluates the condition once, and reports the verdict + cooldown
//! state + recent firings + channel health. Pure-read; never mutates state.

use crate::db::monitors::Monitor;
use crate::db::notification_channels::NotificationChannel;
use crate::db::rule_firings::{self, RuleFiring};
use crate::db::rules::Rule;
use crate::groups::compute_view;
use crate::rules::condition::{Action, CompOp, Condition, LogicalOp};
use crate::rules::dependencies;
use crate::rules::evaluator::evaluate;
use crate::rules::field::{self, FieldValue};
use crate::state::AppState;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct RuleDebugResponse {
    pub rule: Rule,
    pub would_match_now: bool,
    pub condition_summary: Value,
    pub cooldown: CooldownState,
    pub recent_firings: Vec<RuleFiring>,
    pub monitors_referenced: Vec<MonitorDebugInfo>,
    pub groups_referenced: Vec<GroupDebugInfo>,
    pub channels_used: Vec<ChannelDebugInfo>,
}

#[derive(Debug, Serialize)]
pub struct CooldownState {
    pub remaining_seconds: i64,
    pub cooldown_seconds: i64,
    pub last_fired_at: Option<DateTime<Utc>>,
    pub last_outcome_state: Option<String>,
    pub would_skip_due_to_cooldown: bool,
}

#[derive(Debug, Serialize)]
pub struct MonitorDebugInfo {
    pub id: Uuid,
    pub display_name: String,
    pub kind: String,
    pub current_state: String,
    pub current_state_since: Option<DateTime<Utc>>,
    pub current_message: Option<String>,
    pub held_for_seconds: i64,
}

#[derive(Debug, Serialize)]
pub struct GroupDebugInfo {
    pub id: Uuid,
    pub name: String,
    pub rolled_state: String,
    pub critical_count: u32,
    pub warning_count: u32,
    pub ok_count: u32,
    pub unknown_count: u32,
    pub total: u32,
    pub member_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ChannelDebugInfo {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    pub failure_count: i32,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_failure_at: Option<DateTime<Utc>>,
    pub last_failure_message: Option<String>,
}

pub async fn build(state: &AppState, user_id: Uuid, rule: &Rule) -> Result<RuleDebugResponse> {
    let condition: Condition = serde_json::from_value(rule.condition.clone())?;
    let actions: Vec<Action> = serde_json::from_value(rule.actions.clone())?;

    // Live verdict (used both for the would_match flag and for the cooldown
    // hint; matches what `execute_rule` would do at this exact moment).
    let would_match_now = evaluate(&state.pool, user_id, &condition).await?;

    // Cooldown state computation, mirrors execute_rule.
    let now = Utc::now();
    let cooldown = compute_cooldown(rule, now, would_match_now);

    // Walk the condition tree to attach live values + per-leaf verdicts.
    let condition_summary = trace(&state.pool, user_id, &condition).await;

    // Monitors / groups referenced in the condition tree.
    let mut monitors_referenced = Vec::new();
    let mut groups_referenced = Vec::new();
    for (kind, id) in dependencies::extract(&condition) {
        match kind.as_str() {
            "monitor" => {
                if let Some(info) = monitor_debug_info(state, user_id, id).await? {
                    monitors_referenced.push(info);
                }
            }
            "group" => {
                if let Some(info) = group_debug_info(state, user_id, id).await? {
                    groups_referenced.push(info);
                }
            }
            _ => {}
        }
    }

    // Channels referenced by send_notification actions.
    let mut seen_channels: HashSet<Uuid> = HashSet::new();
    let mut channels_used = Vec::new();
    for action in &actions {
        if let Action::SendNotification { channel_id, .. } = action {
            if seen_channels.insert(*channel_id) {
                if let Some(c) =
                    crate::db::notification_channels::find(&state.pool, user_id, *channel_id)
                        .await?
                {
                    channels_used.push(channel_to_debug(c));
                }
            }
        }
    }

    let recent_firings =
        rule_firings::list_recent_for_rule(&state.pool, user_id, rule.id, 10).await?;

    Ok(RuleDebugResponse {
        rule: rule.clone(),
        would_match_now,
        condition_summary,
        cooldown,
        recent_firings,
        monitors_referenced,
        groups_referenced,
        channels_used,
    })
}

fn compute_cooldown(rule: &Rule, now: DateTime<Utc>, would_match_now: bool) -> CooldownState {
    let cooldown_seconds = rule.cooldown_seconds as i64;
    let (remaining_seconds, would_skip) = match (rule.last_fired_at, rule.last_outcome_state.as_deref()) {
        (Some(last), Some(prev)) => {
            let elapsed = now.signed_duration_since(last).num_seconds();
            let remaining = (cooldown_seconds - elapsed).max(0);
            let in_cooldown = elapsed < cooldown_seconds;
            let verdict_unchanged = prev == "matched";
            let would_skip = would_match_now && in_cooldown && verdict_unchanged;
            (remaining, would_skip)
        }
        _ => (0, false),
    };
    CooldownState {
        remaining_seconds,
        cooldown_seconds,
        last_fired_at: rule.last_fired_at,
        last_outcome_state: rule.last_outcome_state.clone(),
        would_skip_due_to_cooldown: would_skip,
    }
}

async fn trace(pool: &sqlx::PgPool, user_id: Uuid, condition: &Condition) -> Value {
    match condition {
        Condition::Comparison {
            field,
            operator,
            value,
            for_duration,
        } => {
            let parsed = field::parse(field);
            let (actual, verdict, parse_error) = match &parsed {
                Ok(r) => match field::fetch(pool, user_id, r).await {
                    Ok(live) => {
                        let verdict = compare_for_trace(&live, *operator, value);
                        (field_value_to_json(&live), verdict, None)
                    }
                    Err(e) => (Value::Null, false, Some(format!("fetch error: {e}"))),
                },
                Err(e) => (Value::Null, false, Some(e.clone())),
            };
            json!({
                "type": "comparison",
                "field": field,
                "operator": format!("{operator:?}").to_lowercase(),
                "expected": value,
                "actual": actual,
                "verdict": verdict,
                "for_duration_seconds": for_duration.as_ref().map(|d| d.seconds),
                "parse_error": parse_error,
            })
        }
        Condition::Logical { op, children } => {
            let mut child_traces = Vec::with_capacity(children.len());
            let mut any = false;
            let mut all = true;
            for c in children {
                let t = Box::pin(trace(pool, user_id, c)).await;
                let v = t.get("verdict").and_then(|x| x.as_bool()).unwrap_or(false);
                any = any || v;
                all = all && v;
                child_traces.push(t);
            }
            let verdict = match op {
                LogicalOp::And => all,
                LogicalOp::Or => any,
            };
            json!({
                "type": "logical",
                "op": format!("{op:?}").to_lowercase(),
                "verdict": verdict,
                "children": child_traces,
            })
        }
    }
}

fn field_value_to_json(v: &FieldValue) -> Value {
    match v {
        FieldValue::String(s) => Value::String(s.clone()),
        FieldValue::Bool(b) => Value::Bool(*b),
        FieldValue::Number(n) => json!(n),
        FieldValue::Null => Value::Null,
    }
}

fn compare_for_trace(live: &FieldValue, op: CompOp, expected: &Value) -> bool {
    // Replicate evaluator::compare without re-importing private fn.
    use FieldValue::*;
    match (live, expected) {
        (Null, _) => false,
        (String(s), Value::String(t)) => match op {
            CompOp::Eq => s == t,
            CompOp::Neq => s != t,
            CompOp::Contains => s.contains(t.as_str()),
            CompOp::NotContains => !s.contains(t.as_str()),
            _ => false,
        },
        (Bool(b), Value::Bool(t)) => match op {
            CompOp::Eq => b == t,
            CompOp::Neq => b != t,
            _ => false,
        },
        (Number(n), Value::Number(t)) => {
            let Some(t) = t.as_f64() else {
                return false;
            };
            match op {
                CompOp::Eq => (n - t).abs() < f64::EPSILON,
                CompOp::Neq => (n - t).abs() >= f64::EPSILON,
                CompOp::Gt => *n > t,
                CompOp::Gte => *n >= t,
                CompOp::Lt => *n < t,
                CompOp::Lte => *n <= t,
                _ => false,
            }
        }
        (live, expected) => match op {
            CompOp::Eq => format!("{live:?}") == format!("{expected:?}"),
            CompOp::Neq => format!("{live:?}") != format!("{expected:?}"),
            _ => false,
        },
    }
}

async fn monitor_debug_info(
    state: &AppState,
    user_id: Uuid,
    monitor_id: Uuid,
) -> Result<Option<MonitorDebugInfo>> {
    let m: Option<Monitor> = sqlx::query_as::<_, Monitor>(
        "SELECT * FROM monitors WHERE id = $1 AND user_id = $2",
    )
    .bind(monitor_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(m) = m else { return Ok(None) };

    let held_for_seconds = match m.current_state_since {
        Some(since) => Utc::now().signed_duration_since(since).num_seconds().max(0),
        None => 0,
    };

    Ok(Some(MonitorDebugInfo {
        id: m.id,
        display_name: m.display_name,
        kind: m.kind,
        current_state: m.current_state,
        current_state_since: m.current_state_since,
        current_message: m.current_message,
        held_for_seconds,
    }))
}

async fn group_debug_info(
    state: &AppState,
    user_id: Uuid,
    group_id: Uuid,
) -> Result<Option<GroupDebugInfo>> {
    let Some(group) = crate::db::monitor_groups::find(&state.pool, user_id, group_id).await? else {
        return Ok(None);
    };
    let user_monitors = sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
    let view = compute_view(&state.pool, user_id, group, &user_monitors).await?;
    Ok(Some(GroupDebugInfo {
        id: view.group.id,
        name: view.group.name.clone(),
        rolled_state: format!("{:?}", view.rolled_state).to_lowercase(),
        critical_count: view.state_breakdown.critical,
        warning_count: view.state_breakdown.warning,
        ok_count: view.state_breakdown.ok,
        unknown_count: view.state_breakdown.unknown,
        total: view.state_breakdown.total,
        member_ids: view.member_ids,
    }))
}

fn channel_to_debug(c: NotificationChannel) -> ChannelDebugInfo {
    ChannelDebugInfo {
        id: c.id,
        name: c.name,
        kind: c.kind,
        enabled: c.enabled,
        failure_count: c.failure_count,
        last_success_at: c.last_success_at,
        last_failure_at: c.last_failure_at,
        last_failure_message: c.last_failure_message,
    }
}

