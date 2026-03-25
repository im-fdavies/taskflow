use crate::helpers::corrections::apply_corrections;
use crate::helpers::vocabulary::vocabulary_prompt_string;

#[tauri::command(rename_all = "camelCase")]
pub fn transcribe_audio(wav_data: Vec<u8>) -> Result<String, String> {
    use std::fs;
    use std::process::Command;

    let tmp_path = "/tmp/taskflow_audio.wav";

    // Write WAV bytes to temp file
    fs::write(tmp_path, &wav_data)
        .map_err(|e| format!("Failed to write audio file: {}", e))?;

    // Expand home directory for whisper paths
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let whisper_bin = home.join("Documents/GitHub/whisper.cpp/build/bin/whisper-cli");
    let model_path = home.join("Documents/GitHub/whisper.cpp/models/ggml-base.en.bin");

    // Build vocabulary prompt from ~/.taskflow/vocabulary.yaml
    let prompt = vocabulary_prompt_string();

    // Spawn whisper-cli
    let output = Command::new(&whisper_bin)
    .args([
        "-m", model_path.to_str().unwrap(),
        "-f", tmp_path,
        "--no-timestamps",
        "--beam-size", "8",
        "--best-of", "5",
        "--language", "en",
        "--prompt", &prompt,
    ])
    .output()
    .map_err(|e| format!("Failed to spawn whisper-cli: {}", e))?;

    // Clean up temp file (best effort)
    let _ = fs::remove_file(tmp_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("whisper-cli failed: {}", stderr));
    }

    // Parse transcription from stdout
    let raw = String::from_utf8_lossy(&output.stdout);
    let text: String = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if text.is_empty() {
        return Err("No transcription returned".to_string());
    }

    // Apply corrections before returning
    Ok(apply_corrections(&text))
}
