//! Map Clever Cloud's application `state` field to our MonitorState slug.
//! Shared by `sync_org` (dashboard visit) and the periodic poller so a stable
//! healthy app shows `ok` even with no recent webhook activity.

/// Returns one of `"ok"`, `"critical"`, `"unknown"` to match the
/// `current_state` column shape used everywhere else.
pub fn map_cc_app_state(state: Option<&str>) -> &'static str {
    match state {
        Some("UP") | Some("SHOULD_BE_UP") | Some("WANTS_TO_BE_UP") => "ok",
        Some("SHOULD_BE_DOWN") | Some("WANTS_TO_BE_DOWN") | Some("RESTART_FAILED") => "critical",
        _ => "unknown",
    }
}
