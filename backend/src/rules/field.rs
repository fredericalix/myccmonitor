//! Parse `monitor:{uuid}:property` and `group:{uuid}:property` field strings
//! and fetch the live property values for the evaluator.

use crate::db::monitors::Monitor;
use crate::db::{metric_readings, monitor_groups, monitor_state_history, monitors};
use crate::groups::compute_view;
use sqlx::PgPool;
use tokio::sync::OnceCell;
use uuid::Uuid;

/// One rule evaluation's shared context. Caches the user's monitor list so a
/// rule with several `group:` conditions loads it once instead of once per
/// condition (the list is needed to compute auto-grouped membership).
pub struct EvalCtx<'a> {
    pub pool: &'a PgPool,
    pub user_id: Uuid,
    monitors: OnceCell<Vec<Monitor>>,
}

impl<'a> EvalCtx<'a> {
    pub fn new(pool: &'a PgPool, user_id: Uuid) -> Self {
        Self {
            pool,
            user_id,
            monitors: OnceCell::new(),
        }
    }

    /// The user's monitors, loaded at most once per evaluation.
    async fn user_monitors(&self) -> anyhow::Result<&[Monitor]> {
        let v = self
            .monitors
            .get_or_try_init(|| async {
                sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE user_id = $1")
                    .bind(self.user_id)
                    .fetch_all(self.pool)
                    .await
            })
            .await?;
        Ok(v.as_slice())
    }
}

#[derive(Debug, Clone)]
pub enum FieldRef {
    Monitor { id: Uuid, prop: MonitorProp },
    Group { id: Uuid, prop: GroupProp },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MonitorProp {
    State,
    Message,
    Acknowledged,
    Cpu,
    Mem,
    Disk,
    NetIn,
    NetOut,
}

impl MonitorProp {
    /// The `metric_readings.metric_name` key for a metric property, or `None`
    /// for the non-metric properties (state/message/acknowledged).
    pub fn metric_name(self) -> Option<&'static str> {
        match self {
            MonitorProp::Cpu => Some("cpu"),
            MonitorProp::Mem => Some("mem"),
            MonitorProp::Disk => Some("disk"),
            MonitorProp::NetIn => Some("net_in"),
            MonitorProp::NetOut => Some("net_out"),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupProp {
    State,
    CriticalCount,
    WarningCount,
    OkCount,
    UnknownCount,
    TotalCount,
}

pub fn parse(field: &str) -> Result<FieldRef, String> {
    let mut parts = field.splitn(3, ':');
    let kind = parts.next().ok_or("empty field")?;
    let id_str = parts.next().ok_or("missing id")?;
    let prop_str = parts.next().ok_or("missing property")?;
    if parts.next().is_some() {
        return Err(format!("too many ':' in field `{field}`"));
    }
    let id = Uuid::parse_str(id_str)
        .map_err(|_| format!("invalid uuid in field `{field}`"))?;
    match kind {
        "monitor" => Ok(FieldRef::Monitor {
            id,
            prop: parse_monitor_prop(prop_str)?,
        }),
        "group" => Ok(FieldRef::Group {
            id,
            prop: parse_group_prop(prop_str)?,
        }),
        other => Err(format!("unknown field prefix `{other}`")),
    }
}

fn parse_monitor_prop(s: &str) -> Result<MonitorProp, String> {
    Ok(match s {
        "state" => MonitorProp::State,
        "message" => MonitorProp::Message,
        "acknowledged" => MonitorProp::Acknowledged,
        "cpu" => MonitorProp::Cpu,
        "mem" => MonitorProp::Mem,
        "disk" => MonitorProp::Disk,
        "net_in" => MonitorProp::NetIn,
        "net_out" => MonitorProp::NetOut,
        other => return Err(format!("unknown monitor property `{other}`")),
    })
}

fn parse_group_prop(s: &str) -> Result<GroupProp, String> {
    Ok(match s {
        "state" => GroupProp::State,
        "critical_count" => GroupProp::CriticalCount,
        "warning_count" => GroupProp::WarningCount,
        "ok_count" => GroupProp::OkCount,
        "unknown_count" => GroupProp::UnknownCount,
        "total_count" => GroupProp::TotalCount,
        other => return Err(format!("unknown group property `{other}`")),
    })
}

#[derive(Debug, Clone)]
pub enum FieldValue {
    String(String),
    Bool(bool),
    Number(f64),
    Null,
}

/// Fetch the live value of a field for `user_id`. Returns `Null` when the
/// referenced row is absent (e.g. a deleted monitor) so the evaluator can
/// safely compare without panicking; the comparison naturally falls through
/// to `false` for most ops.
pub async fn fetch(ctx: &EvalCtx<'_>, field_ref: &FieldRef) -> anyhow::Result<FieldValue> {
    match field_ref {
        FieldRef::Monitor { id, prop } => {
            fetch_monitor(ctx.pool, ctx.user_id, *id, *prop).await
        }
        FieldRef::Group { id, prop } => fetch_group(ctx, *id, *prop).await,
    }
}

async fn fetch_monitor(
    pool: &PgPool,
    user_id: Uuid,
    monitor_id: Uuid,
    prop: MonitorProp,
) -> anyhow::Result<FieldValue> {
    let monitor = match prop {
        MonitorProp::State | MonitorProp::Message | MonitorProp::Acknowledged => {
            sqlx::query_as::<_, crate::db::monitors::Monitor>(
                "SELECT * FROM monitors WHERE id = $1 AND user_id = $2",
            )
            .bind(monitor_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?
        }
        _ => None,
    };
    Ok(match prop {
        MonitorProp::State => match monitor {
            Some(m) => FieldValue::String(m.current_state),
            None => FieldValue::Null,
        },
        MonitorProp::Message => match monitor.and_then(|m| m.current_message) {
            Some(s) => FieldValue::String(s),
            None => FieldValue::Null,
        },
        MonitorProp::Acknowledged => match monitor {
            Some(m) => FieldValue::Bool(m.acknowledged),
            None => FieldValue::Null,
        },
        MonitorProp::Cpu
        | MonitorProp::Mem
        | MonitorProp::Disk
        | MonitorProp::NetIn
        | MonitorProp::NetOut => {
            // Each metric is stored as its own row in metric_readings; we
            // pull the latest reading per metric and pick the one this prop
            // refers to. Returns Null if the metric isn't being emitted (CC
            // limitation per runtime) or if no poll cycle has run yet.
            let key = prop.metric_name().expect("metric prop has a name");
            let map = metric_readings::latest_per_metric(pool, monitor_id).await?;
            match map.get(key) {
                Some(r) => FieldValue::Number(r.value),
                None => FieldValue::Null,
            }
        }
    })
}

async fn fetch_group(
    ctx: &EvalCtx<'_>,
    group_id: Uuid,
    prop: GroupProp,
) -> anyhow::Result<FieldValue> {
    let Some(group) = monitor_groups::find(ctx.pool, ctx.user_id, group_id).await? else {
        return Ok(FieldValue::Null);
    };
    let user_monitors = ctx.user_monitors().await?;
    let view = compute_view(ctx.pool, ctx.user_id, group, user_monitors).await?;
    Ok(match prop {
        GroupProp::State => FieldValue::String(format!("{:?}", view.rolled_state).to_lowercase()),
        GroupProp::CriticalCount => FieldValue::Number(view.state_breakdown.critical as f64),
        GroupProp::WarningCount => FieldValue::Number(view.state_breakdown.warning as f64),
        GroupProp::OkCount => FieldValue::Number(view.state_breakdown.ok as f64),
        GroupProp::UnknownCount => FieldValue::Number(view.state_breakdown.unknown as f64),
        GroupProp::TotalCount => FieldValue::Number(view.state_breakdown.total as f64),
    })
}

/// True iff the monitor has held `state` continuously for at least
/// `seconds` seconds. Backed by `monitor_state_history`. Only meaningful
/// when the field is `monitor:X:state`.
pub async fn state_held_for(
    pool: &PgPool,
    user_id: Uuid,
    monitor_id: Uuid,
    state: &str,
    seconds: i64,
) -> anyhow::Result<bool> {
    monitor_state_history::state_held_for(pool, user_id, monitor_id, state, seconds)
        .await
        .map_err(Into::into)
}

/// Used by `db::rules` to know which rows to read on a monitor change —
/// extracted from a Comparison's `field` once at save time.
pub fn ref_pair(field_ref: &FieldRef) -> (&'static str, Uuid) {
    match field_ref {
        FieldRef::Monitor { id, .. } => ("monitor", *id),
        FieldRef::Group { id, .. } => ("group", *id),
    }
}

#[allow(dead_code)]
fn _force_imports(_m: &monitors::Monitor) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_monitor_metric_field() {
        let id = Uuid::new_v4();
        let r = parse(&format!("monitor:{id}:cpu")).unwrap();
        match r {
            FieldRef::Monitor { id: got, prop } => {
                assert_eq!(got, id);
                assert_eq!(prop, MonitorProp::Cpu);
                assert_eq!(prop.metric_name(), Some("cpu"));
            }
            _ => panic!("expected monitor ref"),
        }
    }

    #[test]
    fn parse_group_count_field() {
        let id = Uuid::new_v4();
        let r = parse(&format!("group:{id}:critical_count")).unwrap();
        assert!(matches!(
            r,
            FieldRef::Group { prop: GroupProp::CriticalCount, .. }
        ));
    }

    #[test]
    fn non_metric_props_have_no_metric_name() {
        assert_eq!(MonitorProp::State.metric_name(), None);
        assert_eq!(MonitorProp::Acknowledged.metric_name(), None);
    }

    #[test]
    fn parse_rejects_bad_input() {
        assert!(parse("").is_err());
        assert!(parse("monitor:not-a-uuid:state").is_err());
        assert!(parse("widget:00000000-0000-0000-0000-000000000000:state").is_err());
        let id = Uuid::new_v4();
        assert!(parse(&format!("monitor:{id}:bogus")).is_err());
        assert!(parse(&format!("monitor:{id}:state:extra")).is_err());
    }
}
