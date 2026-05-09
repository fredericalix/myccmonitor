//! Lifted from mycctown/backend/src/metrics/warp10_client.rs.

use std::error::Error as _;

#[tracing::instrument(skip_all, fields(script_len = script.len(), status))]
pub async fn execute_warpscript(
    http_client: &reqwest::Client,
    warp10_url: &str,
    script: &str,
) -> anyhow::Result<serde_json::Value> {
    let resp = match http_client
        .post(warp10_url)
        .header("Content-Type", "application/x-warp10-warpscript")
        .body(script.to_string())
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Walk the source chain so we see the underlying cause (timeout vs
            // connection reset vs DNS) instead of just reqwest's top-level
            // "error sending request" message.
            let mut chain = format!("{e}");
            let mut src = e.source();
            while let Some(s) = src {
                chain.push_str(" → ");
                chain.push_str(&s.to_string());
                src = s.source();
            }
            tracing::error!(
                target: "warp10",
                kind = if e.is_timeout() { "timeout" }
                       else if e.is_connect() { "connect" }
                       else if e.is_request() { "request" }
                       else if e.is_body() { "body" }
                       else { "other" },
                script_len = script.len(),
                script_head = &script[..script.len().min(200)],
                cause_chain = %chain,
                "Warp10 send failed",
            );
            return Err(e.into());
        }
    };

    let status = resp.status();
    tracing::Span::current().record("status", status.as_u16());
    let body = resp.text().await?;

    if !status.is_success() {
        tracing::error!(
            target: "warp10",
            status = %status,
            body_head = &body[..body.len().min(500)],
            script_len = script.len(),
            script_head = &script[..script.len().min(300)],
            "Warp10 exec returned non-success"
        );
        anyhow::bail!(
            "Warp10 exec failed ({}): {}",
            status,
            &body[..body.len().min(500)]
        );
    }
    serde_json::from_str(&body).map_err(|e| {
        tracing::error!(target: "warp10", err = %e, "Warp10 response JSON parse failed");
        e.into()
    })
}
