//! Clever Cloud API client (orgs, applications, addons, webhooks, metrics token).

pub mod cc_client;

pub use cc_client::{CcClient, CcOrganisation, SUBSCRIBED_EVENTS};
