//! Cycle detection at save time. We build a directed graph where:
//!   * nodes are rule UUIDs;
//!   * an edge `R -> S` exists when rule `R` writes a monitor (`SetMonitorState`
//!     action) that rule `S` watches (its condition tree depends on that monitor).
//!
//! A cycle in this graph means that firing `R` could re-trigger `S`, which could
//! re-fire `R`, etc. We refuse the save with a clear error.
//!
//! Note: the runtime also enforces `RULE_CHAIN_MAX_DEPTH = 8` and an in-flight
//! mutex per monitor. Static detection just gives the operator immediate feedback
//! at save time.

use crate::db::monitor_groups;
use crate::rules::condition::{Action, Condition};
use crate::rules::dependencies;
use anyhow::Result;
use petgraph::algo;
use petgraph::graph::{DiGraph, NodeIndex};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Validate the would-be set of rules for a single user. `pending` is the
/// rule currently being saved (with its post-save id, condition, actions).
/// Returns Ok(()) if no cycle is introduced; Err describes the offending path.
pub async fn check_no_cycle(
    pool: &PgPool,
    user_id: Uuid,
    pending: PendingRule<'_>,
) -> Result<()> {
    // Pull all existing rules for this user.
    let existing: Vec<crate::db::rules::Rule> =
        sqlx::query_as::<_, crate::db::rules::Rule>(
            "SELECT * FROM rules WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    // Effective rule set: existing minus the one being replaced (if any), plus pending.
    let mut rules: HashMap<Uuid, RuleSpec> = HashMap::new();
    for r in existing {
        if Some(r.id) == pending.id {
            continue;
        }
        let condition: Condition = serde_json::from_value(r.condition)?;
        let actions: Vec<Action> = serde_json::from_value(r.actions)?;
        rules.insert(
            r.id,
            RuleSpec {
                deps: dependencies::extract(&condition),
                writes: writes_of(&actions),
            },
        );
    }
    let pending_id = pending.id.unwrap_or_else(Uuid::new_v4);
    rules.insert(
        pending_id,
        RuleSpec {
            deps: dependencies::extract(pending.condition),
            writes: writes_of(pending.actions),
        },
    );

    // Resolve `group:{id}` deps into all the monitors the group covers, so the
    // graph captures "rule depends on group → group includes monitor X".
    let groups: Vec<crate::db::monitor_groups::MonitorGroup> =
        monitor_groups::list_for_user(pool, user_id).await?;
    let user_monitors: Vec<crate::db::monitors::Monitor> =
        sqlx::query_as::<_, crate::db::monitors::Monitor>(
            "SELECT * FROM monitors WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    let mut group_monitors: HashMap<Uuid, HashSet<Uuid>> = HashMap::new();
    for g in groups {
        let view = crate::groups::compute_view(pool, user_id, g.clone(), &user_monitors).await?;
        group_monitors.insert(g.id, view.member_ids.into_iter().collect());
    }

    // Build the graph.
    let mut graph: DiGraph<Uuid, ()> = DiGraph::new();
    let mut idx: HashMap<Uuid, NodeIndex> = HashMap::new();
    for id in rules.keys() {
        idx.insert(*id, graph.add_node(*id));
    }

    // For every rule R that writes monitor M, add an edge R -> S for every
    // rule S whose deps include monitor M (or a group containing M).
    let by_write_target: HashMap<Uuid, Vec<Uuid>> = {
        let mut m: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        for (rid, spec) in &rules {
            for monitor_id in &spec.writes {
                m.entry(*monitor_id).or_default().push(*rid);
            }
        }
        m
    };

    for (rid, spec) in &rules {
        for (kind, ref_id) in &spec.deps {
            let monitor_ids: HashSet<Uuid> = match kind.as_str() {
                "monitor" => std::iter::once(*ref_id).collect(),
                "group" => group_monitors.get(ref_id).cloned().unwrap_or_default(),
                _ => HashSet::new(),
            };
            for mid in monitor_ids {
                if let Some(writers) = by_write_target.get(&mid) {
                    for writer in writers {
                        if writer == rid {
                            continue;
                        }
                        graph.add_edge(idx[writer], idx[rid], ());
                    }
                }
            }
        }
    }

    if algo::is_cyclic_directed(&graph) {
        anyhow::bail!("rule creates a dependency cycle (one of the chain's monitors is read AND written transitively)");
    }
    Ok(())
}

pub struct PendingRule<'a> {
    pub id: Option<Uuid>,
    pub condition: &'a Condition,
    pub actions: &'a [Action],
}

struct RuleSpec {
    deps: Vec<(String, Uuid)>,
    writes: Vec<Uuid>,
}

fn writes_of(actions: &[Action]) -> Vec<Uuid> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::SetMonitorState { target_monitor_id, .. } => Some(*target_monitor_id),
            _ => None,
        })
        .collect()
}
