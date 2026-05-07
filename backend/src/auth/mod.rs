//! OAuth 1.0a Clever Cloud login + AES-GCM token encryption + session handlers.

pub mod encryption;
pub mod oauth;
pub mod routes;

pub use routes::router;
