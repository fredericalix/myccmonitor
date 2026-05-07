//! MonitorPoller (Tokio interval, advisory-locked per monitor) + state history writes.
//! Phase 4 will add the Warp10 polling loop. Phase 3 ships sync from CC.

pub mod sync;
