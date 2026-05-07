//! Database queries grouped by domain. Every tenant-scoped query MUST filter
//! by `user_id` from the session (see CLAUDE.md §15).

pub mod users;
