//! WarpScript templates for the Phase 4 poller. Lifted from mycctown.

/// Build a WarpScript that fetches the raw points for CPU user% and memory used%
/// for each id, tagged by `label_name` (`"app_id"` for cc_application,
/// `"addon_id"` for cc_addon). Output is interleaved class-by-class arrays
/// that `split_cpu_ram` walks.
pub fn cpu_ram_last_script(token: &str, label_name: &str, ids: &[String]) -> String {
    let mut script = String::new();
    for id in ids {
        script.push_str(&format!(
            "[ '{token}' 'cpu.usage_user' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'cpu.usage_user' RENAME\n\
             [ '{token}' 'mem.used_percent' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'mem.used_percent' RENAME\n",
            token = token,
            label = label_name,
            id = id
        ));
    }
    script
}

/// Split a CPU+RAM GTS response into `{ id -> (cpu?, ram?) }`. The id is read
/// from the `label_name` label of each GTS object. Walks the nested array tree
/// and picks the last numeric point per (id, metric class).
pub fn split_cpu_ram(
    value: &serde_json::Value,
    label_name: &str,
) -> std::collections::HashMap<String, (Option<f32>, Option<f32>)> {
    use std::collections::HashMap;
    let mut out: HashMap<String, (Option<f32>, Option<f32>)> = HashMap::new();

    fn visit_gts(
        gts: &serde_json::Value,
        label_name: &str,
        out: &mut HashMap<String, (Option<f32>, Option<f32>)>,
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

        let entry = out.entry(id).or_insert((None, None));
        if class.starts_with("cpu.") {
            let prev = entry.0.unwrap_or(f32::MIN);
            entry.0 = Some(prev.max(v as f32));
        } else if class.starts_with("mem.") {
            let prev = entry.1.unwrap_or(f32::MIN);
            entry.1 = Some(prev.max(v as f32));
        }
    }

    fn walk(
        v: &serde_json::Value,
        label_name: &str,
        out: &mut HashMap<String, (Option<f32>, Option<f32>)>,
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
