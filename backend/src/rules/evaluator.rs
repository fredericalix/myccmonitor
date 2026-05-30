//! Recursive evaluator for the Condition tree. AND/OR short-circuit.
//!
//! `for_duration` is honoured for `monitor:X:state` (via
//! `monitor_state_history::state_held_for`) and for the metric properties
//! `cpu|mem|disk|net_in|net_out` (via a continuity check over recent
//! `metric_readings`). For any other field a `for_duration` is **fail-safe**:
//! it returns `false` rather than firing early.

use crate::db::metric_readings::{self, KEEP_N_PER_METRIC, MetricReading};
use crate::rules::condition::{CompOp, Condition, LogicalOp};
use crate::rules::field::{self, EvalCtx, FieldRef, FieldValue, MonitorProp};
use chrono::{DateTime, Utc};

pub async fn evaluate(ctx: &EvalCtx<'_>, condition: &Condition) -> anyhow::Result<bool> {
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
            let live = field::fetch(ctx, &field_ref).await?;
            let instantaneous = compare(&live, *operator, value);
            if !instantaneous {
                return Ok(false);
            }
            if let Some(dur) = for_duration {
                return time_check(ctx, &field_ref, value, *operator, dur.seconds as i64).await;
            }
            Ok(true)
        }
        Condition::Logical { op, children } => match op {
            LogicalOp::And => {
                for child in children {
                    if !Box::pin(evaluate(ctx, child)).await? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            LogicalOp::Or => {
                for child in children {
                    if Box::pin(evaluate(ctx, child)).await? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        },
    }
}

pub(crate) fn compare(live: &FieldValue, op: CompOp, expected: &serde_json::Value) -> bool {
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
    ctx: &EvalCtx<'_>,
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
            let held = field::state_held_for(ctx.pool, ctx.user_id, *id, state, seconds).await?;
            Ok(if op == CompOp::Eq { held } else { !held })
        }
        FieldRef::Monitor { id, prop } if prop.metric_name().is_some() => {
            let name = prop.metric_name().expect("checked by guard");
            let readings =
                metric_readings::recent_readings(ctx.pool, *id, name, KEEP_N_PER_METRIC).await?;
            Ok(metric_held(&readings, op, expected, seconds, Utc::now()))
        }
        _ => {
            // group counts, message, acknowledged: a duration is meaningless or
            // unimplemented. Fail safe — never fire early on an ignored duration.
            tracing::warn!(
                ?field_ref,
                "for_duration on this field is unsupported; treating as not-held"
            );
            Ok(false)
        }
    }
}

/// True iff the metric satisfied `op expected` continuously for at least
/// `seconds`, judged from recent samples (oldest-first).
///
/// Requires (a) at least one sample inside the window `[now - seconds, now]`,
/// (b) every in-window sample satisfies the comparison, and (c) an *anchor*
/// sample taken at or before the window start that also satisfies it — proof
/// the metric was already over the line entering the window. Without an anchor
/// (not enough retained history, e.g. a fresh monitor) it fails safe. Pure
/// function: no I/O, unit-tested.
pub(crate) fn metric_held(
    readings: &[MetricReading],
    op: CompOp,
    expected: &serde_json::Value,
    seconds: i64,
    now: DateTime<Utc>,
) -> bool {
    let window_start = now - chrono::Duration::seconds(seconds);
    let passes = |v: f64| compare(&FieldValue::Number(v), op, expected);

    let in_window: Vec<&MetricReading> = readings.iter().filter(|r| r.ts >= window_start).collect();
    if in_window.is_empty() || !in_window.iter().all(|r| passes(r.value)) {
        return false;
    }
    // Anchor: the most recent sample at/before the window start.
    match readings.iter().rev().find(|r| r.ts < window_start) {
        Some(anchor) => passes(anchor.value),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn reading(secs_ago: i64, value: f64, now: DateTime<Utc>) -> MetricReading {
        MetricReading {
            monitor_id: Uuid::nil(),
            metric_name: "cpu".to_string(),
            ts: now - chrono::Duration::seconds(secs_ago),
            value,
        }
    }

    #[test]
    fn compare_numbers() {
        let n = FieldValue::Number(80.0);
        assert!(compare(&n, CompOp::Gte, &json!(80)));
        assert!(compare(&n, CompOp::Gt, &json!(79)));
        assert!(!compare(&n, CompOp::Gt, &json!(80)));
        assert!(compare(&n, CompOp::Lt, &json!(81)));
        assert!(compare(&n, CompOp::Eq, &json!(80)));
        assert!(compare(&n, CompOp::Neq, &json!(81)));
        // string operators are nonsensical on a number → false
        assert!(!compare(&n, CompOp::Contains, &json!("8")));
    }

    #[test]
    fn compare_strings_and_bools() {
        let s = FieldValue::String("critical".into());
        assert!(compare(&s, CompOp::Eq, &json!("critical")));
        assert!(compare(&s, CompOp::Neq, &json!("ok")));
        assert!(compare(&s, CompOp::Contains, &json!("rit")));
        assert!(compare(&s, CompOp::NotContains, &json!("xyz")));
        assert!(!compare(&s, CompOp::Gt, &json!("a")));

        let b = FieldValue::Bool(true);
        assert!(compare(&b, CompOp::Eq, &json!(true)));
        assert!(!compare(&b, CompOp::Eq, &json!(false)));
    }

    #[test]
    fn compare_null_is_always_false() {
        for op in [CompOp::Eq, CompOp::Neq, CompOp::Gt, CompOp::Contains] {
            assert!(!compare(&FieldValue::Null, op, &json!("x")));
        }
    }

    #[test]
    fn metric_held_true_when_all_in_window_and_anchor_pass() {
        let now = Utc::now();
        // window = last 300s; samples at 360s (anchor), 240,120,0 inside
        let readings = vec![
            reading(360, 90.0, now),
            reading(240, 92.0, now),
            reading(120, 88.0, now),
            reading(0, 91.0, now),
        ];
        assert!(metric_held(&readings, CompOp::Gte, &json!(80), 300, now));
    }

    #[test]
    fn metric_held_false_when_a_window_sample_dips() {
        let now = Utc::now();
        let readings = vec![
            reading(360, 90.0, now),
            reading(240, 70.0, now), // dip below threshold inside the window
            reading(0, 91.0, now),
        ];
        assert!(!metric_held(&readings, CompOp::Gte, &json!(80), 300, now));
    }

    #[test]
    fn metric_held_false_without_anchor() {
        let now = Utc::now();
        // only in-window samples, none older than the window start → can't
        // prove the metric held for the full duration
        let readings = vec![reading(120, 90.0, now), reading(0, 91.0, now)];
        assert!(!metric_held(&readings, CompOp::Gte, &json!(80), 300, now));
    }

    #[test]
    fn metric_held_false_when_empty() {
        let now = Utc::now();
        assert!(!metric_held(&[], CompOp::Gte, &json!(80), 300, now));
    }

    #[test]
    fn metric_held_false_when_anchor_fails() {
        let now = Utc::now();
        let readings = vec![
            reading(360, 50.0, now), // anchor below threshold
            reading(120, 90.0, now),
            reading(0, 91.0, now),
        ];
        assert!(!metric_held(&readings, CompOp::Gte, &json!(80), 300, now));
    }
}
