//! Compute the effective member list and rolled-up state of a group.
//!
//! Effective members = manual list ∪ auto-matched. Auto-matching evaluates
//! `auto_rules` (name_pattern regex on `display_name`, allowed `kinds`)
//! conjunctively. Rolled-up state: critical > warning > ok > unknown.

use crate::db::monitor_groups::{AutoRules, MonitorGroup};
use crate::db::monitors::Monitor;
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RolledState {
    Ok,
    Warning,
    Critical,
    Unknown,
}

impl RolledState {
    fn from_str(s: &str) -> Self {
        match s {
            "ok" => Self::Ok,
            "warning" => Self::Warning,
            "critical" => Self::Critical,
            _ => Self::Unknown,
        }
    }

    /// Return the worse-of-two state (critical wins, then warning, then ok, then unknown).
    fn merge(self, other: Self) -> Self {
        use RolledState::*;
        match (self, other) {
            (Critical, _) | (_, Critical) => Critical,
            (Warning, _) | (_, Warning) => Warning,
            (Ok, _) | (_, Ok) => Ok,
            _ => Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupView {
    #[serde(flatten)]
    pub group: MonitorGroup,
    pub member_ids: Vec<Uuid>,
    pub rolled_state: RolledState,
    pub state_breakdown: StateBreakdown,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StateBreakdown {
    pub ok: u32,
    pub warning: u32,
    pub critical: u32,
    pub unknown: u32,
    pub total: u32,
}

pub async fn compute_view(
    pool: &PgPool,
    user_id: Uuid,
    group: MonitorGroup,
    user_monitors: &[Monitor],
) -> anyhow::Result<GroupView> {
    let manual_ids: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT monitor_id FROM monitor_group_members WHERE group_id = $1",
    )
    .bind(group.id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let auto_rules: Option<AutoRules> = match &group.auto_rules {
        Some(v) => serde_json::from_value(v.clone()).ok(),
        None => None,
    };

    // Pre-compile the regex once if present (skip if invalid; defensive).
    let name_re = auto_rules
        .as_ref()
        .and_then(|r| r.name_pattern.as_ref())
        .and_then(|p| regex::Regex::new(p).ok());
    let kinds: Option<&Vec<String>> = auto_rules.as_ref().and_then(|r| r.kinds.as_ref());

    let mut effective = manual_ids;
    if name_re.is_some() || kinds.is_some() {
        for m in user_monitors {
            if m.user_id != user_id {
                continue;
            }
            if let Some(ks) = kinds {
                if !ks.iter().any(|k| k == &m.kind) {
                    continue;
                }
            }
            if let Some(re) = name_re.as_ref() {
                if !re.is_match(&m.display_name) {
                    continue;
                }
            }
            effective.insert(m.id);
        }
    }

    // Now compute rollup from the actual monitor rows in `user_monitors`.
    let mut rolled = RolledState::Ok;
    let mut breakdown = StateBreakdown::default();
    let mut any = false;
    for m in user_monitors {
        if !effective.contains(&m.id) {
            continue;
        }
        any = true;
        let s = RolledState::from_str(&m.current_state);
        rolled = rolled.merge(s);
        breakdown.total += 1;
        match s {
            RolledState::Ok => breakdown.ok += 1,
            RolledState::Warning => breakdown.warning += 1,
            RolledState::Critical => breakdown.critical += 1,
            RolledState::Unknown => breakdown.unknown += 1,
        }
    }
    if !any {
        rolled = RolledState::Unknown;
    }

    let mut member_ids: Vec<Uuid> = effective.into_iter().collect();
    member_ids.sort();

    Ok(GroupView {
        group,
        member_ids,
        rolled_state: rolled,
        state_breakdown: breakdown,
    })
}
