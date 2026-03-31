pub(crate) fn find_section_byte_offset(content: &str, section_name: &str) -> Option<usize> {
    use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};

    let mut in_h1 = false;
    let mut heading_start: usize = 0;

    for (event, range) in Parser::new_ext(content, Options::empty()).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level: HeadingLevel::H1, .. }) => {
                in_h1 = true;
                heading_start = range.start;
            }
            Event::Text(ref text) if in_h1 => {
                if text.trim() == section_name {
                    return Some(heading_start);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                in_h1 = false;
            }
            _ => {}
        }
    }
    None
}

pub(crate) fn daily_log_skeleton(date_str: &str) -> String {
    format!("# {} - Daily Log\n\n# Summary\n\n\n# Open Tasks\n\n\n# Todos\n\n\n# Timers\n\n\n# Completed Work\n\n", date_str)
}

/// Ensure a log file has the v2 section structure. If sections are missing,
/// append them so that section-aware insertion works correctly.
pub(crate) fn ensure_log_sections(content: &str, date_str: &str) -> String {
    let mut result = content.to_string();

    // If there's no h1 at all, prepend the title
    if !result.contains("# ") {
        result = format!("# {} - Daily Log\n\n{}", date_str, result);
    }

    // Ensure # Summary exists
    if find_section_byte_offset(&result, "Summary").is_none() {
        // Insert after the first line (h1 title)
        if let Some(pos) = result.find('\n') {
            result.insert_str(pos + 1, "\n# Summary\n\n");
        } else {
            result.push_str("\n\n# Summary\n\n");
        }
    }

    // Ensure # Open Tasks exists (between Summary and Todos)
    if find_section_byte_offset(&result, "Open Tasks").is_none() {
        match find_section_byte_offset(&result, "Todos") {
            Some(pos) => result.insert_str(pos, "# Open Tasks\n\n\n"),
            None => {
                match find_section_byte_offset(&result, "Completed Work") {
                    Some(pos) => result.insert_str(pos, "# Open Tasks\n\n\n"),
                    None => result.push_str("\n# Open Tasks\n\n\n"),
                }
            }
        }
    }

    // Ensure # Todos exists
    if find_section_byte_offset(&result, "Todos").is_none() {
        // Insert before # Completed Work if it exists, otherwise before EOF
        match find_section_byte_offset(&result, "Completed Work") {
            Some(pos) => result.insert_str(pos, "# Todos\n\n\n"),
            None => result.push_str("\n# Todos\n\n\n"),
        }
    }

    // Ensure # Timers exists (between Todos and Completed Work)
    if find_section_byte_offset(&result, "Timers").is_none() {
        match find_section_byte_offset(&result, "Completed Work") {
            Some(pos) => result.insert_str(pos, "# Timers\n\n\n"),
            None => result.push_str("\n# Timers\n\n\n"),
        }
    }

    // Ensure # Completed Work exists
    if find_section_byte_offset(&result, "Completed Work").is_none() {
        result.push_str("# Completed Work\n\n");
    }

    result
}

/// Extracts the body text of a named `# Heading` section from a log file.
/// Returns everything between the heading and the next `# ` heading (or EOF).
pub(crate) fn extract_section(content: &str, heading: &str) -> String {
    let target = format!("# {}", heading);
    let mut in_section = false;
    let mut lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        if line.trim_end() == target {
            in_section = true;
            continue;
        }
        if in_section {
            // Stop at the next H1 section (but not H2/H3 entries within the section)
            if line.starts_with("# ") && !line.starts_with("## ") && !line.starts_with("### ") {
                break;
            }
            lines.push(line);
        }
    }

    lines.join("\n").trim().to_string()
}
