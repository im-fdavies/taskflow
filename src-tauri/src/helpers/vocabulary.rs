use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Default)]
pub(crate) struct VocabularyFile {
    #[serde(default)]
    pub terms: Vec<String>,
}

pub(crate) const DEFAULT_VOCABULARY: &[&str] = &[
    "PR amends",
    "pull request",
    "code review",
    "Tori invocation",
    "health check bundle",
    "Symfony",
    "unit tests",
    "authentication",
    "authorisation",
    "Copilot",
    "im-agent-skills",
    "handover",
    "unblocking",
];

pub(crate) fn vocabulary_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".taskflow/vocabulary.yaml")
}

pub(crate) fn load_vocabulary() -> Vec<String> {
    let path = vocabulary_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(file) = serde_yaml::from_str::<VocabularyFile>(&content) {
            return file.terms;
        }
    }
    // File doesn't exist or is invalid — create with defaults
    let terms: Vec<String> = DEFAULT_VOCABULARY.iter().map(|s| s.to_string()).collect();
    let file = VocabularyFile { terms: terms.clone() };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = save_vocabulary_file(&file);
    terms
}

pub(crate) fn save_vocabulary_file(file: &VocabularyFile) -> Result<(), String> {
    let path = vocabulary_path();
    let header = "# Terms that Whisper should recognise\n# These are fed to whisper.cpp via --prompt to bias transcription\n";
    let yaml = serde_yaml::to_string(file).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{}{}", header, yaml)).map_err(|e| e.to_string())
}

pub(crate) fn vocabulary_prompt_string() -> String {
    load_vocabulary().join(", ")
}
