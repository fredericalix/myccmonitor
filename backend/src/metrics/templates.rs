//! WarpScript templates for the Phase 4 poller. Lifted from mycctown and
//! extended in Phase 11e to fetch disk + network alongside cpu + mem.
//!
//! Network metrics (`net.bytes_recv` / `net.bytes_sent`) are cumulative
//! counters. The order `FETCH → mapper.rate → MERGE` is non-negotiable:
//! computing the rate per-instance BEFORE merging avoids the 100+ GB/s spikes
//! that would otherwise be produced when an instance is replaced (counter
//! reset). After mapper.rate, negative values can still appear briefly; the
//! parser drops them (`split_metrics`).

/// Sample at one point in time per (id, metric class). Field order matches
/// `MetricSample`: cpu, mem, disk, net_in, net_out — all `Option<f32>`.
pub type MetricsTuple = (
    Option<f32>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
);

/// Build a WarpScript that fetches the most recent point of cpu, mem, disk,
/// net_in and net_out for each id, tagged by `label_name`. CC's Warp10 stores
/// metrics for both apps and addons under the `app_id` label (with the addon's
/// `realId` as value), so callers should pass `"app_id"` regardless of kind.
pub fn metrics_last_script(token: &str, label_name: &str, ids: &[String]) -> String {
    let mut script = String::new();
    for id in ids {
        script.push_str(&format!(
            // CPU + MEM + DISK: instantaneous gauges. FETCH then MERGE.
            "[ '{token}' 'cpu.usage_user' {{ '{label}' '{id}' }} NOW 2 m ] FETCH\n\
             MERGE 'cpu.usage_user' RENAME\n\
             [ '{token}' 'mem.used_percent' {{ '{label}' '{id}' }} NOW 2 m ] FETCH\n\
             MERGE 'mem.used_percent' RENAME\n\
             [ '{token}' 'disk.used_percent' {{ '{label}' '{id}' }} NOW 2 m ] FETCH\n\
             MERGE 'disk.used_percent' RENAME\n\
             [ '{token}' 'net.bytes_recv' {{ '{label}' '{id}' }} NOW 2 m ] FETCH\n\
             [ SWAP mapper.rate 1 0 0 ] MAP\n\
             MERGE 'net.bytes_recv' RENAME\n\
             [ '{token}' 'net.bytes_sent' {{ '{label}' '{id}' }} NOW 2 m ] FETCH\n\
             [ SWAP mapper.rate 1 0 0 ] MAP\n\
             MERGE 'net.bytes_sent' RENAME\n",
            token = token,
            label = label_name,
            id = id
        ));
    }
    script
}

/// Walk the GTS response tree and pick the last numeric point per
/// (id, metric class). Negative values on `net.*` (counter reset artefacts
/// even after `mapper.rate`) are dropped.
pub fn split_metrics(
    value: &serde_json::Value,
    label_name: &str,
) -> std::collections::HashMap<String, MetricsTuple> {
    use std::collections::HashMap;
    let mut out: HashMap<String, MetricsTuple> = HashMap::new();

    fn visit_gts(
        gts: &serde_json::Value,
        label_name: &str,
        out: &mut HashMap<String, MetricsTuple>,
    ) {
        let class = gts.get("c").and_then(|v| v.as_str()).unwrap_or("");
        let id = match gts
            .get("l")
            .and_then(|l| l.get(label_name))
            .and_then(|v| v.as_str())
        {
            Some(id) => id.to_string(),
            None => return,
        };
        let Some(points) = gts.get("v").and_then(|v| v.as_array()) else {
            return;
        };
        let Some(last) = points.last().and_then(|p| p.as_array()) else {
            return;
        };
        let Some(raw) = last.last() else { return };
        let v: f64 = match raw {
            serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
            serde_json::Value::String(s) => s.parse().unwrap_or(0.0),
            _ => return,
        };

        let entry = out.entry(id).or_insert((None, None, None, None, None));
        // Field order: 0=cpu, 1=mem, 2=disk, 3=net_in, 4=net_out.
        if class.starts_with("cpu.") {
            let prev = entry.0.unwrap_or(f32::MIN);
            entry.0 = Some(prev.max(v as f32));
        } else if class.starts_with("mem.") {
            let prev = entry.1.unwrap_or(f32::MIN);
            entry.1 = Some(prev.max(v as f32));
        } else if class.starts_with("disk.") {
            let prev = entry.2.unwrap_or(f32::MIN);
            entry.2 = Some(prev.max(v as f32));
        } else if class == "net.bytes_recv" {
            if v >= 0.0 {
                let prev = entry.3.unwrap_or(f32::MIN);
                entry.3 = Some(prev.max(v as f32));
            }
        } else if class == "net.bytes_sent" && v >= 0.0 {
            let prev = entry.4.unwrap_or(f32::MIN);
            entry.4 = Some(prev.max(v as f32));
        }
    }

    fn walk(
        v: &serde_json::Value,
        label_name: &str,
        out: &mut HashMap<String, MetricsTuple>,
    ) {
        match v {
            serde_json::Value::Array(arr) => {
                for item in arr {
                    walk(item, label_name, out);
                }
            }
            serde_json::Value::Object(_) => visit_gts(v, label_name, out),
            _ => {}
        }
    }

    walk(value, label_name, &mut out);
    out
}
