//! Top-level execution entry points: `trigger_for_monitor` (called from the
//! webhook consumer + the poller after a state-mutating event) and
//! `execute_rule` (called per matching rule with cooldown, action exec,
//! recursive chain).

use crate::db::{rule_firings, rules};
use crate::rules::actions;
use crate::rules::condition::{Action, Condition};
use crate::rules::evaluator::evaluate;
use crate::state::AppState;
use crate::ws::{self, WsFrame};
use anyhow::Result;
use chrono::Utc;
use dashmap::DashSet;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_CHAIN_DEPTH: u32 = 8;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    MonitorUpdate { monitor_id: Uuid },
    RuleChain { from_rule_id: Uuid },
    Poll { monitor_id: Uuid },
    Webhook,
    Escalation { from_rule_id: Uuid },
    Test,
}

impl Trigger {
    pub fn kind(&self) -> &'static str {
        match self {
            Trigger::MonitorUpdate { .. } => "monitor_update",
            Trigger::RuleChain { .. } => "rule_chain",
            Trigger::Poll { .. } => "poll",
            Trigger::Webhook => "webhook",
            Trigger::Escalation { .. } => "escalation",
            Trigger::Test => "test",
        }
    }

    pub fn ref_id(&self) -> Option<Uuid> {
        match self {
            Trigger::MonitorUpdate { monitor_id } | Trigger::Poll { monitor_id } => Some(*monitor_id),
            Trigger::RuleChain { from_rule_id } | Trigger::Escalation { from_rule_id } => {
                Some(*from_rule_id)
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Matched,
    NotMatched,
    CooldownSkipped,
    Error,
}

/// In-flight set of monitor ids currently being mutated by a chain. The same
/// monitor must not be SetMonitorState'd twice in one chain.
#[derive(Default)]
pub struct InFlight {
    inner: DashSet<Uuid>,
}

impl InFlight {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub fn contains(&self, id: Uuid) -> bool {
        self.inner.contains(&id)
    }
    pub fn insert(&self, id: Uuid) {
        self.inner.insert(id);
    }
    pub fn remove(&self, id: Uuid) {
        self.inner.remove(&id);
    }
}

/// Public entrypoint. Called by the consumer (after a webhook-driven state
/// change) and the poller (after a metric_samples write). Triggers all rules
/// that depend on `monitor_id`, with chain depth 0.
pub async fn trigger_for_monitor(
    state: &AppState,
    user_id: Uuid,
    monitor_id: Uuid,
    trigger: Trigger,
) -> Result<u32> {
    let in_flight = InFlight::new();
    trigger_for_monitor_with_depth(state, user_id, monitor_id, trigger, 0, &in_flight).await
}

pub async fn trigger_for_monitor_with_depth(
    state: &AppState,
    user_id: Uuid,
    monitor_id: Uuid,
    trigger: Trigger,
    chain_depth: u32,
    in_flight: &InFlight,
) -> Result<u32> {
    // Inverse-lookup: which enabled rules of THIS user watch this monitor (directly
    // or via a group whose membership covers it)?
    let direct_rule_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT d.rule_id
        FROM rule_dependencies d
        JOIN rules r ON r.id = d.rule_id
        WHERE r.user_id = $1
          AND r.is_enabled = TRUE
          AND d.ref_kind = 'monitor'
          AND d.ref_id = $2
        "#,
    )
    .bind(user_id)
    .bind(monitor_id)
    .fetch_all(&state.pool)
    .await?;

    let group_rule_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT d.rule_id
        FROM rule_dependencies d
        JOIN rules r ON r.id = d.rule_id
        WHERE r.user_id = $1
          AND r.is_enabled = TRUE
          AND d.ref_kind = 'group'
          AND d.ref_id IN (
              SELECT g.id FROM monitor_groups g
              WHERE g.user_id = $1
                AND (
                    EXISTS (
                        SELECT 1 FROM monitor_group_members mgm
                        WHERE mgm.group_id = g.id AND mgm.monitor_id = $2
                    )
                    OR g.auto_rules IS NOT NULL  -- conservative: re-eval auto-grouped rules; they'll filter inside
                )
          )
        "#,
    )
    .bind(user_id)
    .bind(monitor_id)
    .fetch_all(&state.pool)
    .await?;

    let direct_count = direct_rule_ids.len();
    let group_count = group_rule_ids.len();
    let mut all_rule_ids = direct_rule_ids;
    all_rule_ids.extend(group_rule_ids);
    all_rule_ids.sort();
    all_rule_ids.dedup();

    tracing::info!(
        %monitor_id,
        %user_id,
        chain_depth,
        trigger_kind = trigger.kind(),
        direct_count,
        group_count,
        unique_rule_count = all_rule_ids.len(),
        "trigger_for_monitor: dependent rules looked up"
    );

    let mut fired = 0u32;
    for rule_id in all_rule_ids {
        let rule = match rules::find(&state.pool, user_id, rule_id).await? {
            Some(r) => r,
            None => continue,
        };
        let outcome = execute_rule(state, &rule, trigger, chain_depth, in_flight).await?;
        tracing::info!(
            %rule_id,
            rule_name = %rule.name,
            outcome = ?outcome,
            "rule evaluated"
        );
        if matches!(outcome, Outcome::Matched) {
            fired += 1;
        }
    }
    Ok(fired)
}

pub async fn execute_rule(
    state: &AppState,
    rule: &rules::Rule,
    trigger: Trigger,
    chain_depth: u32,
    in_flight: &InFlight,
) -> Result<Outcome> {
    if !rule.is_enabled {
        tracing::info!(rule_id = %rule.id, rule_name = %rule.name, "rule disabled; skipping");
        return Ok(Outcome::NotMatched);
    }

    tracing::info!(
        rule_id = %rule.id,
        rule_name = %rule.name,
        chain_depth,
        trigger_kind = trigger.kind(),
        "execute_rule entry"
    );

    let condition: Condition = serde_json::from_value(rule.condition.clone())?;
    let actions: Vec<Action> = serde_json::from_value(rule.actions.clone())?;

    // Evaluate
    let matched = evaluate(&state.pool, rule.user_id, &condition).await?;
    tracing::info!(
        rule_id = %rule.id,
        rule_name = %rule.name,
        matched,
        action_count = actions.len(),
        "condition evaluated"
    );

    // Cooldown: skip if last_fired_at + cooldown > now AND the verdict hasn't
    // changed (recovery-exempt: we always let a transition fire).
    if matched {
        if let (Some(last), Some(prev)) = (rule.last_fired_at, rule.last_outcome_state.as_ref()) {
            let elapsed = Utc::now().signed_duration_since(last).num_seconds();
            let in_cooldown = elapsed < rule.cooldown_seconds as i64;
            let verdict_unchanged = prev == "matched";
            if in_cooldown && verdict_unchanged {
                tracing::info!(
                    rule_id = %rule.id,
                    rule_name = %rule.name,
                    elapsed_seconds = elapsed,
                    cooldown_seconds = rule.cooldown_seconds,
                    "cooldown active and verdict unchanged; skipping"
                );
                rule_firings::insert(
                    &state.pool,
                    rule.id,
                    rule.user_id,
                    trigger.kind(),
                    trigger.ref_id(),
                    "cooldown_skipped",
                    None,
                    None,
                )
                .await?;
                return Ok(Outcome::CooldownSkipped);
            }
        }
    }

    if !matched {
        // Record only if state changes — keeps the audit log signal-rich.
        if rule.last_outcome_state.as_deref() != Some("not_matched") {
            rule_firings::insert(
                &state.pool,
                rule.id,
                rule.user_id,
                trigger.kind(),
                trigger.ref_id(),
                "not_matched",
                None,
                None,
            )
            .await?;
            rules::update_outcome(&state.pool, rule.id, "not_matched", false).await?;
        }
        return Ok(Outcome::NotMatched);
    }

    // Matched: execute actions in parallel.
    let mut summaries = Vec::with_capacity(actions.len());
    let mut had_error = false;
    let mut error_messages: Vec<String> = Vec::new();
    for action in &actions {
        match actions::execute(state, rule.id, rule.user_id, action, in_flight, chain_depth, None)
            .await
        {
            Ok(summary) => summaries.push(summary),
            Err(e) => {
                tracing::error!(error = ?e, rule_id = %rule.id, "action execution failed");
                error_messages.push(format!("{e}"));
                had_error = true;
            }
        }
    }

    tracing::info!(
        rule_id = %rule.id,
        rule_name = %rule.name,
        action_count = actions.len(),
        had_error,
        "actions executed"
    );

    let outcome = if had_error { "error" } else { "matched" };
    rule_firings::insert(
        &state.pool,
        rule.id,
        rule.user_id,
        trigger.kind(),
        trigger.ref_id(),
        outcome,
        Some(serde_json::Value::Array(summaries.clone())),
        if had_error {
            Some(error_messages.join("; "))
        } else {
            None
        },
    )
    .await?;
    rules::update_outcome(&state.pool, rule.id, "matched", true).await?;

    let _ = ws::broadcast_via_pg_ignore_error(
        &state.pool,
        WsFrame::RuleFiring {
            rule_id: rule.id,
            rule_name: rule.name.clone(),
            outcome: outcome.to_string(),
            fired_at: Utc::now(),
            trigger_kind: trigger.kind().to_string(),
            trigger_ref: trigger.ref_id(),
        },
    )
    .await;

    Ok(if had_error {
        Outcome::Error
    } else {
        Outcome::Matched
    })
}

/// Dry-run: evaluate but don't execute actions or record firings.
pub async fn evaluate_dry(
    state: &AppState,
    rule: &rules::Rule,
) -> Result<DryRunResult> {
    let condition: Condition = serde_json::from_value(rule.condition.clone())?;
    let actions: Vec<Action> = serde_json::from_value(rule.actions.clone())?;
    let matched = evaluate(&state.pool, rule.user_id, &condition).await?;
    Ok(DryRunResult {
        matched,
        actions_that_would_run: if matched { actions.len() } else { 0 },
    })
}

#[derive(Debug, Serialize)]
pub struct DryRunResult {
    pub matched: bool,
    pub actions_that_would_run: usize,
}
