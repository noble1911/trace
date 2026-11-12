//! What trace adds to every agent it starts, whichever transport hosts it: the
//! render bridge's coordinates, and for Claude its own tools (`--mcp-config`), the
//! turn hooks (`--settings`) and a third-party provider's endpoint and model; for
//! Codex its tools as `-c` overrides (`codex_wiring`). A ticket's agent, anywhere,
//! is also told which ticket it's for (`claude::context`).
//! Shared by the terminal (`commands::agent::spawn_in`) and the chat transport
//! (`agent_session::claude`), so the two can't drift apart.

use std::collections::HashMap;

use tauri::AppHandle;

use crate::claude::{hooks, render_bridge};
use crate::state::AppState;

/// The model, flags and environment an agent is started with once trace's own
/// wiring is added.
pub struct Wiring {
    pub model: Option<String>,
    /// The caller's flags with trace's appended after them.
    pub extra_args: Vec<String>,
    /// Never logged: a provider's entry carries its API key.
    pub env: HashMap<String, String>,
}

/// The render bridge's coordinates for `workspace_id`, which `trace-render` and
/// `trace-hook` read. Starts the bridge on first use; a failed bind yields a
/// disabled bridge (port 0) and nothing is injected.
pub fn bridge_env(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> HashMap<String, String> {
    let bridge = state
        .render_bridge
        .get_or_init(|| render_bridge::start(app.clone()).unwrap_or_default());
    let mut env = HashMap::new();
    if bridge.port != 0 {
        env.insert("TRACE_ISSUE_KEY".to_string(), workspace_id.to_string());
        env.insert("TRACE_RENDER_PORT".to_string(), bridge.port.to_string());
        env.insert("TRACE_RENDER_TOKEN".to_string(), bridge.token.clone());
    }
    env
}

/// Everything trace adds to a Claude agent: [`bridge_env`], its tools and hooks,
/// and the provider's endpoint. A provider also replaces a model that isn't its own.
/// `chat` says which transport will host it: only a chat agent routes its permission
/// prompts to trace (`--permission-prompt-tool stdio`), so only a chat agent can be
/// the one trace decides for. A terminal agent gets the rules as Claude's own.
pub fn claude_wiring(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
    model: Option<String>,
    provider: Option<&str>,
    mut extra_args: Vec<String>,
    chat: bool,
) -> Result<Wiring, String> {
    let env = bridge_env(app, state, workspace_id);
    let bridge_up = !env.is_empty();
    // Turn hooks (`claude::hooks`) report through the bridge, so they need it.
    // Appended last: `--settings <json>` also ends any variadic user flag
    // (e.g. `--allowedTools Bash Edit`) that would otherwise swallow a prompt.
    // Best-effort — without them the renderer falls back to its quiet timer.
    // trace's own tools (`agent_tools`), before `--settings` for the same
    // reason: `--mcp-config` is variadic too. Bind failure = no tools.
    let tools = state
        .tool_server
        .get_or_init(|| crate::agent_tools::server::start(app.clone()).unwrap_or_default());
    let has_tools = tools.port != 0;
    if has_tools {
        extra_args.push("--mcp-config".to_string());
        extra_args.push(crate::agent_tools::mcp_config_arg(tools, workspace_id));
    }
    // The permission rules ride in the same `--settings`, and unlike the hooks they
    // don't need the bridge: an agent trace decides for is held by its ask rule.
    let perms = crate::permissions::settings_perms(workspace_id, chat, has_tools);
    if bridge_up || !perms.is_empty() {
        if let Ok(settings) = hooks::settings_arg(&perms, bridge_up) {
            extra_args.push("--settings".to_string());
            extra_args.push(settings);
        }
    }
    let mut wiring = provider_wiring(workspace_id, model, provider, extra_args)?;
    wiring.env.extend(env);
    Ok(wiring)
}

/// The provider's endpoint and model, and which ticket it's for: all a Claude
/// agent gets where trace's loopback hooks and tools can't reach it, such as one
/// in a cloud sandbox (`execution`). Every Claude start comes through here.
pub fn provider_wiring(
    workspace_id: &str,
    model: Option<String>,
    provider: Option<&str>,
    extra_args: Vec<String>,
) -> Result<Wiring, String> {
    let extra_args = crate::claude::context::with_context(extra_args, workspace_id);
    let mut model = model;
    let mut env = HashMap::new();
    if let Some(spec) = provider.and_then(crate::commands::providers::spec) {
        model = Some(provider_model(
            model.as_deref(),
            spec.model_prefix,
            spec.default_model,
        ));
        let provider_model = model.as_deref().unwrap_or(spec.default_model);
        env.extend(crate::commands::providers::env(spec, provider_model)?);
    }
    Ok(Wiring {
        model,
        extra_args,
        env,
    })
}

/// What trace adds to a Codex agent, either transport: [`bridge_env`], and its
/// tools as `-c` overrides with the token in the env (`agent_tools::codex`).
/// trace's flags go first, so the user's own `-c` flags still win.
pub fn codex_wiring(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
    model: Option<String>,
    extra_args: Vec<String>,
) -> Wiring {
    let mut env = bridge_env(app, state, workspace_id);
    let tools = state
        .tool_server
        .get_or_init(|| crate::agent_tools::server::start(app.clone()).unwrap_or_default());
    // Instructions set here replace the user's own, so a user who has some keeps
    // them: their agent still has `TRACE_ISSUE_KEY` in its environment.
    let theirs = crate::agent_tools::codex::user_has_instructions();
    let instructions = (!theirs).then(|| {
        let base = crate::agent_tools::rpc::INSTRUCTIONS;
        match crate::claude::context::workspace_context(workspace_id) {
            Some(context) => format!("{base}\n\n{context}"),
            None => base.to_string(),
        }
    });
    let (mut args, tool_env) =
        crate::agent_tools::codex::wiring(tools, workspace_id, instructions.as_deref());
    env.extend(tool_env);
    args.extend(extra_args);
    Wiring {
        model,
        extra_args: args,
        env,
    }
}

/// The model to run on a provider's endpoint. The Settings default targets
/// Anthropic (e.g. "fable") and doesn't resolve there, so only a model that
/// clearly belongs to the provider is kept. The prefix match ignores case, so
/// Wafer's `Kimi-K3` and a typed `kimi-k3-fast` both count. Resolved before the
/// env is built so the DEFAULT_*/SUBAGENT aliases pin to the id `--model` gets.
fn provider_model(model: Option<&str>, prefix: &str, default: &str) -> String {
    match model {
        Some(m)
            if m.to_ascii_lowercase()
                .starts_with(&prefix.to_ascii_lowercase()) =>
        {
            m.to_string()
        }
        _ => default.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::provider_model;

    #[test]
    fn a_provider_keeps_its_own_model_and_replaces_a_foreign_one() {
        assert_eq!(
            provider_model(Some("kimi-k3-fast"), "Kimi", "Kimi-K3"),
            "kimi-k3-fast"
        );
        assert_eq!(provider_model(Some("fable"), "Kimi", "Kimi-K3"), "Kimi-K3");
        assert_eq!(
            provider_model(None, "deepseek", "deepseek-v4-flash"),
            "deepseek-v4-flash"
        );
    }
}
