// Resolves the templates/ directory.
// In dev mode CARGO_MANIFEST_DIR is src-tauri/ (compile-time), so
// one level up lands at the project root where templates/ lives.
// Falls back to cwd-relative paths in case of unusual layouts.
fn resolve_templates_dir() -> Option<std::path::PathBuf> {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../templates");
    if manifest_path.exists() {
        return Some(manifest_path);
    }
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join("templates");
        if p.exists() { return Some(p); }
        let p = cwd.join("../templates");
        if p.exists() { return Some(p); }
    }
    None
}

#[tauri::command(rename_all = "camelCase")]
pub fn load_templates() -> Result<Vec<serde_json::Value>, String> {
    use std::fs;

    let templates_dir = resolve_templates_dir()
        .ok_or_else(|| "templates/ directory not found".to_string())?;

    let mut templates = Vec::new();
    let entries = fs::read_dir(&templates_dir)
        .map_err(|e| format!("Cannot read templates dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();

        // Only process .yaml files, skip _schema.yaml and any hidden files
        let filename = path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("");

        if !filename.ends_with(".yaml") || filename.starts_with('_') {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", filename, e))?;

        let value: serde_json::Value = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", filename, e))?;

        templates.push(value);
    }

    Ok(templates)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_template(name: String) -> Result<serde_json::Value, String> {
    use std::fs;

    let templates_dir = resolve_templates_dir()
        .ok_or_else(|| "templates/ directory not found".to_string())?;
    let entries = fs::read_dir(&templates_dir)
        .map_err(|e| format!("Cannot read templates dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("{}", e))?;
        let path = entry.path();
        let filename = path.file_name().and_then(|f| f.to_str()).unwrap_or("");

        if !filename.ends_with(".yaml") || filename.starts_with('_') {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", filename, e))?;

        let value: serde_json::Value = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", filename, e))?;

        // Match by id field or name field
        let id_match = value.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s == name.as_str())
            .unwrap_or(false);
        let name_match = value.get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase() == name.to_lowercase())
            .unwrap_or(false);

        if id_match || name_match {
            return Ok(value);
        }
    }

    Err(format!("Template '{}' not found", name))
}
