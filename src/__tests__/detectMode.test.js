import { describe, it, expect } from 'vitest';
import { detectMode } from '../logic.js';

describe('detectMode', () => {
  // Mode 3: urgent
  it('detects "urgent" keyword → mode 3', () => {
    expect(detectMode('urgent need to fix the deploy', null)).toEqual({ mode: 3, confidence: 'keyword' });
  });

  it('detects "urgent" mid-sentence → mode 3', () => {
    expect(detectMode('something urgent broke in prod', null)).toEqual({ mode: 3, confidence: 'keyword' });
  });

  // Mode 1: interrupted
  it('detects "interrupted" → mode 1 keyword', () => {
    expect(detectMode('I was interrupted while reviewing', null)).toEqual({ mode: 1, confidence: 'keyword' });
  });

  it('detects "pulled away" → mode 1 keyword', () => {
    expect(detectMode('got pulled away from the auth work', null)).toEqual({ mode: 1, confidence: 'keyword' });
  });

  it('detects "in the middle of" → mode 1 keyword', () => {
    expect(detectMode('in the middle of writing tests', null)).toEqual({ mode: 1, confidence: 'keyword' });
  });

  it('detects "was working on" → mode 1 keyword', () => {
    expect(detectMode('I was working on the API', null)).toEqual({ mode: 1, confidence: 'keyword' });
  });

  // Mode 4: completion
  it('detects "i just finished" → mode 4', () => {
    expect(detectMode('I just finished the auth module', null)).toEqual({ mode: 4, confidence: 'keyword' });
  });

  it('detects "wrapped up" → mode 4', () => {
    expect(detectMode('wrapped up the PR review', null)).toEqual({ mode: 4, confidence: 'keyword' });
  });

  it('detects "task is done" → mode 4', () => {
    expect(detectMode('the task is done', null)).toEqual({ mode: 4, confidence: 'keyword' });
  });

  // Mode 2: clean switch
  it('detects "finished" → mode 2 keyword', () => {
    expect(detectMode('finished that, moving to tests', null)).toEqual({ mode: 2, confidence: 'keyword' });
  });

  it('detects "done with" → mode 2 keyword', () => {
    expect(detectMode('done with the review', null)).toEqual({ mode: 2, confidence: 'keyword' });
  });

  it('detects "same pr" → mode 2 keyword', () => {
    expect(detectMode('same PR, different file', null)).toEqual({ mode: 2, confidence: 'keyword' });
  });

  it('detects "continuing" → mode 2 keyword', () => {
    expect(detectMode('continuing the migration', null)).toEqual({ mode: 2, confidence: 'keyword' });
  });

  // Mode 2: heuristic overlap
  it('detects task name overlap → mode 2 heuristic', () => {
    expect(detectMode('authentication service', 'working on authentication')).toEqual({ mode: 2, confidence: 'heuristic' });
  });

  it('ignores short word overlap (≤3 chars)', () => {
    expect(detectMode('the API endpoint', 'fix the bug')).toEqual({ mode: 1, confidence: 'default' });
  });

  // Default
  it('returns mode 1 default for ambiguous text', () => {
    expect(detectMode('PR amends', null)).toEqual({ mode: 1, confidence: 'default' });
  });

  // Priority: mode 1 "was working on" beats mode 2 "finished"
  it('mode 1 beats mode 2 when both present', () => {
    // "was working on" is mode 1, checked before mode 2 keywords
    const result = detectMode('I was working on the review', null);
    expect(result.mode).toBe(1);
  });

  // Priority: mode 3 urgent beats everything
  it('mode 3 urgent beats mode 1 signals', () => {
    const result = detectMode('urgent, was working on deploys', null);
    expect(result.mode).toBe(3);
  });

  // Priority: mode 4 "i just finished" beats mode 2 "finished"
  it('mode 4 "i just finished" beats mode 2', () => {
    const result = detectMode('I just finished the auth module', null);
    expect(result.mode).toBe(4);
  });
});
