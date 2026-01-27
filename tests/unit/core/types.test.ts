import { describe, expect, it } from 'vitest';
import {
  type ContextData,
  ContextDataSchema,
  type ContextMetadata,
  ContextMetadataSchema,
  type HookInput,
  HookInputSchema,
  parseContextData,
  parseHookInput,
} from '../../../src/core/types.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';

describe('Core Types', () => {
  describe('HookInputSchema', () => {
    it('validates a valid SessionStart hook input', () => {
      const input = {
        session_id: 'abc123',
        transcript_path: '/home/user/.claude/projects/test/session.jsonl',
        cwd: '/home/user/project',
        permission_mode: 'default',
        hook_event_name: 'SessionStart',
        source: 'startup',
        model: 'claude-sonnet-4',
      };

      const result = HookInputSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.session_id).toBe('abc123');
        expect(result.data.source).toBe('startup');
      }
    });

    it('validates SessionStart with compact source', () => {
      const input = {
        session_id: 'abc123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/project',
        permission_mode: 'default',
        hook_event_name: 'SessionStart',
        source: 'compact',
        model: 'claude-sonnet-4',
      };

      const result = HookInputSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('compact');
      }
    });

    it('validates SessionEnd hook input', () => {
      const input = {
        session_id: 'abc123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/project',
        permission_mode: 'default',
        hook_event_name: 'SessionEnd',
        model: 'claude-sonnet-4',
      };

      const result = HookInputSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it('rejects input missing required fields', () => {
      const input = {
        session_id: 'abc123',
        // missing other required fields
      };

      const result = HookInputSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it('allows optional custom_instructions field', () => {
      const input = {
        session_id: 'abc123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/project',
        permission_mode: 'default',
        hook_event_name: 'PreCompact',
        trigger: 'manual',
        custom_instructions: 'Focus on API changes',
        model: 'claude-sonnet-4',
      };

      const result = HookInputSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.custom_instructions).toBe('Focus on API changes');
      }
    });
  });

  describe('parseHookInput', () => {
    it('returns Ok for valid input', () => {
      const input = {
        session_id: 'test-123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/project',
        permission_mode: 'default',
        hook_event_name: 'SessionStart',
        source: 'startup',
        model: 'claude-sonnet-4',
      };

      const result = parseHookInput(input);

      expect(isOk(result)).toBe(true);
    });

    it('returns Err for invalid input', () => {
      const input = { invalid: 'data' };

      const result = parseHookInput(input);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('HOOK_INVALID_INPUT');
      }
    });

    it('parses JSON string input', () => {
      const input = JSON.stringify({
        session_id: 'test-123',
        transcript_path: '/path/to/transcript.jsonl',
        cwd: '/project',
        permission_mode: 'default',
        hook_event_name: 'SessionEnd',
        model: 'claude-sonnet-4',
      });

      const result = parseHookInput(input);

      expect(isOk(result)).toBe(true);
    });

    it('returns Err for invalid JSON string', () => {
      const input = 'not valid json';

      const result = parseHookInput(input);

      expect(isErr(result)).toBe(true);
    });
  });

  describe('ContextDataSchema', () => {
    it('validates minimal context data', () => {
      const data = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'session-123',
        summary: 'Project context summary',
      };

      const result = ContextDataSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('validates context data with transcript content', () => {
      const data = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'session-123',
        summary: 'Summary of the session',
        transcriptExcerpt: 'Last 10 messages...',
      };

      const result = ContextDataSchema.safeParse(data);

      expect(result.success).toBe(true);
    });

    it('rejects context without required fields', () => {
      const data = {
        version: '1.0.0',
        // missing other required fields
      };

      const result = ContextDataSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe('ContextMetadataSchema', () => {
    it('validates metadata with all fields', () => {
      const metadata = {
        directory: '/project/path',
        directoryHash: 'abc123hash',
        lastSessionId: 'session-456',
        sessionCount: 5,
        lastSavedAt: Date.now(),
        transcriptPath: '/path/to/transcript.jsonl',
      };

      const result = ContextMetadataSchema.safeParse(metadata);

      expect(result.success).toBe(true);
    });
  });

  describe('parseContextData', () => {
    it('returns Ok for valid context data', () => {
      const data = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'session-123',
        summary: 'Test summary',
      };

      const result = parseContextData(data);

      expect(isOk(result)).toBe(true);
    });

    it('returns Err for invalid context data', () => {
      const data = { invalid: 'structure' };

      const result = parseContextData(data);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });
});
