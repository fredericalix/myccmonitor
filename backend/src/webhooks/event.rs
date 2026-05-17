//! CC notification webhook payload parsing — minimal version for Phase 2.
//! Full `to_frames` mapping lives in Phase 3 once monitors exist. For now we
//! just parse enough to log the event and extract dedup info.
//!
//! Lifted from /Users/fralix/fax/src/apple/mycctown/backend/src/webhooks/event.rs.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct WebhookEnvelope {
    pub event: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub application: Option<Application>,
    #[serde(default)]
    pub addon: Option<Addon>,
    #[serde(default)]
    pub deployment: Option<Deployment>,
}

#[derive(Debug, Deserialize)]
pub struct Application {
    pub id: String,
    #[serde(default, rename = "ownerId")]
    pub owner_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Addon {
    pub id: String,
    #[serde(default, rename = "ownerId")]
    pub owner_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Deployment {
    #[serde(default)]
    pub id: Option<String>,
}

pub struct Routing {
    pub owner_id: String,
    pub resource_id: String,
}

impl WebhookEnvelope {
    pub fn routing(&self) -> Option<Routing> {
        if let Some(app) = &self.application {
            return Some(Routing {
                owner_id: app.owner_id.clone()?,
                resource_id: app.id.clone(),
            });
        }
        if let Some(addon) = &self.addon {
            return Some(Routing {
                owner_id: addon.owner_id.clone()?,
                resource_id: addon.id.clone(),
            });
        }
        None
    }

    /// Stable dedup key for a (event, resource, deployment, date) tuple.
    /// CC sometimes redelivers the same event within a few hundred ms — the
    /// `webhook_dedup` table uses this to drop the dupes.
    pub fn dedup_key(&self) -> String {
        let resource_id = self
            .application
            .as_ref()
            .map(|a| a.id.as_str())
            .or_else(|| self.addon.as_ref().map(|a| a.id.as_str()))
            .unwrap_or("");
        let deployment_id = self
            .deployment
            .as_ref()
            .and_then(|d| d.id.as_deref())
            .unwrap_or("");
        let date = self.date.as_deref().unwrap_or("");
        format!("{}|{}|{}|{}", self.event, resource_id, deployment_id, date)
    }
}
