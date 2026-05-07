//! Clever Cloud webhook receiver and event parser.

pub mod event;
pub mod receiver;

pub use event::WebhookEnvelope;
pub use receiver::router;
