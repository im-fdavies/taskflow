import { describe, it, expect } from 'vitest';
import { isNoteIntent, extractNoteText } from '../js/logic.js';

describe('isNoteIntent', () => {
  it('returns true for "note the API key expires"', () => {
    expect(isNoteIntent("note the API key expires")).toBe(true);
  });

  it('returns true for "just a note about the meeting"', () => {
    expect(isNoteIntent("just a note about the meeting")).toBe(true);
  });

  it('returns true for "quick note check with Sarah"', () => {
    expect(isNoteIntent("quick note check with Sarah")).toBe(true);
  });

  it('returns true for "jot down fix the CSS"', () => {
    expect(isNoteIntent("jot down fix the CSS")).toBe(true);
  });

  it('returns true for "note to self the deploy script needs updating"', () => {
    expect(isNoteIntent("note to self the deploy script needs updating")).toBe(true);
  });

  it('returns true for "noting that the tests are flaky"', () => {
    expect(isNoteIntent("noting that the tests are flaky")).toBe(true);
  });

  it('returns true for "I want to note something"', () => {
    expect(isNoteIntent("I want to note something")).toBe(true);
  });

  it('returns true for "jot this down for later"', () => {
    expect(isNoteIntent("jot this down for later")).toBe(true);
  });

  it('returns true for "reminder to self call Bob"', () => {
    expect(isNoteIntent("reminder to self call Bob")).toBe(true);
  });

  // Negative cases — should NOT match
  it('returns false for "I noted it already"', () => {
    expect(isNoteIntent("I noted it already")).toBe(false);
  });

  it('returns false for "notebook"', () => {
    expect(isNoteIntent("notebook")).toBe(false);
  });

  it('returns false for "notable achievement today"', () => {
    expect(isNoteIntent("notable achievement today")).toBe(false);
  });

  it('returns false for "switching to note taking app"', () => {
    expect(isNoteIntent("switching to note taking app")).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isNoteIntent("")).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNoteIntent(null)).toBe(false);
  });

  it('returns false for "PR amends"', () => {
    expect(isNoteIntent("PR amends")).toBe(false);
  });
});

describe('extractNoteText', () => {
  it('strips "note" prefix', () => {
    expect(extractNoteText("note the API key expires tomorrow")).toBe("the API key expires tomorrow");
  });

  it('strips "note to self" prefix', () => {
    expect(extractNoteText("note to self the deploy script needs updating")).toBe("the deploy script needs updating");
  });

  it('strips "just a note" prefix', () => {
    expect(extractNoteText("just a note about the meeting at 3pm")).toBe("about the meeting at 3pm");
  });

  it('strips "quick note" prefix', () => {
    expect(extractNoteText("quick note check with Sarah")).toBe("check with Sarah");
  });

  it('strips "jot down" prefix', () => {
    expect(extractNoteText("jot down fix the CSS")).toBe("fix the CSS");
  });

  it('strips "jot this down" prefix', () => {
    expect(extractNoteText("jot this down for later")).toBe("for later");
  });

  it('strips "noting that" prefix', () => {
    expect(extractNoteText("noting that tests are flaky")).toBe("tests are flaky");
  });

  it('strips "I want to note" prefix', () => {
    expect(extractNoteText("I want to note the deadline moved")).toBe("the deadline moved");
  });

  it('strips "reminder to self" prefix', () => {
    expect(extractNoteText("reminder to self call Bob")).toBe("call Bob");
  });

  it('returns empty string for bare "note"', () => {
    expect(extractNoteText("note")).toBe("");
  });

  it('returns empty string for null', () => {
    expect(extractNoteText(null)).toBe("");
  });

  it('strips leading punctuation after trigger', () => {
    expect(extractNoteText("note: the server is slow")).toBe("the server is slow");
  });
});
