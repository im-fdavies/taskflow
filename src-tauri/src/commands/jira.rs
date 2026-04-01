use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JiraTicket {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub status_category: String,
    pub priority: String,
    pub issue_type: String,
    pub parent_key: Option<String>,
    pub url: String,
}

#[derive(Serialize, Deserialize)]
pub struct JiraCache {
    pub tickets: Vec<JiraTicket>,
}

/// Read Jira sprint tickets from the local cache file.
/// Cache is populated externally by Claude via Atlassian MCP.
#[tauri::command(rename_all = "camelCase")]
pub fn read_jira_tickets() -> Vec<JiraTicket> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    let cache_path = home.join(".taskflow/jira-cache.json");
    if !cache_path.exists() {
        return vec![];
    }

    let content = match std::fs::read_to_string(&cache_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    match serde_json::from_str::<JiraCache>(&content) {
        Ok(cache) => cache.tickets,
        Err(_) => vec![],
    }
}

/// Shell out to the `claude` CLI to fetch current sprint tickets via Atlassian MCP
/// and write them to `~/.taskflow/jira-cache.json`. Returns the updated ticket list.
/// Falls back to the existing cache if the CLI call fails.
#[tauri::command(rename_all = "camelCase")]
pub async fn refresh_jira_cache() -> Vec<JiraTicket> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    let cache_path = home.join(".taskflow/jira-cache.json");

    let prompt = format!(
        r#"Use the searchJiraIssuesUsingJql MCP tool to fetch my current sprint tickets. Use these parameters:
- cloudId: "1acbc93f-17e5-4c15-86d6-a839a70c83e0"
- jql: "assignee = currentUser() AND sprint in openSprints()"

Then write the results to {} as JSON in this exact format:
{{
  "tickets": [
    {{
      "key": "PROJ-123",
      "summary": "Ticket title",
      "status": "In Progress",
      "statusCategory": "In Progress",
      "priority": "P3 - Major",
      "issueType": "Dev Task",
      "parentKey": "PROJ-100",
      "url": "https://immediateco.atlassian.net/browse/PROJ-123"
    }}
  ]
}}

Only output the JSON file, nothing else. If a field is missing, use an empty string. parentKey can be null if there is no parent."#,
        cache_path.display()
    );

    eprintln!("[TaskFlow] Jira refresh: running claude CLI with Atlassian MCP prompt");

    // Snapshot the cache modification time so we can detect if Claude actually wrote to it
    let pre_modified = cache_path.metadata().ok().and_then(|m| m.modified().ok());

    let output = tokio::process::Command::new("claude")
        .arg("-p")
        .arg(&prompt)
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout_str = String::from_utf8_lossy(&out.stdout);
            if out.status.success() {
                eprintln!("[TaskFlow] Jira refresh via claude CLI succeeded");
            } else {
                eprintln!(
                    "[TaskFlow] Jira refresh: claude CLI exited with status {}",
                    out.status
                );
                eprintln!("[TaskFlow] Jira refresh stdout: {}", stdout_str);
                eprintln!(
                    "[TaskFlow] Jira refresh stderr: {}",
                    String::from_utf8_lossy(&out.stderr)
                );
            }

            // Check if the cache file was actually updated
            let post_modified = cache_path.metadata().ok().and_then(|m| m.modified().ok());
            let cache_was_updated = match (pre_modified, post_modified) {
                (Some(pre), Some(post)) => post > pre,
                (None, Some(_)) => true,
                _ => false,
            };

            if !cache_was_updated {
                eprintln!("[TaskFlow] Jira refresh: cache file was not updated by Claude CLI, trying stdout parse");
                // Claude may have printed the JSON to stdout instead of writing the file
                if let Some(json_start) = stdout_str.find('{') {
                    let json_candidate = &stdout_str[json_start..];
                    if let Ok(cache) = serde_json::from_str::<JiraCache>(json_candidate) {
                        eprintln!("[TaskFlow] Jira refresh: parsed {} tickets from stdout, writing cache", cache.tickets.len());
                        if let Ok(json) = serde_json::to_string_pretty(&cache) {
                            let _ = std::fs::write(&cache_path, json);
                        }
                    }
                }
            }

            read_jira_tickets()
        }
        Err(e) => {
            eprintln!("[TaskFlow] Failed to run claude CLI for Jira refresh: {}", e);
            read_jira_tickets()
        }
    }
}
