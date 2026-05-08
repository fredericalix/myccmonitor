//! HTTP handlers under /api/*. /auth/* lives in `crate::auth::routes`,
//! /webhooks/cc/:token in `crate::webhooks::receiver`, /ws in `crate::ws`.

pub mod api;
pub mod channels;
pub mod groups;
pub mod rules;

pub use api::router as api_router;
pub use channels::router as channels_router;
pub use groups::router as groups_router;
pub use rules::router as rules_router;
