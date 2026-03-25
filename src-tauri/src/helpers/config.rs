#[derive(serde::Deserialize, Default)]
pub(crate) struct Config {
    pub api: Option<ApiConfig>,
    pub project: Option<ProjectConfig>,
}

#[derive(serde::Deserialize, Default)]
pub(crate) struct ApiConfig {
    pub anthropic_key: Option<String>,
}

#[derive(serde::Deserialize, Default)]
pub(crate) struct ProjectConfig {
    pub active_path: Option<String>,
}

pub(crate) fn load_config() -> Config {
    let path = dirs::home_dir()
        .map(|h| h.join(".taskflow/config.toml"));
    let content = path
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    toml::from_str(&content).unwrap_or_default()
}

pub(crate) fn load_api_key() -> Option<String> {
    // 1. Environment variable takes priority
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Some(key);
        }
    }

    // 2. ~/.taskflow/config.toml
    load_config().api?.anthropic_key
}
