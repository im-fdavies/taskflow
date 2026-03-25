use crate::helpers::config::load_api_key;
use crate::state::AppState;
use serde::Serialize;

#[derive(Serialize)]
pub struct LlmModeResult {
    pub mode: u8,
    pub reason: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_clarification_questions(
    transcription: String,
    template_name: String,
    template_context: String,
    exit_capture: String,
    max_questions: Option<u8>,
) -> Result<Vec<String>, String> {
    use std::time::Duration;

    // Load API key — skip silently if not configured
    let api_key = match load_api_key() {
        Some(k) => k,
        None => {
            eprintln!("[TaskFlow] ANTHROPIC_API_KEY not set and no config found — skipping clarification questions");
            return Ok(vec![]);
        }
    };

    let max_q = max_questions.unwrap_or(3);

    let system_prompt = "You are a context-switching assistant. The user is about to start a new task. \
Based on their voice description of what they're switching to and the workflow template that was selected, \
generate 1-3 short clarification questions that would help them approach the task better.\n\n\
Rules:\n\
- Only ask questions that genuinely help. If the user's description is clear enough, return fewer questions or none.\n\
- Never ask obvious questions. If the answer is already in what they said, don't ask.\n\
- Questions should be specific to the task, not generic productivity advice.\n\
- Keep each question to one sentence.\n\
- Frame questions as things to think about, not interrogation. Tone: helpful colleague, not manager.\n\
- Return ONLY a JSON array of strings. No preamble, no markdown, no explanation.\n\n\
Example good questions for \"PR amends\":\n\
- \"How many comments are there — is this a quick fix or a bigger rethink?\"\n\
- \"Did the reviewer flag any architectural concerns, or is it mostly style?\"\n\n\
Example bad questions (never ask these):\n\
- \"Are you ready to start?\" (useless)\n\
- \"What is the PR about?\" (they just told you)\n\
- \"Have you read the comments?\" (the template already tells them to)";

    let user_message = format!(
        "Task description: {transcription}\nExit context: {exit_capture}\nSelected template: {template_name}\nTemplate phases: {template_context}\n\nGenerate up to {max_q} clarification questions. Return ONLY a JSON array of strings."
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 300,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    // Extract text from Claude's response
    let text = json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Unexpected API response shape".to_string())?;

    // Parse the JSON array of questions
    let questions: Vec<String> = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse questions JSON: {e}. Raw: {text}"))?;

    Ok(questions)
}

// ---------------------------------------------------------------------------
// Exit interview — single follow-up question
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_exit_question(
    transcription: String,
    exit_context: String,
    task_name: String,
    template_name: String,
) -> Result<Option<String>, String> {
    use std::time::Duration;

    let api_key = match load_api_key() {
        Some(k) => k,
        None => return Ok(None),
    };

    let system_prompt = "You are a context-switch assistant. The user is closing out a task and handing off to their future self.\n\n\
You know what they said, what they extracted as their current task state, and what they are switching to.\n\n\
Generate exactly ONE short follow-up question that would help them leave a better exit note.\n\n\
The question MUST meet all three criteria:\n\
1. The answer is NOT already present in what they said or their exit context\n\
2. The answer would meaningfully change what they do when they come back (e.g. \"committed\" vs \"mid-change\" changes re-entry entirely)\n\
3. It is specific to this task — not generic productivity advice\n\n\
If no such question exists, return null.\n\n\
Return ONLY a JSON string (the question) or JSON null. No preamble, no markdown, no explanation.\n\n\
Examples of GOOD questions:\n\
- \"Is that committed and pushed, or still in your working tree?\"\n\
- \"Is the failing test a new one you wrote, or an existing one that broke?\"\n\
- \"Did you leave a TODO comment where you stopped, or is the stopping point implicit?\"\n\n\
Examples of BAD questions (never ask these):\n\
- \"What were you working on?\" (they already said)\n\
- \"How are you feeling?\" (not actionable)\n\
- \"Have you saved your work?\" (generic, not task-specific)";

    let user_message = format!(
        "Full transcription: {transcription}\n\
         Extracted exit context: {exit_context}\n\
         Task name: {task_name}\n\
         Template: {template_name}\n\n\
         Return a single JSON string question, or null."
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 120,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    let text = json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Unexpected API response shape".to_string())?;

    let trimmed = text.trim();

    // LLM returned null — no useful question
    if trimmed == "null" {
        return Ok(None);
    }

    // Parse the question string
    let question: String = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse question JSON: {e}. Raw: {trimmed}"))?;

    if question.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(question))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn check_ollama(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    use std::time::Duration;

    {
        let cached = state.ollama_available.lock().expect("ollama cache lock poisoned");
        if let Some(available) = *cached {
            return Ok(available);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let available = match client.get("http://localhost:11434/api/tags").send().await {
        Ok(r) => r.status().is_success(),
        Err(e) => {
            eprintln!("[TaskFlow] Ollama not available: {e}");
            false
        }
    };

    *state.ollama_available.lock().expect("ollama cache lock poisoned") = Some(available);
    Ok(available)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn detect_mode_llm(
    transcription: String,
    current_task: Option<String>,
) -> Result<LlmModeResult, String> {
    use std::time::Duration;

    let task_str = current_task.as_deref().unwrap_or("none");

    let prompt = format!(
        "Classify this context switch description into exactly one mode.\n\n\
         COMPLETE: The user has finished a task and is logging what they did. They are NOT switching to a new task - they are wrapping up and returning to idle.\n\
         URGENT: The user explicitly says something is urgent, broken, or on fire. They need to act immediately.\n\
         LIGHT: The user has finished their previous task cleanly, or the new task is closely related to what they were doing. No stress, just moving on.\n\
         FULL: The user was interrupted, pulled away, or is switching to something unrelated. They need to decompress from the previous context.\n\n\
         Description: \"{transcription}\"\n\
         Current task: \"{task_str}\"\n\n\
         Reply with ONLY a JSON object: {{\"mode\": 1, \"reason\": \"one short phrase\"}}\n\
         Where mode is: 1=FULL, 2=LIGHT, 3=URGENT, 4=COMPLETE"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let body = serde_json::json!({
        "model": "llama3.1:8b",
        "prompt": prompt,
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned status {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {e}"))?;

    let raw = json
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Extract JSON from the response (LLM may wrap it in markdown fences)
    let parsed: Option<(u8, String)> = (|| {
        let start = raw.find('{')?;
        let end = raw[start..].find('}')? + start + 1;
        let snippet = &raw[start..end];
        let obj: serde_json::Value = serde_json::from_str(snippet).ok()?;
        let mode = obj.get("mode")?.as_u64()? as u8;
        let reason = obj
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("llm")
            .to_string();
        if (1..=4).contains(&mode) {
            Some((mode, reason))
        } else {
            None
        }
    })();

    match parsed {
        Some((mode, reason)) => {
            eprintln!("[TaskFlow] Ollama classified → mode {mode}, reason: {reason}");
            Ok(LlmModeResult { mode, reason })
        }
        None => {
            eprintln!("[TaskFlow] Ollama response unparseable, defaulting to mode 1. Raw: {raw}");
            Ok(LlmModeResult {
                mode: 1,
                reason: "parse-fallback".to_string(),
            })
        }
    }
}
