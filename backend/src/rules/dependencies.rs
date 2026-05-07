//! Walk a Condition tree and extract `(ref_kind, ref_id)` pairs. Used by
//! `db::rules::save` to refresh the `rule_dependencies` index.

use crate::rules::condition::Condition;
use crate::rules::field;
use std::collections::HashSet;
use uuid::Uuid;

pub fn extract(condition: &Condition) -> Vec<(String, Uuid)> {
    let mut seen: HashSet<(String, Uuid)> = HashSet::new();
    walk(condition, &mut seen);
    seen.into_iter().collect()
}

fn walk(c: &Condition, seen: &mut HashSet<(String, Uuid)>) {
    match c {
        Condition::Comparison { field, .. } => {
            if let Ok(r) = field::parse(field) {
                let (kind, id) = field::ref_pair(&r);
                seen.insert((kind.to_string(), id));
            }
        }
        Condition::Logical { children, .. } => {
            for child in children {
                walk(child, seen);
            }
        }
    }
}
