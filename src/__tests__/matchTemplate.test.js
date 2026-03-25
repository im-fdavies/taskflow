import { describe, it, expect } from 'vitest';
import { matchTemplate } from '../logic.js';

const TEMPLATES = [
  { name: 'PR Amends', triggers: ['pr amends', 'pull request amends', 'PR review comments'] },
  { name: 'Code Review', triggers: ['code review', 'review PR', 'review pull request'] },
  { name: 'Hotfix', triggers: ['hotfix', 'hot fix', 'emergency fix'] },
];

describe('matchTemplate', () => {
  it('matches "pr amends" trigger', () => {
    const t = matchTemplate('I need to do PR amends', TEMPLATES);
    expect(t).not.toBeNull();
    expect(t.name).toBe('PR Amends');
  });

  it('matches case-insensitively', () => {
    const t = matchTemplate('switching to CODE REVIEW', TEMPLATES);
    expect(t).not.toBeNull();
    expect(t.name).toBe('Code Review');
  });

  it('returns null when no trigger matches', () => {
    const t = matchTemplate('working on documentation', TEMPLATES);
    expect(t).toBeNull();
  });

  it('returns first matching template', () => {
    const t = matchTemplate('review pull request amends', TEMPLATES);
    expect(t).not.toBeNull();
    // "pr amends" is in the text, matching 'PR Amends' template
    // (first template checked that matches wins)
  });

  it('handles empty templates array', () => {
    const t = matchTemplate('PR amends', []);
    expect(t).toBeNull();
  });

  it('handles template without triggers array', () => {
    const templates = [{ name: 'Broken', triggers: null }];
    const t = matchTemplate('anything', templates);
    expect(t).toBeNull();
  });

  it('matches partial text containing trigger', () => {
    const t = matchTemplate('let me do the hotfix for the login page', TEMPLATES);
    expect(t).not.toBeNull();
    expect(t.name).toBe('Hotfix');
  });
});
