import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import {
  type HookCommandResult,
  runHookCommand,
} from '../../../src/cli/hook-command.js';
import type { ContextData } from '../../../src/core/types.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
} from '../../../src/services/context-service.js';

describe('hook-command', () => {
  let fs: FileSystem;
  const projectDir = '/project';

  beforeEach(() => {
    fs = createMemoryFs();
  });

  describe('runHookCommand', () => {
    it('handles SessionStart with startup source', async () => {
      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.success).toBe(true);
      }
    });

    it('handles SessionStart with compact source', async () => {
      // Create transcript file
      const transcriptContent = `${JSON.stringify({
        type: 'summary',
        summary: 'Compacted summary content',
      })}\n`;
      await fs.writeFile(
        '/home/user/.claude/sessions/test.jsonl',
        transcriptContent,
      );

      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionStart',
        source: 'compact',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.success).toBe(true);
      }

      // Verify context was saved
      const exists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(exists).toBe(true);
    });

    it('handles SessionEnd', async () => {
      const transcriptContent = `${JSON.stringify({
        type: 'summary',
        summary: 'Session end summary',
      })}\n`;
      await fs.writeFile(
        '/home/user/.claude/sessions/test.jsonl',
        transcriptContent,
      );

      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionEnd',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.success).toBe(true);
      }
    });

    it('handles PreCompact (no-op)', async () => {
      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'PreCompact',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.success).toBe(true);
      }
    });

    it('returns error for invalid JSON input', async () => {
      const input = 'not valid json';

      const result = await runHookCommand(input, { fs });

      expect(isErr(result)).toBe(true);
    });

    it('returns error for invalid hook input structure', async () => {
      const input = JSON.stringify({
        invalid: 'structure',
      });

      const result = await runHookCommand(input, { fs });

      expect(isErr(result)).toBe(true);
    });

    it('outputs context to stdout when loading on startup', async () => {
      const existingContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'previous-session',
        summary: 'Previous session summary for stdout',
      };
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        JSON.stringify(existingContext),
      );

      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/home/user/.claude/sessions/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.output).toContain(
          'Previous session summary for stdout',
        );
      }
    });
  });
});
