//! JSON-serialisable Condition + Action types — the contract between the
//! rule editor (Phase 7), the storage layer (rules.condition / rules.actions
//! JSONB), and the runtime evaluator.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompOp {
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    NotContains,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogicalOp {
    And,
    Or,
}

/// `{ seconds: 300 }` — duration for time-based conditions like
/// `monitor:X:state == critical for 5m`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct DurationSpec {
    pub seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Condition {
    Comparison {
        /// `monitor:{uuid}:property` or `group:{uuid}:property`.
        field: String,
        operator: CompOp,
        value: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        for_duration: Option<DurationSpec>,
    },
    Logical {
        op: LogicalOp,
        children: Vec<Condition>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    /// Mutate the state of a monitor (CC-backed or synthetic). Chains: every
    /// rule that watches this monitor is re-evaluated, with anti-loop guards.
    SetMonitorState {
        target_monitor_id: Uuid,
        state: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        acknowledged: Option<bool>,
    },
    /// Send a notification. Phase 6 inserts an `alerts` row; Phase 9 wires
    /// the actual delivery (email, Slack, Discord, webhook).
    SendNotification {
        channel_id: Uuid,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subject: Option<String>,
    },
    /// Defer + re-evaluate another rule. Phase 6 logs + stubs; Phase 8 wires
    /// the actual delayed-message delivery via the Pulsar `rule-escalations`
    /// topic.
    Escalate {
        delay_seconds: u32,
        target_rule_id: Uuid,
    },
}

/// Validate the static shape: at least one action, well-formed condition tree.
/// Cross-user reference checks happen at save time in `db::rules::save`.
pub fn validate_condition(c: &Condition) -> Result<(), String> {
    match c {
        Condition::Comparison { field, .. } => {
            if !field.starts_with("monitor:") && !field.starts_with("group:") {
                return Err(format!(
                    "field must start with 'monitor:' or 'group:' (got `{field}`)"
                ));
            }
            Ok(())
        }
        Condition::Logical { children, .. } => {
            if children.is_empty() {
                return Err("logical condition needs at least one child".to_string());
            }
            for child in children {
                validate_condition(child)?;
            }
            Ok(())
        }
    }
}

pub fn validate_actions(actions: &[Action]) -> Result<(), String> {
    if actions.is_empty() {
        return Err("a rule needs at least one action".to_string());
    }
    Ok(())
}
