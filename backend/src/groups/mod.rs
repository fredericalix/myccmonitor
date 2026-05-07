//! Monitor groups: CRUD, auto-grouping rules (name_pattern, kinds), state rollup.

pub mod rollup;

pub use rollup::{GroupView, compute_view};
