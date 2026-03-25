use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, Debug)]
pub(crate) struct CorrectionEntry {
    #[serde(rename = "match")]
    pub match_phrase: String,
    pub replace: String,
}

#[derive(Deserialize, Serialize, Default)]
pub(crate) struct CorrectionsFile {
    #[serde(default)]
    pub corrections: Vec<CorrectionEntry>,
}

pub(crate) fn corrections_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".taskflow/corrections.yaml")
}

pub(crate) fn load_corrections() -> Vec<CorrectionEntry> {
    let path = corrections_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(file) = serde_yaml::from_str::<CorrectionsFile>(&content) {
            return file.corrections;
        }
    }
    // Create empty corrections file
    let file = CorrectionsFile { corrections: Vec::new() };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = save_corrections_file(&file);
    Vec::new()
}

pub(crate) fn save_corrections_file(file: &CorrectionsFile) -> Result<(), String> {
    let path = corrections_path();
    let header = "# Auto-corrections applied after transcription\n\
                  # Corrections are phrase-based: match a phrase, replace with another\n";
    let yaml = serde_yaml::to_string(file).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{}{}", header, yaml)).map_err(|e| e.to_string())
}

pub(crate) fn apply_corrections(text: &str) -> String {
    let mut entries = load_corrections();
    if entries.is_empty() {
        return text.to_string();
    }

    // Sort by match length descending so longer phrases match first
    entries.sort_by(|a, b| b.match_phrase.len().cmp(&a.match_phrase.len()));

    let mut result = text.to_string();

    for entry in &entries {
        let escaped = regex_lite_escape(&entry.match_phrase);
        // Single-word matches use word boundaries; multi-word use exact phrase match
        let is_single_word = !entry.match_phrase.contains(' ');
        let pattern = if is_single_word {
            format!(r"(?i)\b{}\b", escaped)
        } else {
            // For multi-word: match with flexible whitespace between words
            let parts: Vec<&str> = entry.match_phrase.split_whitespace().collect();
            let escaped_parts: Vec<String> = parts.iter().map(|p| regex_lite_escape(p)).collect();
            format!(r"(?i)\b{}\b", escaped_parts.join(r"\s+"))
        };
        if let Ok(re) = regex_lite::Regex::new(&pattern) {
            result = re.replace_all(&result, entry.replace.as_str()).to_string();
        }
    }

    result
}

pub(crate) fn regex_lite_escape(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$' => {
                escaped.push('\\');
                escaped.push(c);
            }
            _ => escaped.push(c),
        }
    }
    escaped
}
