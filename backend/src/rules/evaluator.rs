//! Recursive evaluator for the Condition tree. AND/OR short-circuit. For
//! `monitor:X:state` with `for_duration`, falls back to
//! `monitor_state_history::state_held_for` after the instantaneous match.
//! For other fields with `for_duration`, the duration is currently ignored
//! with a warn log (Phase 6 supports state-held-for only — metric-held-for
//! lands in a follow-up).

use crate::rules::condition::{CompOp, Condition, LogicalOp};
use crate::rules::field::{self, FieldRef, FieldValue, MonitorProp};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn evaluate(
    pool: &PgPool,
    user_id: Uuid,
    condition: &Condition,
) -> anyhow::Result<bool> {
    match condition {
        Condition::Comparison {
            field,
            operator,
            value,
            for_duration,
        } => {
            let field_ref = match field::parse(field) {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(error = %e, %field, "field parse failed");
                    return Ok(false);
                }
            };
            let live = field::fetch(pool, user_id, &field_ref).await?;
            let instantaneous = compare(&live, *operator, value);
            if !instantaneous {
                return Ok(false);
            }
            if let Some(dur) = for_duration {
                return time_check(pool, &field_ref, value, *operator, dur.seconds as i64).await;
            }
            Ok(true)
        }
        Condition::Logical { op, children } => match op {
            LogicalOp::And => {
                for child in children {
                    if !Box::pin(evaluate(pool, user_id, child)).await? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            LogicalOp::Or => {
                for child in children {
                    if Box::pin(evaluate(pool, user_id, child)).await? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        },
    }
}

fn compare(live: &FieldValue, op: CompOp, expected: &serde_json::Value) -> bool {
    use FieldValue::*;
    match (live, expected) {
        (Null, _) => false,
        (String(s), serde_json::Value::String(t)) => match op {
            CompOp::Eq => s == t,
            CompOp::Neq => s != t,
            CompOp::Contains => s.contains(t.as_str()),
            CompOp::NotContains => !s.contains(t.as_str()),
            _ => false,
        },
        (Bool(b), serde_json::Value::Bool(t)) => match op {
            CompOp::Eq => b == t,
            CompOp::Neq => b != t,
            _ => false,
        },
        (Number(n), serde_json::Value::Number(t)) => {
            let Some(t) = t.as_f64() else { return false };
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
        // Mismatched types: compare via string coercion for Eq / Neq, fail otherwise.
        (live, expected) => match op {
            CompOp::Eq => format!("{live:?}") == format!("{expected:?}"),
            CompOp::Neq => format!("{live:?}") != format!("{expected:?}"),
            _ => false,
        },
    }
}

async fn time_check(
    pool: &PgPool,
    field_ref: &FieldRef,
    expected: &serde_json::Value,
    op: CompOp,
    seconds: i64,
) -> anyhow::Result<bool> {
    match field_ref {
        FieldRef::Monitor {
            id,
            prop: MonitorProp::State,
        } => {
            // Only Eq / Neq with a string value make sense here.
            if !matches!(op, CompOp::Eq | CompOp::Neq) {
                return Ok(false);
            }
            let Some(state) = expected.as_str() else {
                return Ok(false);
            };
            let held = field::state_held_for(pool, *id, state, seconds).await?;
            Ok(if op == CompOp::Eq { held } else { !held })
        }
        _ => {
            tracing::debug!(
                "for_duration on non-state field is not yet evaluated (Phase 6.x); returning instantaneous-only verdict"
            );
            Ok(true)
        }
    }
}
