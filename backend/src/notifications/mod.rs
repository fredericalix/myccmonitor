//! Notification dispatcher + adapters (email, Slack, Discord, generic webhook)
//! with handlebars templating. Phase 9.

pub mod adapters;
pub mod dispatch;
pub mod template;

pub use dispatch::dispatch;
