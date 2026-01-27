import { describe, expect, it } from 'vitest';
import {
  createAssistantEntry,
  createSummaryEntry,
  createSystemEntry,
  createTranscript,
  createUserEntry,
} from './transcript-factory.js';

describe('transcript-factory', () => {
  describe('createSummaryEntry', () => {
    it('creates a summary type entry', () => {
      const entry = createSummaryEntry('This is the summary');

      expect(entry.type).toBe('summary');
      expect(entry.summary).toBe('This is the summary');
    });
  });

  describe('createAssistantEntry', () => {
    it('creates an assistant type entry', () => {
      const entry = createAssistantEntry('Hello, I am an assistant');

      expect(entry.type).toBe('assistant');
      expect(entry.content).toBe('Hello, I am an assistant');
    });
  });

  describe('createUserEntry', () => {
    it('creates a user type entry', () => {
      const entry = createUserEntry('Hello, assistant');

      expect(entry.type).toBe('user');
      expect(entry.content).toBe('Hello, assistant');
    });
  });

  describe('createSystemEntry', () => {
    it('creates a system type entry', () => {
      const entry = createSystemEntry('Tool result: success');

      expect(entry.type).toBe('system');
      expect(entry.content).toBe('Tool result: success');
    });
  });

  describe('createTranscript', () => {
    it('creates JSONL format from entries', () => {
      const transcript = createTranscript([
        createAssistantEntry('First message'),
        createAssistantEntry('Second message'),
      ]);

      const lines = transcript.trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.type).toBe('assistant');
      expect(first.content).toBe('First message');

      const second = JSON.parse(lines[1]);
      expect(second.type).toBe('assistant');
      expect(second.content).toBe('Second message');
    });

    it('handles mixed entry types', () => {
      const transcript = createTranscript([
        createAssistantEntry('Working on task'),
        createSummaryEntry('Task completed successfully'),
      ]);

      const lines = transcript.trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.type).toBe('assistant');

      const second = JSON.parse(lines[1]);
      expect(second.type).toBe('summary');
    });

    it('returns empty string for empty entries', () => {
      const transcript = createTranscript([]);

      expect(transcript).toBe('');
    });
  });
});
