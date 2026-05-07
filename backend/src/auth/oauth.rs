//! OAuth 1.0a Clever Cloud client. Lifted from myccmetrics/backend-server/src/auth/oauth.rs.
//!
//! Implements the 3-leg flow:
//!   1. `request_temporary_token` — get an unauthorized request token + secret
//!   2. user is redirected to `${cc_api}/v2/oauth/authorize?oauth_token=...`
//!   3. CC redirects back with `oauth_verifier`
//!   4. `exchange_access_token` — swap (token, secret, verifier) for an access (token, secret)
//!
//! All API requests after login are signed with `sign_api_request`.

use crate::config::Config;
use hmac::{Hmac, Mac};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use sha1::Sha1;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

// RFC 3986 unreserved characters
const ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

fn percent_encode(s: &str) -> String {
    utf8_percent_encode(s, ENCODE_SET).to_string()
}

fn generate_nonce() -> String {
    uuid::Uuid::new_v4().to_string().replace('-', "")
}

fn generate_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string()
}

fn sign_request(
    method: &str,
    base_url: &str,
    params: &BTreeMap<String, String>,
    consumer_secret: &str,
    token_secret: &str,
) -> String {
    let param_string: String = params
        .iter()
        .filter(|(k, _)| k.as_str() != "oauth_signature")
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let base_string = format!(
        "{}&{}&{}",
        percent_encode(method),
        percent_encode(base_url),
        percent_encode(&param_string)
    );

    let signing_key = format!(
        "{}&{}",
        percent_encode(consumer_secret),
        percent_encode(token_secret)
    );

    let mut mac = Hmac::<Sha1>::new_from_slice(signing_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(base_string.as_bytes());
    let result = mac.finalize();
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, result.into_bytes())
}

fn build_query_string(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn build_authorization_header(params: &BTreeMap<String, String>) -> String {
    let entries: Vec<String> = params
        .iter()
        .filter(|(k, _)| k.starts_with("oauth_"))
        .map(|(k, v)| format!("{}=\"{}\"", percent_encode(k), percent_encode(v)))
        .collect();
    format!("OAuth {}", entries.join(", "))
}

/// Step 1: get a request token from Clever Cloud.
pub async fn request_temporary_token(
    config: &Config,
    http_client: &reqwest::Client,
) -> anyhow::Result<(String, String)> {
    let base_url = format!("{}/v2/oauth/request_token_query", config.cc_api_base_url);
    let callback_url = config.callback_url();

    let mut params = BTreeMap::new();
    params.insert("oauth_callback".to_string(), callback_url);
    params.insert("oauth_consumer_key".to_string(), config.cc_consumer_key.clone());
    params.insert("oauth_nonce".to_string(), generate_nonce());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), generate_timestamp());
    params.insert("oauth_version".to_string(), "1.0".to_string());

    let signature = sign_request("POST", &base_url, &params, &config.cc_consumer_secret, "");
    params.insert("oauth_signature".to_string(), signature);

    let query_string = build_query_string(&params);
    let full_url = format!("{}?{}", base_url, query_string);

    let resp = http_client.post(&full_url).send().await?;
    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        tracing::error!(status = %status, body = %body, "request_token failed");
        anyhow::bail!("request_token failed: status={status} body={body}");
    }

    let parsed: BTreeMap<String, String> = url::form_urlencoded::parse(body.as_bytes())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let token = parsed
        .get("oauth_token")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token in response: {}", body))?
        .clone();
    let secret = parsed
        .get("oauth_token_secret")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token_secret in response: {}", body))?
        .clone();

    Ok((token, secret))
}

/// Step 3: exchange request token + verifier for access token.
pub async fn exchange_access_token(
    config: &Config,
    http_client: &reqwest::Client,
    oauth_token: &str,
    oauth_token_secret: &str,
    oauth_verifier: &str,
) -> anyhow::Result<(String, String)> {
    let base_url = format!("{}/v2/oauth/access_token_query", config.cc_api_base_url);

    let mut params = BTreeMap::new();
    params.insert("oauth_consumer_key".to_string(), config.cc_consumer_key.clone());
    params.insert("oauth_token".to_string(), oauth_token.to_string());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), generate_timestamp());
    params.insert("oauth_nonce".to_string(), generate_nonce());
    params.insert("oauth_version".to_string(), "1.0".to_string());
    params.insert("oauth_verifier".to_string(), oauth_verifier.to_string());

    let signature = sign_request(
        "POST",
        &base_url,
        &params,
        &config.cc_consumer_secret,
        oauth_token_secret,
    );
    params.insert("oauth_signature".to_string(), signature);

    let query_string = build_query_string(&params);
    let full_url = format!("{}?{}", base_url, query_string);

    let resp = http_client.post(&full_url).send().await?;
    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        tracing::error!("access_token failed: status={}", status);
        anyhow::bail!("access_token failed: status={}", status);
    }

    let parsed: BTreeMap<String, String> = url::form_urlencoded::parse(body.as_bytes())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let token = parsed
        .get("oauth_token")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token in response: {}", body))?
        .clone();
    let secret = parsed
        .get("oauth_token_secret")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token_secret in response: {}", body))?
        .clone();

    Ok((token, secret))
}

/// Sign an API request and return the value for the `Authorization` header.
pub fn sign_api_request(
    method: &str,
    url: &str,
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
) -> String {
    let mut params = BTreeMap::new();
    params.insert("oauth_consumer_key".to_string(), consumer_key.to_string());
    params.insert("oauth_token".to_string(), access_token.to_string());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), generate_timestamp());
    params.insert("oauth_nonce".to_string(), generate_nonce());
    params.insert("oauth_version".to_string(), "1.0".to_string());

    let signature = sign_request(method, url, &params, consumer_secret, access_secret);
    params.insert("oauth_signature".to_string(), signature);

    build_authorization_header(&params)
}
