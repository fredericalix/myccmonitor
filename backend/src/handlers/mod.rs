//! HTTP handlers under /api/*. /auth/* lives in `crate::auth::routes`,
//! /webhooks/cc/:token in `crate::webhooks::receiver`, /ws in `crate::ws`.

pub mod api;

pub use api::router as api_router;
