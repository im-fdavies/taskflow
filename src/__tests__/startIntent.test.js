import { describe, it, expect } from 'vitest';
import { isStartIntent, fuzzyMatchTask } from '../js/logic.js';

describe('isStartIntent', () => {
  it('returns false when there is an active task (context switch)', () => {
    expect(isStartIntent("Starting PR amends", "Bug fix")).toBe(false);
  });

  it('detects "starting X" with no active task', () => {
    expect(isStartIntent("Starting the API refactor", null)).toBe(true);
  });

  it('detects "picking up X"', () => {
    expect(isStartIntent("Picking up the dashboard work", null)).toBe(true);
  });

  it('detects "working on X"', () => {
    expect(isStartIntent("Working on PR amends", null)).toBe(true);
  });

  it('detects "let me start X"', () => {
    expect(isStartIntent("Let me start the code review", null)).toBe(true);
  });

  it('detects "time to work on X"', () => {
    expect(isStartIntent("Time to work on the migration", null)).toBe(true);
  });

  it('detects "back to X"', () => {
    expect(isStartIntent("Back to the API refactor", null)).toBe(true);
  });

  it('returns true for plain task name with no exit markers and no active task', () => {
    expect(isStartIntent("PR amends", null)).toBe(true);
  });

  it('returns false when exit markers present even without active task', () => {
    expect(isStartIntent("I was working on the API, switching to PR amends", null)).toBe(false);
  });

  it('returns false with "done with" exit marker', () => {
    expect(isStartIntent("Done with the API, moving to tests", null)).toBe(false);
  });
});

describe('fuzzyMatchTask', () => {
  const candidates = [
    { name: "API refactor", bookmark: "Left off at auth middleware" },
    { name: "PR amends for feature-123", bookmark: null },
    { name: "Dashboard styling", bookmark: "Fix the padding on left panel" },
  ];

  it('returns null for empty candidates', () => {
    expect(fuzzyMatchTask("anything", [])).toBe(null);
  });

  it('returns null for empty task name', () => {
    expect(fuzzyMatchTask("", candidates)).toBe(null);
  });

  it('finds exact match (case insensitive)', () => {
    const result = fuzzyMatchTask("API refactor", candidates);
    expect(result).not.toBe(null);
    expect(result.match.name).toBe("API refactor");
    expect(result.score).toBe("exact");
  });

  it('finds contains match', () => {
    const result = fuzzyMatchTask("PR amends", candidates);
    expect(result).not.toBe(null);
    expect(result.match.name).toBe("PR amends for feature-123");
    expect(result.score).toBe("contains");
  });

  it('finds word overlap match', () => {
    const result = fuzzyMatchTask("the dashboard work", candidates);
    expect(result).not.toBe(null);
    expect(result.match.name).toBe("Dashboard styling");
    expect(result.score).toBe("overlap");
  });

  it('returns null when no match found', () => {
    const result = fuzzyMatchTask("Slack integration", candidates);
    expect(result).toBe(null);
  });
});
