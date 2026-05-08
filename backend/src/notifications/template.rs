//! Handlebars templating for notification messages and subjects.
//! Custom helpers expose `since`, `relative_time`, and `format_state`.

use chrono::{DateTime, Utc};
use handlebars::{Handlebars, Helper, HelperResult, Output, RenderContext};
use std::sync::OnceLock;

fn since_helper(
    h: &Helper,
    _: &Handlebars,
    _: &handlebars::Context,
    _: &mut RenderContext,
    out: &mut dyn Output,
) -> HelperResult {
    let raw = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("");
    let when: Option<DateTime<Utc>> = DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&Utc));
    let rendered = match when {
        Some(t) => relative_time_string(t),
        None => "—".to_string(),
    };
    out.write(&rendered)?;
    Ok(())
}

fn format_state_helper(
    h: &Helper,
    _: &Handlebars,
    _: &handlebars::Context,
    _: &mut RenderContext,
    out: &mut dyn Output,
) -> HelperResult {
    let raw = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("unknown");
    out.write(&raw.to_uppercase())?;
    Ok(())
}

fn relative_time_string(t: DateTime<Utc>) -> String {
    let diff = Utc::now().signed_duration_since(t);
    let secs = diff.num_seconds().abs();
    if secs < 60 {
        return format!("{secs}s ago");
    }
    let mins = secs / 60;
    if mins < 60 {
        return format!("{mins}m ago");
    }
    let hours = mins / 60;
    if hours < 24 {
        return format!("{hours}h ago");
    }
    let days = hours / 24;
    format!("{days}d ago")
}

static REGISTRY: OnceLock<Handlebars<'static>> = OnceLock::new();

fn registry() -> &'static Handlebars<'static> {
    REGISTRY.get_or_init(|| {
        let mut hb = Handlebars::new();
        hb.set_strict_mode(false);
        hb.register_helper("since", Box::new(since_helper));
        hb.register_helper("relative_time", Box::new(since_helper)); // alias
        hb.register_helper("format_state", Box::new(format_state_helper));
        hb
    })
}

/// Render a template against a JSON context. Falls back to `default` on render error.
pub fn render(template: &str, context: &serde_json::Value, default: &str) -> String {
    if template.trim().is_empty() {
        return default.to_string();
    }
    match registry().render_template(template, context) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = ?e, template, "template render failed; using fallback");
            default.to_string()
        }
    }
}
