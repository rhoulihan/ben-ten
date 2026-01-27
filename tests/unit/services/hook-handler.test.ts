import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import type { ContextData, HookInput } from '../../../src/core/types.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
  METADATA_FILE,
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

      it('stores transcript path in metadata', async () => {
        const transcriptPath = '/home/user/.claude/sessions/test.jsonl';
        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'startup',
          transcript_path: transcriptPath,
        });

        await handler.handleSessionStart(input);

        // Verify metadata was written with transcript path
        const metadataExists = await fs.exists(
          `${projectDir}/${BEN10_DIR}/${METADATA_FILE}`,
        );
        expect(metadataExists).toBe(true);

        const metadataContent = await fs.readFile(
          `${projectDir}/${BEN10_DIR}/${METADATA_FILE}`,
        );
        if (metadataContent.ok) {
          const metadata = JSON.parse(metadataContent.value);
          expect(metadata.transcriptPath).toBe(transcriptPath);
          expect(metadata.lastSessionId).toBe('test-session-123');
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
      it('loads existing context after compaction (no save)', async () => {
        // Create existing context
        const existingContext: ContextData = {
          version: '1.0.0',
          createdAt: 1000,
          updatedAt: 2000,
          sessionId: 'previous-session',
          summary: 'Existing context before compaction',
        };
        await fs.writeFile(
          `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
          JSON.stringify(existingContext),
        );

        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'compact',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextLoaded).toBe(true);
          expect(result.value.contextSaved).toBe(false);
          expect(result.value.context?.summary).toBe(
            'Existing context before compaction',
          );
        }
      });

      it('returns empty result when no existing context', async () => {
        const input = createHookInput({
          hook_event_name: 'SessionStart',
          source: 'compact',
        });

        const result = await handler.handleSessionStart(input);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.contextLoaded).toBe(false);
          expect(result.value.contextSaved).toBe(false);
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

    it('handles SessionEnd as no-op (saving via MCP only)', async () => {
      const input = createHookInput({
        hook_event_name: 'SessionEnd',
      });

      const result = await handler.handle(input);

      // SessionEnd is now a no-op - returns success without saving
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({
          contextLoaded: false,
          contextSaved: false,
          contextCleared: false,
        });
      }
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
