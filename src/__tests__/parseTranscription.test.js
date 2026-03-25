import { describe, it, expect } from 'vitest';
import { parseTranscription } from '../js/logic.js';

describe('parseTranscription', () => {
  it('returns empty result for null input', () => {
    expect(parseTranscription(null)).toEqual({ taskName: null, exitContext: null, bookmark: null });
  });

  it('returns empty result for empty string', () => {
    expect(parseTranscription('')).toEqual({ taskName: null, exitContext: null, bookmark: null });
  });

  // Simple entry markers
  it('extracts task from "switching to X"', () => {
    const r = parseTranscription('switching to PR amends');
    expect(r.taskName).toBe('PR amends');
  });

  it('extracts task from "I\'m moving to X"', () => {
    const r = parseTranscription("I'm moving to the auth module");
    expect(r.taskName).toBe('The auth module');
  });

  it('extracts task from "need to work on X"', () => {
    const r = parseTranscription('need to work on the health check bundle');
    expect(r.taskName).toBe('The health check bundle');
  });

  // Exit markers
  it('extracts exit context from "I was working on X"', () => {
    const r = parseTranscription('I was working on code review, switching to PR amends');
    expect(r.exitContext).toBe('Code review');
    expect(r.taskName).toBe('PR amends');
  });

  it('extracts exit from "done with X"', () => {
    const r = parseTranscription('done with unit tests, moving to documentation');
    expect(r.exitContext).toBe('Unit tests');
    expect(r.taskName).toBe('Documentation');
  });

  // Bookmark markers
  it('extracts bookmark from "when I come back, pick up X"', () => {
    const r = parseTranscription("I was working on auth, when I come back, pick up the failing test");
    expect(r.bookmark).toBeTruthy();
    expect(r.exitContext).toBe('Auth');
  });

  it('extracts bookmark from "need to remember to X"', () => {
    const r = parseTranscription("switching to docs, need to remember to fix the import");
    expect(r.taskName).toBe('Docs');
    expect(r.bookmark).toBeTruthy();
  });

  // Combined exit + entry
  it('handles full sentence with exit + entry', () => {
    const r = parseTranscription("I was working on the migration, switching to PR amends");
    expect(r.exitContext).toBe('The migration');
    expect(r.taskName).toBe('PR amends');
  });

  // Unclassified text (no markers)
  it('treats plain text as task name', () => {
    const r = parseTranscription('PR amends');
    expect(r.taskName).toBe('PR amends');
    expect(r.exitContext).toBeNull();
  });

  // Urgent mode signal
  it('extracts task from "urgent, X"', () => {
    const r = parseTranscription('urgent, deploy is broken');
    expect(r.taskName).toBe('Deploy is broken');
  });

  // Trailing punctuation is stripped
  it('strips trailing punctuation from task name', () => {
    const r = parseTranscription('switching to PR amends.');
    expect(r.taskName).toBe('PR amends');
  });

  // Capitalizes first letter
  it('capitalizes first letter of extracted fields', () => {
    const r = parseTranscription('switching to fixing the tests');
    expect(r.taskName).toMatch(/^[A-Z]/);
  });
});
