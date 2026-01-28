import { describe, expect, it } from 'vitest';
import {
  CONTEXT_VERSION,
  type ContextData,
  ContextDataSchema,
  type ContextMetadata,
  ContextMetadataSchema,
  type ConversationHistory,
  ConversationHistorySchema,
  type FileMetadata,
  FileMetadataSchema,
  type HookInput,
  HookInputSchema,
  type ToolExecution,
  ToolExecutionSchema,
  TranscriptEntrySchema,
  migrateContextData,
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

  describe('TranscriptEntrySchema', () => {
    it('validates user entry', () => {
      const entry = {
        type: 'user',
        message: { role: 'user', content: 'Hello assistant' },
      };

      const result = TranscriptEntrySchema.safeParse(entry);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('user');
        if (result.data.type === 'user') {
          expect(result.data.message.content).toBe('Hello assistant');
        }
      }
    });

    it('validates assistant entry', () => {
      const entry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello user' }],
        },
      };

      const result = TranscriptEntrySchema.safeParse(entry);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('assistant');
      }
    });

    it('validates summary entry', () => {
      const entry = { type: 'summary', summary: 'Session summary here' };

      const result = TranscriptEntrySchema.safeParse(entry);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('summary');
        if (result.data.type === 'summary') {
          expect(result.data.summary).toBe('Session summary here');
        }
      }
    });

    it('validates progress entry', () => {
      const entry = { type: 'progress', data: { hookEvent: 'SessionStart' } };

      const result = TranscriptEntrySchema.safeParse(entry);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('progress');
      }
    });

    it('validates file-history-snapshot entry', () => {
      const entry = { type: 'file-history-snapshot', snapshot: {} };

      const result = TranscriptEntrySchema.safeParse(entry);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('file-history-snapshot');
      }
    });

    it('rejects unknown entry type', () => {
      const entry = { type: 'unknown', content: 'Invalid' };

      const result = TranscriptEntrySchema.safeParse(entry);

      expect(result.success).toBe(false);
    });
  });

  describe('ConversationHistorySchema', () => {
    it('validates conversation with messages', () => {
      const history = {
        messages: [
          { type: 'user', message: { role: 'user', content: 'Hello' } },
          {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hi there' }],
            },
          },
        ],
        messageCount: 2,
        tokenEstimate: 100,
      };

      const result = ConversationHistorySchema.safeParse(history);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.messages).toHaveLength(2);
        expect(result.data.messageCount).toBe(2);
        expect(result.data.tokenEstimate).toBe(100);
      }
    });

    it('allows optional tokenEstimate', () => {
      const history = {
        messages: [],
        messageCount: 0,
      };

      const result = ConversationHistorySchema.safeParse(history);

      expect(result.success).toBe(true);
    });
  });

  describe('FileMetadataSchema', () => {
    it('validates file metadata with all fields', () => {
      const file = {
        path: '/src/index.ts',
        lastAccessed: Date.now(),
        accessCount: 5,
        contentHash: 'abc123',
      };

      const result = FileMetadataSchema.safeParse(file);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe('/src/index.ts');
        expect(result.data.accessCount).toBe(5);
      }
    });

    it('allows optional contentHash', () => {
      const file = {
        path: '/src/index.ts',
        lastAccessed: Date.now(),
        accessCount: 1,
      };

      const result = FileMetadataSchema.safeParse(file);

      expect(result.success).toBe(true);
    });
  });

  describe('ToolExecutionSchema', () => {
    it('validates tool execution record', () => {
      const tool = {
        toolName: 'Read',
        timestamp: Date.now(),
        success: true,
        durationMs: 150,
      };

      const result = ToolExecutionSchema.safeParse(tool);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolName).toBe('Read');
        expect(result.data.success).toBe(true);
        expect(result.data.durationMs).toBe(150);
      }
    });

    it('allows optional durationMs', () => {
      const tool = {
        toolName: 'Write',
        timestamp: Date.now(),
        success: false,
      };

      const result = ToolExecutionSchema.safeParse(tool);

      expect(result.success).toBe(true);
    });
  });

  describe('ContextDataSchema v2.0.0', () => {
    it('validates v2.0.0 context with enriched fields', () => {
      const data: ContextData = {
        version: '2.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'session-123',
        summary: 'Enriched context',
        conversation: {
          messages: [
            { type: 'user', message: { role: 'user', content: 'Hello' } },
            {
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Hi' }],
              },
            },
          ],
          messageCount: 2,
          tokenEstimate: 50,
        },
        files: [
          {
            path: '/src/index.ts',
            lastAccessed: 1500,
            accessCount: 3,
          },
        ],
        toolHistory: [
          {
            toolName: 'Read',
            timestamp: 1200,
            success: true,
          },
        ],
        preferences: {
          codeStyle: 'functional',
        },
        isPreCompactionSnapshot: true,
        compactionTrigger: 'manual',
        preCompactionTokenCount: 50000,
      };

      const result = ContextDataSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('2.0.0');
        expect(result.data.conversation?.messages).toHaveLength(2);
        expect(result.data.files).toHaveLength(1);
        expect(result.data.toolHistory).toHaveLength(1);
        expect(result.data.isPreCompactionSnapshot).toBe(true);
      }
    });

    it('validates v1.0.0 context for backward compatibility', () => {
      const data = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'session-123',
        summary: 'Old format context',
        keyFiles: ['src/index.ts'],
        activeTasks: ['Fix bug'],
      };

      const result = ContextDataSchema.safeParse(data);

      expect(result.success).toBe(true);
    });
  });

  describe('migrateContextData', () => {
    it('migrates v1.0.0 context to v2.0.0', () => {
      const v1Data = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'session-123',
        summary: 'Old context',
        keyFiles: ['src/index.ts', 'src/types.ts'],
        activeTasks: ['Task 1', 'Task 2'],
      };

      const result = migrateContextData(v1Data);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.version).toBe(CONTEXT_VERSION);
        expect(result.value.summary).toBe('Old context');
        expect(result.value.keyFiles).toEqual(['src/index.ts', 'src/types.ts']);
        expect(result.value.activeTasks).toEqual(['Task 1', 'Task 2']);
        // v2 fields should be initialized
        expect(result.value.conversation).toBeUndefined();
        expect(result.value.files).toBeUndefined();
        expect(result.value.toolHistory).toBeUndefined();
      }
    });

    it('passes through v2.0.0 context unchanged', () => {
      const v2Data: ContextData = {
        version: '2.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'session-123',
        summary: 'New context',
        conversation: {
          messages: [
            { type: 'user', message: { role: 'user', content: 'Hello' } },
          ],
          messageCount: 1,
        },
      };

      const result = migrateContextData(v2Data);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.version).toBe('2.0.0');
        expect(result.value.conversation?.messages).toHaveLength(1);
      }
    });

    it('returns error for invalid context data', () => {
      const invalid = { garbage: true };

      const result = migrateContextData(invalid);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('CONTEXT_VERSION', () => {
    it('is set to 2.0.0', () => {
      expect(CONTEXT_VERSION).toBe('2.0.0');
    });
  });
});
