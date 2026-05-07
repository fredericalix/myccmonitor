//! Database queries grouped by domain. Every tenant-scoped query MUST filter
//! by `user_id` from the session (see CLAUDE.md §15).

pub mod alerts;
pub mod metric_samples;
pub mod monitor_groups;
pub mod monitor_state_history;
pub mod monitors;
pub mod orgs;
pub mod rule_firings;
pub mod rules;
pub mod users;
pub mod webhook_configs;
pub mod webhook_dedup;
