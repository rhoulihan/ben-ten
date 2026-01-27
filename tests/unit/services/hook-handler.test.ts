import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import type { ContextData, HookInput } from '../../../src/core/types.js';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
} from '../../../src/services/context-service.js';
import {
  type HookHandler,
  createHookHandler,
} from '../../../src/services/hook-handler.js';

describe('HookHandler', () => {
  let fs: FileSystem;
  let handler: HookHandler;
  const projectDir = '/project';

  const createHookInput = (overrides: Partial<HookInput> = {}): HookInput => ({
    session_id: 'test-session-123',
    transcript_path: '/home/user/.claude/sessions/test.jsonl',
    cwd: projectDir,
    hook_event_name: 'SessionStart',
    ...overrides,
  });

  beforeEach(() => {
    fs = createMemoryFs();
    const logger = createLogger({ level: LogLevel.ERROR });
    handler = createHookHandler({ fs, logger });
  });

  describe('handleSessionStart', () => {
    describe('with source="startup"', () => {
      it('returns empty context when no existing context', async () => {
        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'startup',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextLoaded).toBe(false);
          expect(result.value.context).toBeUndefined();
        }
      });

      it('loads existing context on startup', async () => {
        const existingContext: ContextData = {
          version: '1.0.0',
          createdAt: 1000,
          updatedAt: 2000,
          sessionId: 'previous-session',
          summary: 'Previous session summary',
        };
        await fs.writeFile(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
          JSON.stringify(existingContext),
        );

        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'startup',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextLoaded).toBe(true);
          expect(result.value.context?.summary).toBe(
            'Previous session summary',
          );
        }
      });
    });

    describe('with source="resume"', () => {
      it('loads existing context on resume', async () => {
        const existingContext: ContextData = {
          version: '1.0.0',
          createdAt: 1000,
          updatedAt: 2000,
          sessionId: 'previous-session',
          summary: 'Resumed session context',
        };
        await fs.writeFile(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
          JSON.stringify(existingContext),
        );

        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'resume',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextLoaded).toBe(true);
          expect(result.value.context?.summary).toBe('Resumed session context');
        }
      });
    });

    describe('with source="compact"', () => {
      it('reads transcript and saves new context after compaction', async () => {
        // Create a mock transcript file with compacted summary
        const transcriptContent = `${JSON.stringify({
          type: 'summary',
          summary: 'This is the compacted summary from Claude Code',
        })}\n`;
        await fs.writeFile(
          '/home/user/.claude/sessions/test.jsonl',
          transcriptContent,
        );

        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'compact',
          transcript_path: '/home/user/.claude/sessions/test.jsonl',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextSaved).toBe(true);
        }

        // Verify context was saved
        const contextExists = await fs.exists(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        );
        expect(contextExists).toBe(true);
      });

      it('extracts summary from transcript on compact', async () => {
        const transcriptContent = `${JSON.stringify({
          type: 'summary',
          summary: 'Extracted compaction summary',
        })}\n`;
        await fs.writeFile(
          '/home/user/.claude/sessions/test.jsonl',
          transcriptContent,
        );

        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'compact',
          transcript_path: '/home/user/.claude/sessions/test.jsonl',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);

        // Load the saved context and verify summary
        const savedContent = await fs.readFile(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        );
        if (isOk(savedContent)) {
          const saved = JSON.parse(savedContent.value) as ContextData;
          expect(saved.summary).toBe('Extracted compaction summary');
          expect(saved.sessionId).toBe('test-session-123');
        }
      });

      it('returns error when transcript cannot be read', async () => {
        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'compact',
          transcript_path: '/nonexistent/transcript.jsonl',
        });

        const result = await handler.handleSessionStart(input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe(ErrorCode.FS_NOT_FOUND);
        }
      });
    });

    describe('with source="clear"', () => {
      it('deletes existing context on clear', async () => {
        const existingContext: ContextData = {
          version: '1.0.0',
          createdAt: 1000,
          updatedAt: 2000,
          sessionId: 'old-session',
          summary: 'Old context to clear',
        };
        await fs.writeFile(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
          JSON.stringify(existingContext),
        );

        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'clear',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextCleared).toBe(true);
        }

        // Verify context was deleted
        const contextExists = await fs.exists(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        );
        expect(contextExists).toBe(false);
      });
    });
  });

  describe('handleSessionEnd', () => {
    it('reads transcript and saves context on session end', async () => {
      const transcriptContent = `${JSON.stringify({
        type: 'summary',
        summary: 'End of session summary',
      })}\n`;
      await fs.writeFile(
        '/home/user/.claude/sessions/test.jsonl',
        transcriptContent,
      );

      const input = createHookInput({
        hook_event_name: 'SessionEnd',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
      });

      const result = await handler.handleSessionEnd(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextSaved).toBe(true);
      }

      // Verify context was saved
      const contextExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(contextExists).toBe(true);
    });

    it('updates existing context with new session data', async () => {
      // Create existing context
      const existingContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'old-session',
        summary: 'Old summary',
      };
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        JSON.stringify(existingContext),
      );

      const transcriptContent = `${JSON.stringify({
        type: 'summary',
        summary: 'Updated session summary',
      })}\n`;
      await fs.writeFile(
        '/home/user/.claude/sessions/test.jsonl',
        transcriptContent,
      );

      const input = createHookInput({
        hook_event_name: 'SessionEnd',
        session_id: 'new-session-456',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
      });

      const result = await handler.handleSessionEnd(input);

      expect(isOk(result)).toBe(true);

      // Verify context was updated
      const savedContent = await fs.readFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      if (isOk(savedContent)) {
        const saved = JSON.parse(savedContent.value) as ContextData;
        expect(saved.summary).toBe('Updated session summary');
        expect(saved.sessionId).toBe('new-session-456');
        expect(saved.createdAt).toBe(1000); // Preserved from original
        expect(saved.updatedAt).toBeGreaterThan(2000); // Updated
      }
    });

    it('returns error when transcript cannot be read', async () => {
      const input = createHookInput({
        hook_event_name: 'SessionEnd',
        transcript_path: '/nonexistent/transcript.jsonl',
      });

      const result = await handler.handleSessionEnd(input);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.FS_NOT_FOUND);
      }
    });
  });

  describe('handlePreCompact', () => {
    it('is a no-op (returns success)', async () => {
      const input = createHookInput({
        hook_event_name: 'PreCompact',
      });

      const result = await handler.handlePreCompact(input);

      expect(isOk(result)).toBe(true);
    });
  });

  describe('handle (dispatcher)', () => {
    it('dispatches SessionStart events', async () => {
      const input = createHookInput({
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
    });

    it('dispatches SessionEnd events', async () => {
      const transcriptContent = `${JSON.stringify({
        type: 'summary',
        summary: 'Session summary',
      })}\n`;
      await fs.writeFile(
        '/home/user/.claude/sessions/test.jsonl',
        transcriptContent,
      );

      const input = createHookInput({
        hook_event_name: 'SessionEnd',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
    });

    it('dispatches PreCompact events', async () => {
      const input = createHookInput({
        hook_event_name: 'PreCompact',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
    });
  });
});
