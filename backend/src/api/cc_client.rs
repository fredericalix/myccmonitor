//! Clever Cloud API client. Lifted from mycctown/backend/src/api/cc_client.rs
//! and extended with `create_webhook` (POST /v2/notifications/webhooks/{ownerId}).

use crate::auth::oauth::sign_api_request;
use crate::config::Config;
use serde::{Deserialize, Serialize};

/// Events myccmonitor subscribes to when auto-creating a webhook on a CC org.
pub const SUBSCRIBED_EVENTS: &[&str] = &[
    "APPLICATION_CREATION",
    "APPLICATION_DELETION",
    "APPLICATION_REDEPLOY",
    "APPLICATION_STOP",
    "GIT_PUSH",
    "DEPLOYMENT_SUCCESS",
    "DEPLOYMENT_FAIL",
    "ADDON_CREATION",
    "ADDON_DELETION",
];

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcOrganisation {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcApplication {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type", default)]
    pub app_type: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub instance: Option<CcInstance>,
    #[serde(default)]
    pub zone: Option<String>,
    #[serde(default, rename = "lastDeploy")]
    pub last_deploy: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcInstance {
    #[serde(rename = "type")]
    pub instance_type: Option<String>,
    pub variant: Option<CcVariant>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcVariant {
    pub name: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcAddon {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "realId")]
    pub real_id: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub provider: Option<CcAddonProvider>,
    #[serde(rename = "creationDate", default)]
    pub creation_date: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcAddonProvider {
    pub id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcWebhook {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub urls: Vec<CcWebhookUrl>,
    #[serde(default)]
    pub events: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CcWebhookUrl {
    pub format: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct WebhookCreateBody {
    pub name: String,
    pub urls: Vec<CcWebhookUrl>,
    pub events: Vec<String>,
}

pub struct CcClient<'a> {
    http: &'a reqwest::Client,
    cfg: &'a Config,
    access_token: &'a str,
    access_secret: &'a str,
}

impl<'a> CcClient<'a> {
    pub fn new(
        http: &'a reqwest::Client,
        cfg: &'a Config,
        access_token: &'a str,
        access_secret: &'a str,
    ) -> Self {
        Self { http, cfg, access_token, access_secret }
    }

    fn sign(&self, method: &str, url: &str) -> String {
        sign_api_request(
            method,
            url,
            &self.cfg.cc_consumer_key,
            &self.cfg.cc_consumer_secret,
            self.access_token,
            self.access_secret,
        )
    }

    async fn get(&self, url: &str) -> anyhow::Result<String> {
        let auth = self.sign("GET", url);
        let resp = self.http.get(url).header("Authorization", auth).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("CC GET {url} → {status}: {body}");
        }
        Ok(body)
    }

    async fn post_json<B: Serialize>(&self, url: &str, body: &B) -> anyhow::Result<String> {
        let auth = self.sign("POST", url);
        let resp = self
            .http
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await?;
        let status = resp.status();
        let resp_body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("CC POST {url} → {status}: {resp_body}");
        }
        Ok(resp_body)
    }

    pub async fn list_organisations(&self) -> anyhow::Result<Vec<CcOrganisation>> {
        let url = format!("{}/v2/organisations", self.cfg.cc_api_base_url);
        let body = self.get(&url).await?;
        Ok(serde_json::from_str(&body)?)
    }

    pub async fn list_applications(
        &self,
        cc_org_id: &str,
    ) -> anyhow::Result<Vec<CcApplication>> {
        let url = format!(
            "{}/v2/organisations/{}/applications",
            self.cfg.cc_api_base_url, cc_org_id
        );
        let body = self.get(&url).await?;
        Ok(serde_json::from_str(&body)?)
    }

    pub async fn list_addons(&self, cc_org_id: &str) -> anyhow::Result<Vec<CcAddon>> {
        let url = format!(
            "{}/v2/organisations/{}/addons",
            self.cfg.cc_api_base_url, cc_org_id
        );
        let body = self.get(&url).await?;
        Ok(serde_json::from_str(&body)?)
    }

    /// Creates a webhook for the given owner (= an org id, or the user id for personal apps).
    /// CC endpoint: POST /v2/notifications/webhooks/{ownerId}
    /// Body shape per @clevercloud/client: { name, urls: [{format, url}], events }.
    pub async fn create_webhook(
        &self,
        owner_id: &str,
        name: &str,
        target_url: &str,
        events: &[&str],
    ) -> anyhow::Result<CcWebhook> {
        let url = format!(
            "{}/v2/notifications/webhooks/{}",
            self.cfg.cc_api_base_url, owner_id
        );
        let body = WebhookCreateBody {
            name: name.to_string(),
            urls: vec![CcWebhookUrl {
                format: "raw".to_string(),
                url: target_url.to_string(),
            }],
            events: events.iter().map(|s| s.to_string()).collect(),
        };
        let resp = self.post_json(&url, &body).await?;
        Ok(serde_json::from_str(&resp)?)
    }
}
