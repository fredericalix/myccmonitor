//! OAuth 1.0a Clever Cloud login + AES-GCM token encryption + session handlers.

pub mod encryption;
pub mod extractor;
pub mod oauth;
pub mod routes;

pub use extractor::AuthenticatedUser;
pub use routes::router;
