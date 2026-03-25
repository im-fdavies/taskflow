use crate::helpers::vocabulary::{load_vocabulary, save_vocabulary_file, VocabularyFile};
use crate::helpers::corrections::{load_corrections, save_corrections_file, CorrectionEntry, CorrectionsFile};

#[tauri::command(rename_all = "camelCase")]
pub fn get_vocabulary() -> Vec<String> {
    load_vocabulary()
}

#[tauri::command(rename_all = "camelCase")]
pub fn add_vocabulary_term(term: String) -> Result<Vec<String>, String> {
    let mut terms = load_vocabulary();
    let trimmed = term.trim().to_string();
    if trimmed.is_empty() {
        return Err("Term cannot be empty".to_string());
    }
    // Avoid duplicates (case-insensitive)
    if !terms.iter().any(|t| t.eq_ignore_ascii_case(&trimmed)) {
        terms.push(trimmed);
        let file = VocabularyFile { terms: terms.clone() };
        save_vocabulary_file(&file)?;
    }
    Ok(terms)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_corrections() -> Vec<serde_json::Value> {
    load_corrections()
        .into_iter()
        .map(|e| serde_json::json!({ "match": e.match_phrase, "replace": e.replace }))
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub fn add_correction(match_phrase: String, replacement: String) -> Result<Vec<serde_json::Value>, String> {
    let match_phrase = match_phrase.trim().to_string();
    let replacement = replacement.trim().to_string();
    if match_phrase.is_empty() || replacement.is_empty() {
        return Err("Both match_phrase and replacement must be non-empty".to_string());
    }
    let mut entries = load_corrections();
    // Remove existing entry for same match phrase (case-insensitive) to avoid duplicates
    entries.retain(|e| !e.match_phrase.eq_ignore_ascii_case(&match_phrase));
    entries.push(CorrectionEntry { match_phrase, replace: replacement });
    let file = CorrectionsFile { corrections: entries.clone() };
    save_corrections_file(&file)?;
    Ok(entries
        .into_iter()
        .map(|e| serde_json::json!({ "match": e.match_phrase, "replace": e.replace }))
        .collect())
}
