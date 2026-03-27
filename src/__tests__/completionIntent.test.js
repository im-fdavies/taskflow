import { describe, it, expect } from 'vitest';
import { isCompletionIntent } from '../js/logic.js';

describe('isCompletionIntent', () => {
  it('returns true for "I have completed my task" with active task', () => {
    expect(isCompletionIntent("I have completed my task", "API refactor")).toBe(true);
  });

  it('returns true for "I\'m done" with active task', () => {
    expect(isCompletionIntent("I'm done", "PR amends")).toBe(true);
  });

  it('returns true for "wrapped up the review" with active task', () => {
    expect(isCompletionIntent("Wrapped up the review", "Code review")).toBe(true);
  });

  it('returns true for "I\'ve finished the work" with active task', () => {
    expect(isCompletionIntent("I've finished the work", "Bug fix")).toBe(true);
  });

  it('returns true for "task is done" with active task', () => {
    expect(isCompletionIntent("task is done", "Dashboard styling")).toBe(true);
  });

  it('returns true for "finished my PR review" with active task', () => {
    expect(isCompletionIntent("finished my PR review", "PR review")).toBe(true);
  });

  it('returns true for "completed my work" with active task', () => {
    expect(isCompletionIntent("completed my work", "Migration")).toBe(true);
  });

  it('returns false when no active task', () => {
    expect(isCompletionIntent("I have completed my task", null)).toBe(false);
  });

  it('returns false for plain "finished" (mode 2, not completion)', () => {
    expect(isCompletionIntent("finished that, switching to tests", "API refactor")).toBe(false);
  });

  it('returns false for bare "completed" (mode 2 keyword)', () => {
    expect(isCompletionIntent("completed the review, moving on", "Code review")).toBe(false);
  });

  it('returns false for regular task names', () => {
    expect(isCompletionIntent("PR amends", "Bug fix")).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCompletionIntent("", "Some task")).toBe(false);
  });
});
