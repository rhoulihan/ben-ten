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

    it('prompts user before loading context when it exists', async () => {
      const existingContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'previous-session',
        summary: 'Previous session summary for stdout',
      };
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
        // Should prompt, not auto-load
        expect(result.value.output).toContain('Context Found');
        expect(result.value.output).toContain('ben_ten_load');
        // Should show preview info
        expect(result.value.output).toContain('previous-session');
      }
    });

    it('shows summary preview in prompt', async () => {
      const existingContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'previous-session',
        summary: 'This is a test summary that should appear in the preview',
      };
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
        expect(result.value.output).toContain('This is a test summary');
      }
    });

    it('does not auto-load replay metadata (requires explicit ben_ten_load)', async () => {
      const existingContext: ContextData = {
        version: '2.0.0',
        createdAt: 1000,
        updatedAt: Date.now() - 60000, // 1 minute ago
        sessionId: 'previous-session',
        summary: 'Summary',
        conversationReplay: '## Recent Conversation\n\n**User:** Hello',
        replayMetadata: {
          tokenCount: 100,
          messageCount: 5,
          stoppingPointType: 'git_commit',
          generatedAt: Date.now(),
          allStoppingPoints: [
            { index: 10, type: 'git_commit' },
            { index: 5, type: 'task_completion' },
          ],
          currentStopIndex: 0,
          startMessageIndex: 11,
        },
      };
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(existingContext),
      );

      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/tmp/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should prompt, not auto-load replay
        expect(result.value.output).toContain('Context Found');
        expect(result.value.output).not.toContain('Recent Conversation');
        expect(result.value.output).toContain('ben_ten_load');
      }
    });

    it('shows human-readable time ago in prompt', async () => {
      const existingContext: ContextData = {
        version: '2.0.0',
        createdAt: 1000,
        updatedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        sessionId: 'previous-session',
        summary: 'Summary',
      };
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(existingContext),
      );

      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/tmp/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.output).toContain('Context Found');
        expect(result.value.output).toContain('2 hours ago');
      }
    });

    it('truncates long summaries in preview', async () => {
      const longSummary = 'A'.repeat(300);
      const existingContext: ContextData = {
        version: '2.0.0',
        createdAt: 1000,
        updatedAt: Date.now(),
        sessionId: 'previous-session',
        summary: longSummary,
      };
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(existingContext),
      );

      const input = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/tmp/test.jsonl',
        cwd: projectDir,
        hook_event_name: 'SessionStart',
        source: 'startup',
      });

      const result = await runHookCommand(input, { fs });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should truncate to 200 chars + ...
        expect(result.value.output).toContain(`${'A'.repeat(200)}...`);
        expect(result.value.output).not.toContain('A'.repeat(201));
      }
    });
  });
});
