//! MCP server: tool definitions + `ServerHandler` impl.
//!
//! Each tool re-uses the same `db::*` / `handlers::*` helpers as the REST
//! routes — zero re-implemented business logic, just a protocol adapter.
//! `user_id` is **always** taken from the `McpAuth` extension injected by
//! `crate::mcp::auth::mcp_auth_layer`; tool inputs cannot name a `user_id`.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::ErrorCode;
use rmcp::service::RequestContext;
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler, tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use crate::db::monitor_groups::{self, CreateGroup, UpdateGroup};
use crate::db::monitors::{self, Monitor};
use crate::db::notification_channels::{self, UpsertChannel};
use crate::db::orgs;
use crate::db::rule_firings;
use crate::db::rules::{self, Rule};
use crate::groups::compute_view;
use crate::handlers::rules::{UpsertInput as RuleUpsertInput, save_inner as rule_save_inner};
use crate::mcp::auth::McpAuth;
use crate::rules::condition::{Action, Condition};
use crate::rules::debug as rule_debug;
use crate::rules::exec;
use crate::state::AppState;

#[derive(Clone)]
pub struct McpServer {
    pub state: AppState,
}

impl McpServer {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

fn parse_uuid(s: &str, field: &str) -> Result<Uuid, McpError> {
    Uuid::parse_str(s).map_err(|e| bad_request(format!("invalid {field}: {e}")))
}

/// Serialise any tool return to a JSON string. MCP delivers tool output as
/// text content (one line of JSON in our case), so we don't bother with the
/// `Json<T>` wrapper — which would require every returned domain type to
/// implement `JsonSchema`.
fn ok_json<T: serde::Serialize>(v: T) -> Result<String, McpError> {
    serde_json::to_string(&v).map_err(internal)
}

// ---------- helpers ----------

fn auth_from_ctx(ctx: &RequestContext<RoleServer>) -> Result<Uuid, McpError> {
    let parts = ctx
        .extensions
        .get::<http::request::Parts>()
        .ok_or_else(|| McpError::new(ErrorCode::INTERNAL_ERROR, "missing http parts", None))?;
    let auth = parts
        .extensions
        .get::<McpAuth>()
        .ok_or_else(|| McpError::new(ErrorCode::INVALID_REQUEST, "unauthenticated", None))?;
    Ok(auth.user_id)
}

fn internal<E: std::fmt::Display>(err: E) -> McpError {
    McpError::new(ErrorCode::INTERNAL_ERROR, err.to_string(), None)
}

fn bad_request<S: Into<String>>(msg: S) -> McpError {
    McpError::new(ErrorCode::INVALID_PARAMS, msg.into(), None)
}

fn not_found<S: Into<String>>(msg: S) -> McpError {
    McpError::new(ErrorCode::INVALID_PARAMS, msg.into(), None)
}

// ---------- tool input schemas ----------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OrgArgs {
    /// Clever Cloud organisation id (`orga_…` or the special `user_…`).
    pub cc_org_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MonitorDebugArgs {
    pub cc_org_id: String,
    /// Monitor UUID.
    pub monitor_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GroupIdArgs {
    /// Group UUID.
    pub group_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GroupMemberArgs {
    pub group_id: String,
    pub monitor_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateGroupArgs {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Optional auto-grouping rules; matches `monitor_groups.auto_rules` JSON
    /// shape: `{ "name_pattern": "^prod-", "kinds": ["cc_application"] }`.
    #[serde(default)]
    pub auto_rules: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateGroupArgs {
    pub group_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub auto_rules: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RuleIdArgs {
    /// Rule UUID.
    pub rule_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RuleVersionArgs {
    pub rule_id: String,
    /// Version id, e.g. `v1718289312` (from list_rule_versions).
    pub version_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListFiringsArgs {
    pub rule_id: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RuleUpsertArgs {
    pub name: String,
    #[serde(default = "default_true")]
    pub is_enabled: bool,
    /// Recursive condition tree. See `Condition` enum in CLAUDE.md §10.1 —
    /// either `{ "type": "comparison", "field": "monitor:<uuid>:state",
    /// "operator": "eq", "value": "critical" }` or `{ "type": "logical",
    /// "op": "and", "children": [ … ] }`.
    pub condition: serde_json::Value,
    /// List of actions. See `Action` enum in CLAUDE.md §10.2.
    pub actions: serde_json::Value,
    #[serde(default = "default_cooldown")]
    pub cooldown_seconds: i32,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RuleUpdateArgs {
    pub rule_id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub is_enabled: bool,
    pub condition: serde_json::Value,
    pub actions: serde_json::Value,
    #[serde(default = "default_cooldown")]
    pub cooldown_seconds: i32,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ChannelIdArgs {
    /// Channel UUID.
    pub channel_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ChannelCreateArgs {
    /// One of `email`, `slack`, `discord`, `webhook`.
    pub kind: String,
    pub name: String,
    /// Kind-specific JSON. See CLAUDE.md §13.
    pub config: serde_json::Value,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ChannelUpdateArgs {
    pub channel_id: String,
    pub kind: String,
    pub name: String,
    pub config: serde_json::Value,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}
fn default_cooldown() -> i32 {
    300
}

fn parse_condition(v: serde_json::Value) -> Result<Condition, McpError> {
    serde_json::from_value(v).map_err(|e| bad_request(format!("decode condition: {e}")))
}
fn parse_actions(v: serde_json::Value) -> Result<Vec<Action>, McpError> {
    serde_json::from_value(v).map_err(|e| bad_request(format!("decode actions: {e}")))
}

async fn org_belongs_to_user(
    state: &AppState,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<(), McpError> {
    let org = orgs::find_by_user_and_cc_id(&state.pool, user_id, cc_org_id)
        .await
        .map_err(internal)?;
    if org.is_none() {
        return Err(not_found(format!("org {cc_org_id} not found for user")));
    }
    Ok(())
}

// ---------- tool router ----------

#[tool_router]
impl McpServer {
    #[tool(description = "List the user's Clever Cloud organisations.")]
    async fn list_orgs(
        &self,
        ctx: RequestContext<RoleServer>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rows = orgs::list_for_user(&self.state.pool, user_id)
            .await
            .map_err(internal)?;
        ok_json(rows)
    }

    #[tool(description = "List monitors for one CC organisation (syncs from CC first).")]
    async fn list_monitors(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<OrgArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        org_belongs_to_user(&self.state, user_id, &args.cc_org_id).await?;
        let monitors = monitors::list_for_org(&self.state.pool, user_id, &args.cc_org_id)
            .await
            .map_err(internal)?;
        ok_json(monitors)
    }

    #[tool(
        description = "Diagnostic for one monitor: metrics availability, missing metrics, last poll."
    )]
    async fn get_monitor_debug(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<MonitorDebugArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let monitor_id = parse_uuid(&args.monitor_id, "monitor_id")?;
        org_belongs_to_user(&self.state, user_id, &args.cc_org_id).await?;
        let monitor = monitors::find_by_id_for_user(&self.state.pool, user_id, monitor_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found(format!("monitor {monitor_id} not found")))?;
        if monitor.cc_org_id.as_deref() != Some(args.cc_org_id.as_str()) {
            return Err(bad_request("monitor does not belong to this org"));
        }
        let since = chrono::Utc::now() - chrono::Duration::minutes(30);
        let availability =
            crate::db::metric_readings::availability(&self.state.pool, monitor.id, since)
                .await
                .map_err(internal)?;
        let latest = crate::db::metric_readings::latest_per_metric(&self.state.pool, monitor.id)
            .await
            .map_err(internal)?;
        ok_json(serde_json::json!({
            "monitor": monitor,
            "cc_metrics_id": monitor.cc_metrics_id,
            "samples_count_30m": availability.samples_count,
            "availability": {
                "cpu": availability.cpu,
                "mem": availability.mem,
                "disk": availability.disk,
                "net_in": availability.net_in,
                "net_out": availability.net_out,
            },
            "latest_per_metric": latest,
            "last_poll_at": monitor.last_poll_at,
        }))
    }

    // ----- groups -----

    #[tool(description = "List monitor groups with rolled-up state.")]
    async fn list_groups(
        &self,
        ctx: RequestContext<RoleServer>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let groups = monitor_groups::list_for_user(&self.state.pool, user_id)
            .await
            .map_err(internal)?;
        let monitors = sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&self.state.pool)
            .await
            .map_err(internal)?;
        let mut out = Vec::with_capacity(groups.len());
        for g in groups {
            out.push(
                compute_view(&self.state.pool, user_id, g, &monitors)
                    .await
                    .map_err(internal)?,
            );
        }
        ok_json(out)
    }

    #[tool(description = "Read one monitor group by id.")]
    async fn get_group(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<GroupIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let group_id = parse_uuid(&args.group_id, "group_id")?;
        let group = monitor_groups::find(&self.state.pool, user_id, group_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found(format!("group {group_id} not found")))?;
        let monitors = sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&self.state.pool)
            .await
            .map_err(internal)?;
        ok_json(
            compute_view(&self.state.pool, user_id, group, &monitors)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(description = "Create a monitor group (optionally with auto-grouping rules).")]
    async fn create_group(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<CreateGroupArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        if args.name.trim().is_empty() {
            return Err(bad_request("name must not be empty"));
        }
        let auto = match args.auto_rules {
            Some(v) => serde_json::from_value(v)
                .map_err(|e| bad_request(format!("decode auto_rules: {e}")))?,
            None => None,
        };
        let row = monitor_groups::create(
            &self.state.pool,
            user_id,
            &CreateGroup {
                name: args.name,
                description: args.description,
                auto_rules: auto,
            },
        )
        .await
        .map_err(internal)?;
        ok_json(row)
    }

    #[tool(description = "Update a monitor group.")]
    async fn update_group(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<UpdateGroupArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let group_id = parse_uuid(&args.group_id, "group_id")?;
        let auto = match args.auto_rules {
            Some(v) => serde_json::from_value(v)
                .map_err(|e| bad_request(format!("decode auto_rules: {e}")))?,
            None => None,
        };
        let row = monitor_groups::update(
            &self.state.pool,
            user_id,
            group_id,
            &UpdateGroup {
                name: args.name,
                description: args.description,
                auto_rules: auto,
            },
        )
        .await
        .map_err(internal)?
        .ok_or_else(|| not_found(format!("group {group_id} not found")))?;
        ok_json(row)
    }

    #[tool(description = "Delete a monitor group.")]
    async fn delete_group(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<GroupIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let group_id = parse_uuid(&args.group_id, "group_id")?;
        let n = monitor_groups::delete(&self.state.pool, user_id, group_id)
            .await
            .map_err(internal)?;
        if n == 0 {
            return Err(not_found(format!("group {group_id} not found")));
        }
        ok_json(serde_json::json!({"deleted": true}))
    }

    #[tool(description = "Add a monitor as a manual member of a group.")]
    async fn add_group_member(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<GroupMemberArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let group_id = parse_uuid(&args.group_id, "group_id")?;
        let monitor_id = parse_uuid(&args.monitor_id, "monitor_id")?;
        let ok = monitor_groups::add_member(&self.state.pool, user_id, group_id, monitor_id)
            .await
            .map_err(internal)?;
        if !ok {
            return Err(bad_request("group or monitor not found for this user"));
        }
        ok_json(serde_json::json!({"added": true}))
    }

    #[tool(description = "Remove a manual member from a group.")]
    async fn remove_group_member(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<GroupMemberArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let group_id = parse_uuid(&args.group_id, "group_id")?;
        let monitor_id = parse_uuid(&args.monitor_id, "monitor_id")?;
        let n = monitor_groups::remove_member(&self.state.pool, user_id, group_id, monitor_id)
            .await
            .map_err(internal)?;
        ok_json(serde_json::json!({"removed": n > 0}))
    }

    // ----- rules -----

    #[tool(description = "List rules with last_fired_at and cooldown.")]
    async fn list_rules(
        &self,
        ctx: RequestContext<RoleServer>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        ok_json(
            rules::list_for_user(&self.state.pool, user_id)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(description = "Read one rule.")]
    async fn get_rule(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let rule = rules::find(&self.state.pool, user_id, rule_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found(format!("rule {rule_id} not found")))?;
        ok_json(rule)
    }

    #[tool(
        description = "Create a rule. condition and actions follow the JSON schemas in CLAUDE.md §10."
    )]
    async fn create_rule(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleUpsertArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let input = RuleUpsertInput {
            name: args.name,
            is_enabled: args.is_enabled,
            condition: parse_condition(args.condition)?,
            actions: parse_actions(args.actions)?,
            cooldown_seconds: args.cooldown_seconds,
            metadata: args.metadata,
            comment: args.comment,
        };
        let rule = rule_save_inner(&self.state, user_id, None, input)
            .await
            .map_err(|e| bad_request(e.to_string()))?;
        ok_json(rule)
    }

    #[tool(description = "Update an existing rule.")]
    async fn update_rule(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleUpdateArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let input = RuleUpsertInput {
            name: args.name,
            is_enabled: args.is_enabled,
            condition: parse_condition(args.condition)?,
            actions: parse_actions(args.actions)?,
            cooldown_seconds: args.cooldown_seconds,
            metadata: args.metadata,
            comment: args.comment,
        };
        let rule = rule_save_inner(&self.state, user_id, Some(rule_id), input)
            .await
            .map_err(|e| bad_request(e.to_string()))?;
        ok_json(rule)
    }

    #[tool(description = "Delete a rule.")]
    async fn delete_rule(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let n = rules::delete(&self.state.pool, user_id, rule_id)
            .await
            .map_err(internal)?;
        if n == 0 {
            return Err(not_found(format!("rule {rule_id} not found")));
        }
        ok_json(serde_json::json!({"deleted": true}))
    }

    #[tool(description = "Dry-run a rule against current state: shows verdict and would-fire actions.")]
    async fn test_rule(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let rule = rules::find(&self.state.pool, user_id, rule_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found(format!("rule {rule_id} not found")))?;
        ok_json(
            exec::evaluate_dry(&self.state, &rule)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(
        description = "Rule debug payload: annotated condition tree, cooldown state, referenced monitors/groups/channels, recent firings."
    )]
    async fn debug_rule(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let rule = rules::find(&self.state.pool, user_id, rule_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found(format!("rule {rule_id} not found")))?;
        ok_json(
            rule_debug::build(&self.state, user_id, &rule)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(description = "Recent firings for a rule (matched / not_matched / cooldown_skipped / error).")]
    async fn list_rule_firings(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<ListFiringsArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let limit = args.limit.unwrap_or(50).clamp(1, 100);
        ok_json(
            rule_firings::list_recent_for_rule(&self.state.pool, user_id, rule_id, limit)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(description = "List the last 5 snapshots of a rule (auto-pruned).")]
    async fn list_rule_versions(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        ok_json(
            rules::list_versions(&self.state.pool, user_id, rule_id)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(description = "Restore a rule to a previous version (creates a new version row).")]
    async fn restore_rule_version(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<RuleVersionArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let rule_id = parse_uuid(&args.rule_id, "rule_id")?;
        let payload =
            rules::find_version_payload(&self.state.pool, user_id, rule_id, &args.version_id)
                .await
                .map_err(internal)?
                .ok_or_else(|| {
                    not_found(format!(
                        "rule {} version {} not found",
                        rule_id, args.version_id
                    ))
                })?;
        let snap: Rule = serde_json::from_value(payload).map_err(internal)?;
        let condition: Condition = serde_json::from_value(snap.condition.clone())
            .map_err(|e| bad_request(format!("decode condition: {e}")))?;
        let actions: Vec<Action> = serde_json::from_value(snap.actions.clone())
            .map_err(|e| bad_request(format!("decode actions: {e}")))?;
        let rule = rule_save_inner(
            &self.state,
            user_id,
            Some(rule_id),
            RuleUpsertInput {
                name: snap.name,
                is_enabled: snap.is_enabled,
                condition,
                actions,
                cooldown_seconds: snap.cooldown_seconds,
                metadata: snap.metadata,
                comment: Some(format!("restore from {}", args.version_id)),
            },
        )
        .await
        .map_err(|e| bad_request(e.to_string()))?;
        ok_json(rule)
    }

    // ----- channels -----

    #[tool(description = "List notification channels.")]
    async fn list_channels(
        &self,
        ctx: RequestContext<RoleServer>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        ok_json(
            notification_channels::list_for_user(&self.state.pool, user_id)
                .await
                .map_err(internal)?,
        )
    }

    #[tool(description = "Read one notification channel.")]
    async fn get_channel(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<ChannelIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let channel_id = parse_uuid(&args.channel_id, "channel_id")?;
        let row = notification_channels::find(&self.state.pool, user_id, channel_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found(format!("channel {channel_id} not found")))?;
        ok_json(row)
    }

    #[tool(
        description = "Create a notification channel. kind ∈ {email, slack, discord, webhook}; config schema per kind in CLAUDE.md §13."
    )]
    async fn create_channel(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<ChannelCreateArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        if args.name.trim().is_empty() {
            return Err(bad_request("name must not be empty"));
        }
        crate::notifications::adapters::validate_config(&args.kind, &args.config)
            .map_err(bad_request)?;
        let row = notification_channels::create(
            &self.state.pool,
            user_id,
            &UpsertChannel {
                kind: args.kind,
                name: args.name,
                config: args.config,
                enabled: args.enabled,
            },
        )
        .await
        .map_err(internal)?;
        ok_json(row)
    }

    #[tool(description = "Update a notification channel.")]
    async fn update_channel(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<ChannelUpdateArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let channel_id = parse_uuid(&args.channel_id, "channel_id")?;
        if args.name.trim().is_empty() {
            return Err(bad_request("name must not be empty"));
        }
        crate::notifications::adapters::validate_config(&args.kind, &args.config)
            .map_err(bad_request)?;
        let row = notification_channels::update(
            &self.state.pool,
            user_id,
            channel_id,
            &UpsertChannel {
                kind: args.kind,
                name: args.name,
                config: args.config,
                enabled: args.enabled,
            },
        )
        .await
        .map_err(internal)?
        .ok_or_else(|| not_found(format!("channel {channel_id} not found")))?;
        ok_json(row)
    }

    #[tool(description = "Delete a notification channel.")]
    async fn delete_channel(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(args): Parameters<ChannelIdArgs>,
    ) -> Result<String, McpError> {
        let user_id = auth_from_ctx(&ctx)?;
        let channel_id = parse_uuid(&args.channel_id, "channel_id")?;
        let n = notification_channels::delete(&self.state.pool, user_id, channel_id)
            .await
            .map_err(internal)?;
        if n == 0 {
            return Err(not_found(format!("channel {channel_id} not found")));
        }
        ok_json(serde_json::json!({"deleted": true}))
    }
}

#[tool_handler]
impl ServerHandler for McpServer {}
