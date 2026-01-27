import { beforeEach, describe, expect, it } from 'vitest';
import type { FileSystem } from '../../../src/adapters/fs/memory-fs.js';
import type { HookInput } from '../../../src/core/types.js';
import type { Logger } from '../../../src/infrastructure/logger.js';
import { isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
} from '../../../src/services/context-service.js';
import { createHookHandler } from '../../../src/services/hook-handler.js';
import { createContextData } from '../../fixtures/context-factory.js';
import {
  createTestEnv,
  setupContextFile,
} from '../../fixtures/test-helpers.js';

describe('Hook lifecycle integration', () => {
  let fs: FileSystem;
  let logger: Logger;
  const projectDir = '/project';
  const transcriptPath = '/home/user/.claude/sessions/test.jsonl';

  const createHookInput = (overrides?: Partial<HookInput>): HookInput => ({
    hook_event_name: 'SessionStart',
    session_id: 'test-session',
    cwd: projectDir,
    transcript_path: transcriptPath,
    source: 'startup',
    ...overrides,
  });

  beforeEach(() => {
    const env = createTestEnv({ projectDir });
    fs = env.fs;
    logger = env.logger;
  });

  describe('SessionStart with source=startup', () => {
    it('returns contextLoaded: false when no prior context exists', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({ source: 'startup' });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextLoaded).toBe(false);
        expect(result.value.contextSaved).toBe(false);
        expect(result.value.contextCleared).toBe(false);
      }
    });

    it('loads and returns existing context', async () => {
      const existingContext = createContextData({
        sessionId: 'previous-session',
        summary: 'Previous work summary',
        keyFiles: ['src/main.ts'],
      });
      await setupContextFile(fs, projectDir, existingContext);
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({ source: 'startup' });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextLoaded).toBe(true);
        expect(result.value.context).toBeDefined();
        expect(result.value.context?.sessionId).toBe('previous-session');
        expect(result.value.context?.summary).toBe('Previous work summary');
        expect(result.value.context?.keyFiles).toEqual(['src/main.ts']);
      }
    });
  });

  describe('SessionStart with source=resume', () => {
    it('behaves identically to startup', async () => {
      const existingContext = createContextData({
        sessionId: 'resumed-session',
        summary: 'Resume test',
      });
      await setupContextFile(fs, projectDir, existingContext);
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({ source: 'resume' });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextLoaded).toBe(true);
        expect(result.value.context?.sessionId).toBe('resumed-session');
      }
    });
  });

  describe('SessionStart with source=compact', () => {
    it('loads existing context after compaction (no save)', async () => {
      const existingContext = createContextData({
        sessionId: 'pre-compact-session',
        summary: 'Context before compaction',
      });
      await setupContextFile(fs, projectDir, existingContext);
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        source: 'compact',
        session_id: 'compact-session',
      });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextLoaded).toBe(true);
        expect(result.value.contextSaved).toBe(false);
        expect(result.value.context?.summary).toBe('Context before compaction');
      }
    });

    it('returns empty result when no existing context', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({ source: 'compact' });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextLoaded).toBe(false);
        expect(result.value.contextSaved).toBe(false);
      }
    });
  });

  describe('SessionStart with source=clear', () => {
    it('deletes existing context', async () => {
      await setupContextFile(fs, projectDir, createContextData());
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({ source: 'clear' });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextCleared).toBe(true);
      }

      const exists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(exists).toBe(false);
    });

    it('succeeds even when no context exists', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({ source: 'clear' });

      const result = await handler.handleSessionStart(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contextCleared).toBe(true);
      }
    });
  });

  describe('SessionEnd', () => {
    it('is a no-op (saving via MCP tool only)', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'SessionEnd',
        session_id: 'end-session',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({
          contextLoaded: false,
          contextSaved: false,
          contextCleared: false,
        });
      }
    });
  });

  describe('PreCompact', () => {
    it('is a no-op that returns success', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'PreCompact',
      });

      const result = await handler.handlePreCompact(input);

      expect(isOk(result)).toBe(true);
    });

    it('does not modify any files', async () => {
      await setupContextFile(fs, projectDir, createContextData());
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'PreCompact',
      });

      await handler.handlePreCompact(input);

      // Context should still exist unchanged
      const contextPath = `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`;
      const exists = await fs.exists(contextPath);
      expect(exists).toBe(true);
    });
  });

  describe('Unknown/other events', () => {
    it('handles unknown events as no-op', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'Stop' as HookInput['hook_event_name'],
        session_id: 'stop-session',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({
          contextLoaded: false,
          contextSaved: false,
          contextCleared: false,
        });
      }
    });
  });

  describe('handle dispatcher', () => {
    it('routes SessionStart to handleSessionStart', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect('contextLoaded' in result.value).toBe(true);
      }
    });

    it('handles SessionEnd as no-op', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'SessionEnd',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({
          contextLoaded: false,
          contextSaved: false,
          contextCleared: false,
        });
      }
    });

    it('routes PreCompact to handlePreCompact', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'PreCompact',
      });

      const result = await handler.handle(input);

      expect(isOk(result)).toBe(true);
    });

    it('handles unknown events as no-op', async () => {
      const handler = createHookHandler({ fs, logger });
      const input = createHookInput({
        hook_event_name: 'UnknownEvent' as HookInput['hook_event_name'],
      });

      const result = await handler.handle(input);

      // Unknown events are now no-ops instead of errors
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({
          contextLoaded: false,
          contextSaved: false,
          contextCleared: false,
        });
      }
    });
  });
});
