import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import { runHookCommand } from '../../../src/cli/hook-command.js';
import type { ContextData } from '../../../src/core/types.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
  CONTEXT_FILE_LEGACY,
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

    it('handles SessionStart with compact source (load only, no save)', async () => {
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

      // Verify context was NOT saved (saving is via MCP only)
      const exists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(exists).toBe(false);
    });

    it('handles SessionEnd as no-op (saving via MCP only)', async () => {
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
      // Write to legacy JSON format for test fixture
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
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
