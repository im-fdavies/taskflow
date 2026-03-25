import { describe, it, expect } from 'vitest';
import { parseTodoIntent } from '../logic.js';

describe('parseTodoIntent', () => {
  // "add X to my todos" pattern
  it('extracts from "add X to my todos"', () => {
    expect(parseTodoIntent('add fix the login bug to my todos')).toBe('fix the login bug');
  });

  it('extracts from "add X to my to-do list"', () => {
    expect(parseTodoIntent('add deploy staging to my to-do list')).toBe('deploy staging');
  });

  it('extracts from "add X to my list"', () => {
    expect(parseTodoIntent('add review docs to my list')).toBe('review docs');
  });

  it('extracts from "add X to my tasks"', () => {
    expect(parseTodoIntent('add write tests to my tasks')).toBe('write tests');
  });

  // "remember" / "remind me" pattern
  it('extracts from "remember X"', () => {
    expect(parseTodoIntent('remember to update the changelog')).toBe('to update the changelog');
  });

  it('extracts from "remind me to X"', () => {
    expect(parseTodoIntent('remind me to check CI')).toBe('check CI');
  });

  // Non-matching (no structured pattern, not from dashboard)
  it('returns null for bare text when not from dashboard', () => {
    expect(parseTodoIntent('fix the login page')).toBeNull();
  });

  it('returns null for "add" without tail', () => {
    expect(parseTodoIntent('add something')).toBeNull();
  });

  // Dashboard mode: accepts anything
  it('returns stripped text when fromDashboard=true', () => {
    expect(parseTodoIntent('fix the login page', true)).toBe('fix the login page');
  });

  it('strips filler words when fromDashboard=true', () => {
    expect(parseTodoIntent('I need to check the tests', true)).toBe('check the tests');
  });

  it('strips "add" prefix when fromDashboard=true', () => {
    expect(parseTodoIntent('add deploy staging', true)).toBe('deploy staging');
  });

  it('strips "please" prefix when fromDashboard=true', () => {
    expect(parseTodoIntent('please review the PR', true)).toBe('review the PR');
  });
});
